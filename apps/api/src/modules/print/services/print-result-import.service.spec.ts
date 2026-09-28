import ExcelJS from 'exceljs';
import { PrintItem } from '../entities/print-item.entity';
import { PrintResultImportService } from './print-result-import.service';

/**
 * `PrintResultImportService.importResults` — covers the partial-export
 * scenario the user asked about directly (a CENTRALIZED batch where only
 * SOME items were "Xuất gói"'d), plus the 2026-09-25 product rule ("Chỉ ảnh
 * đã được export... mới đổi trạng thái"): only an EXPORTED item may be moved
 * by a result row, an already-PRINTED item is idempotent for "Đã in" and
 * rejected for "In thất bại", and a "Lỗi" regression restores the item's
 * REAL prior status (RENDERED or PENDING, `resolvePriorStatus`) instead of a
 * hardcoded RENDERED.
 *
 * Fakes follow the same match-by-SQL-substring `fakeManager` convention
 * `print-batch.service.exportPackage.spec.ts` and
 * `print-item.service.auto-attach.spec.ts` already use for this module — no
 * NestJS `TestingModule`/real DB needed since every DB touch in
 * `importResults` goes through the injected repos/`manager`, and the xlsx
 * parse/build round-trip is exercised for real (same as
 * `print-package-list-roundtrip.spec.ts`) rather than mocked, since that's
 * exactly the part under test.
 */
describe('PrintResultImportService.importResults', () => {
  const BATCH = {
    id: 'batch-1',
    code: 'PB-1',
    status: 'READY',
    mode: 'CENTRALIZED',
    printerId: 'printer-1',
  };

  function mkItem(
    overrides: Partial<PrintItem> & {
      id: string;
      subjectCode: string;
      status: string;
    },
  ) {
    return {
      batchId: 'batch-1',
      campaignId: 'camp-1',
      printerId: null,
      renderedFrontFsFileId: null,
      renderedBackFsFileId: null,
      ...overrides,
    };
  }

  /** Reads an xlsx cell back out as plain text — every cell this suite reads was written as a plain string/number, but `ExcelJS.CellValue` is a union that also includes rich-text/formula objects, so a bare `String(...)` would trip `@typescript-eslint/no-base-to-string`. */
  function cellText(value: ExcelJS.CellValue): string {
    return typeof value === 'string' || typeof value === 'number'
      ? String(value)
      : '';
  }

  async function buildResultWorkbook(
    rows: Array<[code: string, status: string, reason?: string]>,
  ): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Ket qua in');
    sheet.addRow(['Mã SV', 'Tình trạng', 'Lý do']);
    for (const [code, status, reason] of rows) {
      sheet.addRow([code, status, reason ?? '']);
    }
    return Buffer.from(await workbook.xlsx.writeBuffer());
  }

  function fakeManager(
    opts: {
      printedReturning?: Array<{ id: string }>;
      failedReturning?: Array<{ id: string }>;
      counts?: { printed: number; failed: number; total: number };
    } = {},
  ) {
    const printedReturning = opts.printedReturning ?? [];
    const failedReturning = opts.failedReturning ?? [];
    const countsRow = opts.counts ?? { printed: 0, failed: 0, total: 0 };
    // Typed with a second `params` arg (even though the branches below never
    // read it) so `.mock.calls` infers as `[string, unknown[]?][]`, not a
    // 1-tuple — the assertions below destructure each call's `params`.
    const query = jest.fn((sql: string, _params?: unknown[]) => {
      if (sql.includes("SET status = 'PRINTED'")) {
        return Promise.resolve([printedReturning, printedReturning.length]);
      }
      if (sql.includes('SET status = v.target_status')) {
        return Promise.resolve([failedReturning, failedReturning.length]);
      }
      if (sql.includes('SELECT COUNT(*) FILTER')) {
        return Promise.resolve([countsRow]);
      }
      if (sql.includes('UPDATE campaign_subjects')) {
        return Promise.resolve([[], 0]);
      }
      if (sql.includes("UPDATE print_batches SET status = 'READY'")) {
        return Promise.resolve([[], 0]);
      }
      return Promise.reject(new Error(`unexpected manager.query: ${sql}`));
    });
    const save = jest.fn().mockResolvedValue(undefined);
    const update = jest.fn().mockResolvedValue(undefined);
    return { query, save, update };
  }

  function buildService(opts: {
    batchItems: Array<Partial<PrintItem>>;
    manager: ReturnType<typeof fakeManager>;
    batch?: Partial<typeof BATCH>;
  }) {
    const imports = {
      create: jest.fn((data: unknown) => data),
      save: jest.fn((data: unknown) =>
        Promise.resolve({ id: 'import-1', ...(data as object) }),
      ),
      update: jest.fn().mockResolvedValue(undefined),
    };
    const batches = {
      findOne: jest.fn().mockResolvedValue({ ...BATCH, ...(opts.batch ?? {}) }),
    };
    const items = { find: jest.fn().mockResolvedValue(opts.batchItems) };
    const events = { create: jest.fn((data: unknown) => data) };
    const dataSource = {
      transaction: jest.fn((fn: (manager: unknown) => Promise<void>) =>
        fn(opts.manager),
      ),
    };
    const uploadedFiles: Array<{ virtualPath: string; data: Uint8Array }> = [];
    const fileStorage = {
      uploadRaw: jest.fn((input: { virtualPath: string; data: Uint8Array }) => {
        uploadedFiles.push(input);
        return Promise.resolve({
          fileId: input.virtualPath.includes('-errors.xlsx')
            ? 'fs-error-report'
            : 'fs-original-file',
        });
      }),
      issueViewLink: jest.fn().mockResolvedValue({
        url: 'https://fs.example/view/fs-error-report',
        viewUrl: 'https://fs.example/view/fs-error-report',
        expiresAt: new Date(),
      }),
    };
    const printerService = {
      applyStockDelta: jest.fn().mockResolvedValue(undefined),
    };
    const printStats = {
      recordPrinted: jest.fn().mockResolvedValue(undefined),
      recordFailed: jest.fn().mockResolvedValue(undefined),
    };

    const service = new PrintResultImportService(
      imports as never,
      batches as never,
      items as never,
      events as never,
      dataSource as never,
      fileStorage as never,
      printerService as never,
      printStats as never,
    );

    return {
      service,
      imports,
      batches,
      items,
      events,
      dataSource,
      fileStorage,
      printerService,
      printStats,
      uploadedFiles,
    };
  }

  it('partial-export upload: A→PRINTED, B→FAILED (regressed to RENDERED, has a rendered PNG), leaves never-exported C/D untouched, reports E as not-in-batch, matches the exact expected counts', async () => {
    const ITEM_A = mkItem({
      id: 'item-A',
      subjectCode: 'ZZTEST-A',
      status: 'EXPORTED',
    });
    const ITEM_B = mkItem({
      id: 'item-B',
      subjectCode: 'ZZTEST-B',
      status: 'EXPORTED',
      renderedFrontFsFileId: 'fs-front-b',
    });
    const ITEM_C = mkItem({
      id: 'item-C',
      subjectCode: 'ZZTEST-C',
      status: 'PENDING',
    });
    const ITEM_D = mkItem({
      id: 'item-D',
      subjectCode: 'ZZTEST-D',
      status: 'RENDERED',
    });

    const manager = fakeManager({
      printedReturning: [{ id: 'item-A' }],
      failedReturning: [{ id: 'item-B' }],
      counts: { printed: 1, failed: 1, total: 4 },
    });
    const {
      service,
      imports,
      fileStorage,
      printerService,
      printStats,
      uploadedFiles,
    } = buildService({ batchItems: [ITEM_A, ITEM_B, ITEM_C, ITEM_D], manager });

    const buffer = await buildResultWorkbook([
      ['ZZTEST-A', 'Đã in'], // row 2 — EXPORTED, ok
      ['ZZTEST-B', 'In thất bại', 'Kẹt giấy'], // row 3 — EXPORTED, fails, has a rendered PNG
      ['ZZTEST-C', 'Đã in'], // row 4 — PENDING, never exported
      ['ZZTEST-D', 'In thất bại'], // row 5 — RENDERED, never exported
      ['ZZTEST-E', 'Đã in'], // row 6 — code not in this batch
    ]);
    const result = await service.importResults(
      'batch-1',
      {
        buffer,
        mimetype:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        size: buffer.length,
        originalname: 'danh-sach-in.xlsx',
      },
      'user-1',
    );

    // --- counts (task's exact expectation) ---
    expect(result.totalRows).toBe(5);
    expect(result.matchedRows).toBe(2); // A, B only — C/D found the code but weren't handed off
    expect(result.printedRows).toBe(1); // A
    expect(result.failedRows).toBe(1); // B
    expect(result.unmatchedRows).toBe(3); // C, D, E
    expect(result.status).toBe('DONE'); // not FAILED — the whole file is still readable/valid

    // --- A becomes PRINTED (guard now pins batch_id too, see write-time race fix) ---
    expect(manager.query).toHaveBeenCalledWith(
      expect.stringContaining("SET status = 'PRINTED'"),
      [['item-A'], 'batch-1', expect.any(Date)],
    );

    // --- B regresses to RENDERED (it has a rendered PNG) with error_message "Kẹt giấy" ---
    expect(manager.query).toHaveBeenCalledWith(
      expect.stringContaining('SET status = v.target_status'),
      ['item-B', 'Kẹt giấy', 'RENDERED', 'batch-1'],
    );

    // --- C and D are never referenced in any write: no status/event/stock/
    // stats mutation for either. Every manager.query call's params are
    // inspected so this doesn't just get lucky on the two calls asserted
    // above. ---
    const allQueryParamValues = manager.query.mock.calls.flatMap(
      ([, params]) => (Array.isArray(params) ? params.flat(2) : []),
    );
    expect(allQueryParamValues).not.toContain('item-C');
    expect(allQueryParamValues).not.toContain('item-D');
    expect(allQueryParamValues).not.toContain('ZZTEST-C');
    expect(allQueryParamValues).not.toContain('ZZTEST-D');

    const savedEventItemIds = manager.save.mock.calls
      .flatMap(
        ([, rows]) => rows as Array<{ itemId: string; toStatus: string }>,
      )
      .map((e) => e.itemId);
    expect(savedEventItemIds.sort()).toEqual(['item-A', 'item-B']);
    const bEvent = manager.save.mock.calls
      .flatMap(
        ([, rows]) => rows as Array<{ itemId: string; toStatus: string }>,
      )
      .find((e) => e.itemId === 'item-B');
    expect(bEvent?.toStatus).toBe('RENDERED');

    // --- stock decremented exactly once (only A newly transitioned to
    // PRINTED — B never reached PRINTED so it must never decrement stock) ---
    expect(printerService.applyStockDelta).toHaveBeenCalledTimes(1);
    expect(printerService.applyStockDelta).toHaveBeenCalledWith(
      manager,
      'printer-1',
      -1,
      'PRINT',
      'user-1',
      expect.any(String),
    );
    expect(printStats.recordPrinted).toHaveBeenCalledTimes(1);
    expect(printStats.recordFailed).toHaveBeenCalledTimes(1);

    // --- the final PrintResultImport row write matches the returned DAO's
    // counts exactly (this is what a later listImports()/getImport() would
    // read back). ---
    expect(manager.update).toHaveBeenCalledWith(
      expect.anything(),
      'import-1',
      expect.objectContaining({
        status: 'DONE',
        totalRows: 5,
        matchedRows: 2,
        printedRows: 1,
        failedRows: 1,
        unmatchedRows: 3,
      }),
    );
    expect(imports.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'PROCESSING' }),
    );

    // --- error report was built and uploaded (reportRows.length > 0) ---
    const errorUpload = uploadedFiles.find((f) =>
      f.virtualPath.includes('-errors.xlsx'),
    );
    expect(errorUpload).toBeDefined();
    expect(fileStorage.issueViewLink).toHaveBeenCalled();
    expect(result.errorReportUrl).toBe(
      'https://fs.example/view/fs-error-report',
    );

    // --- inline `errors` on the response DAO (2026-09-25 ask: CMS must show
    // rejected rows immediately, not only via the downloadable xlsx). ---
    expect(result.errors).toHaveLength(3);
    const reasonFor = (code: string) =>
      result.errors?.find((r) => r.subjectCode === code)?.reason ?? '';
    expect(reasonFor('ZZTEST-C')).toContain('Chưa in');
    expect(reasonFor('ZZTEST-D')).toContain('Chưa in');
    expect(reasonFor('ZZTEST-E')).toBe('Không tìm thấy mã SV trong đợt in này');

    // --- the downloadable error-report xlsx carries the SAME reasons: C/D's
    // reason must show the CMS-style Vietnamese "Chưa in" label, never the
    // raw PENDING/RENDERED enum value, and must read distinctly from E's
    // "not in this batch at all" reason. ---
    const reportWorkbook = new ExcelJS.Workbook();
    await reportWorkbook.xlsx.load(errorUpload!.data as never);
    const reportSheet = reportWorkbook.worksheets[0];
    const reportRows: Array<{ subjectCode: string; reason: string }> = [];
    for (let r = 2; r <= reportSheet.rowCount; r++) {
      const row = reportSheet.getRow(r);
      if (row.cellCount === 0) continue;
      reportRows.push({
        subjectCode: cellText(row.getCell(2).value),
        reason: cellText(row.getCell(3).value),
      });
    }
    expect(reportRows).toHaveLength(3);
    const reportReasonFor = (code: string) =>
      reportRows.find((r) => r.subjectCode === code)?.reason ?? '';

    const reasonC = reportReasonFor('ZZTEST-C');
    expect(reasonC).toContain('Chưa in');
    expect(reasonC).not.toMatch(/\bPENDING\b/);
    expect(reasonC).toContain('Xuất gói');

    const reasonD = reportReasonFor('ZZTEST-D');
    expect(reasonD).toContain('Chưa in');
    expect(reasonD).not.toMatch(/\bRENDERED\b/);

    const reasonE = reportReasonFor('ZZTEST-E');
    expect(reasonE).toBe('Không tìm thấy mã SV trong đợt in này');
    expect(reasonE).not.toContain('Xuất gói');
  });

  it('a "Lỗi" regression restores the item\'s REAL prior status: no rendered PNG → PENDING, has a rendered PNG → RENDERED, both with error_message set', async () => {
    const ITEM_X = mkItem({
      id: 'item-X',
      subjectCode: 'ZZTEST-X',
      status: 'EXPORTED',
    }); // never rendered
    const ITEM_Y = mkItem({
      id: 'item-Y',
      subjectCode: 'ZZTEST-Y',
      status: 'EXPORTED',
      renderedBackFsFileId: 'fs-back-y', // back-only still counts as "was rendered"
    });

    const manager = fakeManager({
      failedReturning: [{ id: 'item-X' }, { id: 'item-Y' }],
      counts: { printed: 0, failed: 2, total: 2 },
    });
    const { service } = buildService({ batchItems: [ITEM_X, ITEM_Y], manager });

    const buffer = await buildResultWorkbook([
      ['ZZTEST-X', 'In thất bại'], // no reason → default message
      ['ZZTEST-Y', 'In thất bại', 'Mờ ảnh'],
    ]);
    const result = await service.importResults(
      'batch-1',
      {
        buffer,
        mimetype:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        size: buffer.length,
        originalname: 'ket-qua.xlsx',
      },
      'user-1',
    );

    expect(result.matchedRows).toBe(2);
    expect(result.failedRows).toBe(2);
    expect(result.printedRows).toBe(0);
    expect(result.unmatchedRows).toBe(0);
    expect(result.errors).toHaveLength(0);

    // Per-row target status + message, in file row order (trailing param is
    // the pinned batch_id — write-time race guard).
    expect(manager.query).toHaveBeenCalledWith(
      expect.stringContaining('SET status = v.target_status'),
      [
        'item-X',
        'Lỗi in (từ file upload kết quả)',
        'PENDING',
        'item-Y',
        'Mờ ảnh',
        'RENDERED',
        'batch-1',
      ],
    );

    const events = manager.save.mock.calls.flatMap(
      ([, rows]) =>
        rows as Array<{ itemId: string; toStatus: string; message: string }>,
    );
    expect(events.find((e) => e.itemId === 'item-X')).toMatchObject({
      toStatus: 'PENDING',
      message: 'Lỗi in (từ file upload kết quả)',
    });
    expect(events.find((e) => e.itemId === 'item-Y')).toMatchObject({
      toStatus: 'RENDERED',
      message: 'Mờ ảnh',
    });
  });

  it('a repeated "Đã in" row on an already-PRINTED item is an idempotent no-op — no re-decrement, no duplicate event', async () => {
    const ITEM_Z = mkItem({
      id: 'item-Z',
      subjectCode: 'ZZTEST-Z',
      status: 'PRINTED',
    });
    // Nothing actually updated — status <> 'PRINTED' guard filters it out.
    const manager = fakeManager({
      printedReturning: [],
      counts: { printed: 1, failed: 0, total: 1 },
    });
    const { service, printerService, printStats } = buildService({
      batchItems: [ITEM_Z],
      manager,
    });

    const buffer = await buildResultWorkbook([['ZZTEST-Z', 'Đã in']]);
    const result = await service.importResults(
      'batch-1',
      {
        buffer,
        mimetype:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        size: buffer.length,
        originalname: 'ket-qua.xlsx',
      },
      'user-1',
    );

    expect(result.matchedRows).toBe(1);
    expect(result.printedRows).toBe(1); // still counted as a normal successful row
    expect(result.failedRows).toBe(0);
    expect(result.unmatchedRows).toBe(0);
    expect(result.errors).toHaveLength(0);

    expect(manager.save).not.toHaveBeenCalled(); // no event — nothing changed
    expect(printerService.applyStockDelta).not.toHaveBeenCalled();
    expect(printStats.recordPrinted).not.toHaveBeenCalled();
  });

  it('an "In thất bại" row on an already-PRINTED item is rejected outright — item untouched, reported as a row error', async () => {
    const ITEM_W = mkItem({
      id: 'item-W',
      subjectCode: 'ZZTEST-W',
      status: 'PRINTED',
    });
    const manager = fakeManager({
      counts: { printed: 1, failed: 0, total: 1 },
    });
    const { service, printerService, printStats } = buildService({
      batchItems: [ITEM_W],
      manager,
    });

    const buffer = await buildResultWorkbook([
      ['ZZTEST-W', 'In thất bại', 'Nhầm lẫn'],
    ]);
    const result = await service.importResults(
      'batch-1',
      {
        buffer,
        mimetype:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        size: buffer.length,
        originalname: 'ket-qua.xlsx',
      },
      'user-1',
    );

    expect(result.matchedRows).toBe(1); // the code WAS found in this batch
    expect(result.printedRows).toBe(0);
    expect(result.failedRows).toBe(0);
    expect(result.unmatchedRows).toBe(1);
    expect(result.errors).toEqual([
      {
        rowNo: 2,
        subjectCode: 'ZZTEST-W',
        reason:
          'Thẻ đã được ghi nhận in thành công trước đó — không thể chuyển sang lỗi',
      },
    ]);

    // Neither the PRINTED-update nor the FAILED-regression branch ever ran
    // (both guarded by `.length`, and both arrays are empty here) — only the
    // batch-counters SELECT executes.
    expect(manager.query).toHaveBeenCalledTimes(1);
    expect(manager.save).not.toHaveBeenCalled();
    expect(printerService.applyStockDelta).not.toHaveBeenCalled();
    expect(printStats.recordFailed).not.toHaveBeenCalled();
  });

  it('every row rejected: nothing changes, the import still ends DONE (not FAILED), and every row is reported', async () => {
    const ITEM_1 = mkItem({
      id: 'item-1',
      subjectCode: 'ZZTEST-1',
      status: 'PENDING',
    });
    const ITEM_2 = mkItem({
      id: 'item-2',
      subjectCode: 'ZZTEST-2',
      status: 'RENDERED',
    });
    const manager = fakeManager({
      counts: { printed: 0, failed: 0, total: 2 },
    });
    const { service, imports, printerService, printStats } = buildService({
      batchItems: [ITEM_1, ITEM_2],
      manager,
    });

    const buffer = await buildResultWorkbook([
      ['ZZTEST-1', 'Đã in'], // never exported
      ['ZZTEST-2', 'In thất bại'], // never exported
      ['ZZTEST-3', 'Đã in'], // not in this batch at all
    ]);
    const result = await service.importResults(
      'batch-1',
      {
        buffer,
        mimetype:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        size: buffer.length,
        originalname: 'ket-qua.xlsx',
      },
      'user-1',
    );

    expect(result.status).toBe('DONE');
    expect(result.totalRows).toBe(3);
    expect(result.matchedRows).toBe(0);
    expect(result.printedRows).toBe(0);
    expect(result.failedRows).toBe(0);
    expect(result.unmatchedRows).toBe(3);
    expect(result.errors).toHaveLength(3);
    expect(result.errors?.map((e) => e.subjectCode).sort()).toEqual([
      'ZZTEST-1',
      'ZZTEST-2',
      'ZZTEST-3',
    ]);

    expect(manager.save).not.toHaveBeenCalled();
    expect(printerService.applyStockDelta).not.toHaveBeenCalled();
    expect(printStats.recordPrinted).not.toHaveBeenCalled();
    expect(printStats.recordFailed).not.toHaveBeenCalled();
    // Final import row still recorded as DONE, not FAILED — a whole-file
    // parse failure is a different, harsher rejection level (see this
    // service's own top doc comment); a fully-rejected-but-readable file
    // must still leave a normal DONE record the operator can review.
    expect(manager.update).toHaveBeenCalledWith(
      expect.anything(),
      'import-1',
      expect.objectContaining({ status: 'DONE', unmatchedRows: 3 }),
    );
    expect(imports.update).not.toHaveBeenCalledWith(
      'import-1',
      expect.objectContaining({ status: 'FAILED' }),
    );
  });

  it('PRINTED branch write-time race: a row that loses the guarded UPDATE (something moved the item off EXPORTED after the find() snapshot) is walked back out of printedRows into an error, not silently applied or dropped', async () => {
    const ITEM_P = mkItem({
      id: 'item-P',
      subjectCode: 'ZZTEST-P',
      status: 'EXPORTED',
    });
    const ITEM_Q = mkItem({
      id: 'item-Q',
      subjectCode: 'ZZTEST-Q',
      status: 'EXPORTED', // snapshotted EXPORTED, but the guarded UPDATE below only returns P
    });

    // Only item-P comes back from `RETURNING id` — item-Q's row lost the
    // write-time race (guard no longer matches it), even though the
    // in-memory plan above expected both to succeed.
    const manager = fakeManager({
      printedReturning: [{ id: 'item-P' }],
      counts: { printed: 1, failed: 0, total: 2 },
    });
    const { service, printerService, printStats } = buildService({
      batchItems: [ITEM_P, ITEM_Q],
      manager,
    });

    const buffer = await buildResultWorkbook([
      ['ZZTEST-P', 'Đã in'], // row 2
      ['ZZTEST-Q', 'Đã in'], // row 3 — loses the race
    ]);
    const result = await service.importResults(
      'batch-1',
      {
        buffer,
        mimetype:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        size: buffer.length,
        originalname: 'ket-qua.xlsx',
      },
      'user-1',
    );

    expect(result.matchedRows).toBe(2); // both codes WERE found + were EXPORTED at read time
    expect(result.printedRows).toBe(1); // only P actually got written — NOT the 2 that were planned
    expect(result.failedRows).toBe(0);
    expect(result.unmatchedRows).toBe(1); // Q moved into the error bucket
    expect(result.errors).toEqual([
      {
        rowNo: 3,
        subjectCode: 'ZZTEST-Q',
        reason:
          'Trạng thái thẻ đã thay đổi trong lúc xử lý — vui lòng tải lại trang và thử lại',
      },
    ]);

    // Only P's write actually happened: one event, one stock decrement, one
    // stats call — Q gets none of them despite being in the original plan.
    const savedEventItemIds = manager.save.mock.calls
      .flatMap(([, rows]) => rows as Array<{ itemId: string }>)
      .map((e) => e.itemId);
    expect(savedEventItemIds).toEqual(['item-P']);
    expect(printerService.applyStockDelta).toHaveBeenCalledTimes(1);
    expect(printStats.recordPrinted).toHaveBeenCalledTimes(1);

    // The persisted import row reflects the REAL write (1), not the planned
    // one (2).
    expect(manager.update).toHaveBeenCalledWith(
      expect.anything(),
      'import-1',
      expect.objectContaining({ printedRows: 1, unmatchedRows: 1 }),
    );
  });

  it('FAILED branch write-time race: a row that loses the guarded regression UPDATE is walked back out of failedRows into an error, not silently applied or dropped', async () => {
    const ITEM_R = mkItem({
      id: 'item-R',
      subjectCode: 'ZZTEST-R',
      status: 'EXPORTED',
    });
    const ITEM_S = mkItem({
      id: 'item-S',
      subjectCode: 'ZZTEST-S',
      status: 'EXPORTED', // snapshotted EXPORTED, but only R comes back RETURNING
    });

    const manager = fakeManager({
      failedReturning: [{ id: 'item-R' }],
      counts: { printed: 0, failed: 1, total: 2 },
    });
    const { service, printStats } = buildService({
      batchItems: [ITEM_R, ITEM_S],
      manager,
    });

    const buffer = await buildResultWorkbook([
      ['ZZTEST-R', 'In thất bại', 'Lỗi 1'], // row 2
      ['ZZTEST-S', 'In thất bại', 'Lỗi 2'], // row 3 — loses the race
    ]);
    const result = await service.importResults(
      'batch-1',
      {
        buffer,
        mimetype:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        size: buffer.length,
        originalname: 'ket-qua.xlsx',
      },
      'user-1',
    );

    expect(result.matchedRows).toBe(2);
    expect(result.printedRows).toBe(0);
    expect(result.failedRows).toBe(1); // only R actually got regressed
    expect(result.unmatchedRows).toBe(1); // S moved into the error bucket
    expect(result.errors).toEqual([
      {
        rowNo: 3,
        subjectCode: 'ZZTEST-S',
        reason:
          'Trạng thái thẻ đã thay đổi trong lúc xử lý — vui lòng tải lại trang và thử lại',
      },
    ]);

    const savedEventItemIds = manager.save.mock.calls
      .flatMap(([, rows]) => rows as Array<{ itemId: string }>)
      .map((e) => e.itemId);
    expect(savedEventItemIds).toEqual(['item-R']);
    expect(printStats.recordFailed).toHaveBeenCalledTimes(1);

    expect(manager.update).toHaveBeenCalledWith(
      expect.anything(),
      'import-1',
      expect.objectContaining({ failedRows: 1, unmatchedRows: 1 }),
    );
  });
});
