import { FileStorageService } from '@app/modules/file-storage/services/file-storage.service';
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import ExcelJS from 'exceljs';
import { DataSource, In, Not, Repository } from 'typeorm';
import { PrintResultImportDao } from '../dao';
import { PrintBatch } from '../entities/print-batch.entity';
import { PrintItem } from '../entities/print-item.entity';
import { PrintItemEvent } from '../entities/print-item-event.entity';
import { PrintResultImport } from '../entities/print-result-import.entity';
import { PRINT_ITEM_INACTIVE_STATUSES } from '../print.constants';
import { PrinterService } from './printer.service';
import { PrintStatsService } from '@app/modules/stats/services/print-stats.service';

interface UploadedMulterFile {
  buffer: Buffer;
  mimetype: string;
  size: number;
  originalname: string;
}

type ResultFieldKey = 'subjectCode' | 'printStatus' | 'errorReason';

/** Same header-matching mechanism `CampaignSubjectService.parseWorkbook` uses for roster uploads — duplicated (not imported) since `print` must not depend on `device-management` for one small string-normalization helper (module-boundary convention this whole codebase follows, see `1818000000000-Print.ts`'s own top comment). */
const HEADER_ALIASES: Record<ResultFieldKey, string[]> = {
  subjectCode: ['Mã SV', 'MSSV', 'Mã số SV', 'Mã số sinh viên'],
  printStatus: ['Tình trạng', 'Tình trạng in', 'Trạng thái', 'Kết quả'],
  errorReason: ['Lỗi', 'Lý do', 'Lý do lỗi', 'Ghi chú'],
};
const REQUIRED_FIELDS: ResultFieldKey[] = ['subjectCode', 'printStatus'];

const PRINTED_VALUES = new Set([
  'da in',
  'in thanh cong',
  'thanh cong',
  'ok',
  'x',
]);
const FAILED_VALUES = new Set([
  'loi',
  'khong in duoc',
  'in loi',
  'tu choi',
  'fail',
]);

/** Strips accents/case/whitespace so header AND value text match regardless of wording — same normalization spirit `normalizeHeaderText` in `campaign-subject.service.ts` uses for roster headers, extended here to also classify the `printStatus` cell's own text. */
function normalizeText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

const NORMALIZED_HEADER_ALIASES: Record<string, ResultFieldKey> =
  Object.fromEntries(
    (
      Object.entries(HEADER_ALIASES) as Array<[ResultFieldKey, string[]]>
    ).flatMap(([field, aliases]) =>
      aliases.map((alias) => [normalizeText(alias), field]),
    ),
  );

interface ParsedResultRow {
  rowNo: number;
  subjectCode: string | null;
  printStatus: string | null;
  errorReason: string | null;
}

/** `classifyStatus`'s three outcomes — `UNKNOWN` (an unrecognized status word) is deliberately never guessed into either PRINTED or FAILED (same "không bao giờ suy luận" spirit BA #14 states for `printedAt`) — it is reported alongside unmatched rows instead. */
type StatusOutcome = 'PRINTED' | 'FAILED' | 'UNKNOWN';

function classifyStatus(raw: string | null): StatusOutcome {
  if (!raw) return 'UNKNOWN';
  const normalized = normalizeText(raw);
  if (PRINTED_VALUES.has(normalized)) return 'PRINTED';
  if (FAILED_VALUES.has(normalized)) return 'FAILED';
  return 'UNKNOWN';
}

/**
 * Print-result upload — Giai đoạn 4 (plan §4.3, features 4+5). Parses and
 * validates **synchronously**, same reasoning `CampaignSubjectImport`'s own
 * doc comment gives for roster Excel uploads: a print batch's result file
 * is a few hundred rows a human is already waiting on, not an unattended
 * background job.
 *
 * Two distinct "từ chối" levels (plan's own explicit decision):
 * 1. The WHOLE file is unreadable/missing a required column →
 *    `PrintResultImport.status = 'FAILED'`, nothing else touched, thrown
 *    back as a 400 — the batch/items stay exactly as they were.
 * 2. A single ROW doesn't match any item in this batch, or its status
 *    text isn't recognized → counted into `unmatchedRows`, reported in the
 *    downloadable error file, but the rest of the file still applies.
 */
@Injectable()
export class PrintResultImportService {
  private readonly logger = new Logger(PrintResultImportService.name);

  constructor(
    @InjectRepository(PrintResultImport)
    private readonly imports: Repository<PrintResultImport>,
    @InjectRepository(PrintBatch)
    private readonly batches: Repository<PrintBatch>,
    @InjectRepository(PrintItem)
    private readonly items: Repository<PrintItem>,
    @InjectRepository(PrintItemEvent)
    private readonly events: Repository<PrintItemEvent>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly fileStorage: FileStorageService,
    private readonly printerService: PrinterService,
    private readonly printStats: PrintStatsService,
  ) {}

  async importResults(
    batchId: string,
    file: UploadedMulterFile,
    uploadedByUserId: string | null,
  ): Promise<PrintResultImportDao> {
    const batch = await this.batches.findOne({ where: { id: batchId } });
    if (!batch) throw new NotFoundException('Không tìm thấy đợt in');

    const importRow = await this.imports.save(
      this.imports.create({
        batchId,
        fileName: file.originalname,
        uploadedByUserId,
        status: 'PROCESSING',
      }),
    );

    let rows: ParsedResultRow[];
    try {
      rows = await this.parseWorkbook(file.buffer);
    } catch (error) {
      const failureReason = (error as Error).message;
      await this.imports.update(importRow.id, {
        status: 'FAILED',
        failureReason,
      });
      throw new BadRequestException(
        `Không đọc được file kết quả in: ${failureReason}`,
      );
    }

    // CANCELLED/FAILED/REPRINT_REQUESTED items are excluded from matching
    // on purpose — a cancelled or superseded card should not be silently
    // revived by an upload that never knew about it, and (crucially for a
    // reprinted card) the superseded REPRINT_REQUESTED original must never
    // win a subjectCode collision against its own active reprint item.
    const batchItems = await this.items.find({
      where: { batchId, status: Not(In(PRINT_ITEM_INACTIVE_STATUSES)) },
    });
    // Grouped by subjectCode (not a straight last-wins Map) so a genuine
    // collision — more than one active item sharing a subjectCode, e.g. an
    // in-flight reprint pair that briefly shares a batch — is detected and
    // reported instead of silently applying the result to whichever row
    // `find()` happened to return last.
    const itemsByCode = new Map<string, PrintItem[]>();
    for (const item of batchItems) {
      const list = itemsByCode.get(item.subjectCode) ?? [];
      list.push(item);
      itemsByCode.set(item.subjectCode, list);
    }

    let matched = 0;
    let printedCount = 0;
    let failedCount = 0;
    let unmatched = 0;
    const printedItems: PrintItem[] = [];
    const failedItems: Array<{ item: PrintItem; message: string }> = [];
    const reportRows: Array<{
      rowNo: number;
      subjectCode: string | null;
      reason: string;
    }> = [];

    for (const row of rows) {
      const code = row.subjectCode?.trim() || null;
      const candidates = code ? itemsByCode.get(code) : undefined;
      if (!candidates || candidates.length === 0) {
        unmatched++;
        reportRows.push({
          rowNo: row.rowNo,
          subjectCode: row.subjectCode,
          reason: 'Không tìm thấy mã SV trong đợt in này',
        });
        continue;
      }
      if (candidates.length > 1) {
        unmatched++;
        reportRows.push({
          rowNo: row.rowNo,
          subjectCode: row.subjectCode,
          reason: `Mã SV trùng ${candidates.length} item trong đợt in — không thể xác định item nào, cần xử lý tay`,
        });
        continue;
      }
      const item = candidates[0];
      matched++;
      const outcome = classifyStatus(row.printStatus);
      if (outcome === 'PRINTED') {
        printedItems.push(item);
        printedCount++;
      } else if (outcome === 'FAILED') {
        failedItems.push({
          item,
          message: row.errorReason?.trim() || 'Lỗi in (từ file upload kết quả)',
        });
        failedCount++;
      } else {
        unmatched++;
        reportRows.push({
          rowNo: row.rowNo,
          subjectCode: row.subjectCode,
          reason: `Không hiểu trạng thái in: "${row.printStatus ?? ''}"`,
        });
      }
    }

    await this.dataSource.transaction(async (manager) => {
      const now = new Date();

      if (printedItems.length) {
        const ids = printedItems.map((i) => i.id);
        // `WHERE ... AND status <> 'PRINTED'` + `RETURNING id`, then only
        // bookkeep the rows actually returned — a re-uploaded/duplicate
        // result file (same file twice, or a cumulative sheet repeating
        // already-PRINTED rows) must not re-decrement stock, re-count
        // stats, append a duplicate PRINTED->PRINTED event, or overwrite
        // the real first-print `printed_at`. `UPDATE ... RETURNING` here
        // returns a `[rows, affectedCount]` tuple, same rule
        // `PrintItemService.bulkUpdateTemplate` documents.
        const [updatedRows]: [Array<{ id: string }>, number] =
          await manager.query(
            `UPDATE print_items
                SET status = 'PRINTED', printed_at = COALESCE(printed_at, $2), error_message = NULL, updated_at = now()
              WHERE id = ANY($1) AND status <> 'PRINTED'
              RETURNING id`,
            [ids, now],
          );
        const newlyPrintedIds = new Set(updatedRows.map((r) => r.id));
        const newlyPrintedItems = printedItems.filter((i) =>
          newlyPrintedIds.has(i.id),
        );

        if (newlyPrintedItems.length) {
          await manager.save(
            PrintItemEvent,
            newlyPrintedItems.map((item) =>
              this.events.create({
                itemId: item.id,
                fromStatus: item.status,
                toStatus: 'PRINTED',
                source: 'RESULT_UPLOAD',
                actorUserId: uploadedByUserId,
                message: 'Xác nhận đã in (upload file kết quả)',
              }),
            ),
          );

          // Feature 6 wiring (Giai đoạn 3 deferred this exact write to here
          // — see `campaign_subjects.printedAt`'s own doc comment). Grouped
          // by campaign since one print batch's items can span more than
          // one. `COALESCE` for the same double-upload reason as above.
          const codesByCampaign = new Map<string, string[]>();
          for (const item of newlyPrintedItems) {
            const list = codesByCampaign.get(item.campaignId) ?? [];
            list.push(item.subjectCode);
            codesByCampaign.set(item.campaignId, list);
          }
          for (const [campaignId, codes] of codesByCampaign) {
            await manager.query(
              `UPDATE campaign_subjects
                  SET printed_at = COALESCE(printed_at, now()), printed_batch_id = $3, updated_at = now()
                WHERE campaign_id = $1 AND subject_code = ANY($2) AND status = 'VALID'`,
              [campaignId, codes, batchId],
            );
          }

          // Stock/stats bookkeeping — same "thao tác tay" path
          // `PrintItemService.markPrintedManually` already follows, just
          // looped per matched row; a printer that can't be resolved
          // (common for a CENTRALIZED batch with no `printerId`) simply
          // skips the stock decrement, same tolerant fallback that method
          // documents. Only rows that just transitioned to PRINTED reach
          // here, so a duplicate upload can never double-decrement stock or
          // double-count the daily stats.
          for (const item of newlyPrintedItems) {
            const printerId = item.printerId ?? batch.printerId ?? null;
            if (printerId) {
              await this.printerService.applyStockDelta(
                manager,
                printerId,
                -1,
                'PRINT',
                uploadedByUserId,
                'Xác nhận đã in (upload file kết quả)',
              );
            }
            await this.printStats.recordPrinted(
              manager,
              item.campaignId,
              printerId,
              now,
            );
          }
        }
      }

      if (failedItems.length) {
        // Per-row error message → `UPDATE ... FROM (VALUES ...)`, not a
        // single `ANY($1)` update (every row needs its OWN message).
        // `AND pi.status <> 'RENDERED'` + `RETURNING` so a duplicate
        // upload repeating the same "Lỗi" row is a no-op instead of
        // re-appending a RENDERED->RENDERED event/recordFailed() count;
        // it also means an item this same upload just regressed from
        // PRINTED gets `printed_at` (and the roster's mirrored
        // `campaign_subjects.printed_at`/`printed_batch_id`) cleared,
        // instead of silently keeping a stale "printed" record for a card
        // that no longer has PRINTED status.
        const valuesSql = failedItems
          .map((_, idx) => `($${idx * 2 + 1}::uuid, $${idx * 2 + 2}::text)`)
          .join(', ');
        const params = failedItems.flatMap((f) => [f.item.id, f.message]);
        const [regressedRows]: [Array<{ id: string }>, number] =
          await manager.query(
            `UPDATE print_items AS pi
                SET status = 'RENDERED', error_message = v.msg, printed_at = NULL, updated_at = now()
               FROM (VALUES ${valuesSql}) AS v(id, msg)
              WHERE pi.id = v.id AND pi.status <> 'RENDERED'
              RETURNING pi.id`,
            params,
          );
        const regressedIds = new Set(regressedRows.map((r) => r.id));
        const regressedItems = failedItems.filter(({ item }) =>
          regressedIds.has(item.id),
        );

        if (regressedItems.length) {
          await manager.save(
            PrintItemEvent,
            regressedItems.map(({ item, message }) =>
              this.events.create({
                itemId: item.id,
                fromStatus: item.status,
                toStatus: 'RENDERED',
                source: 'RESULT_UPLOAD',
                actorUserId: uploadedByUserId,
                message,
              }),
            ),
          );

          const codesByCampaign = new Map<string, string[]>();
          for (const { item } of regressedItems) {
            const list = codesByCampaign.get(item.campaignId) ?? [];
            list.push(item.subjectCode);
            codesByCampaign.set(item.campaignId, list);
          }
          for (const [campaignId, codes] of codesByCampaign) {
            await manager.query(
              `UPDATE campaign_subjects
                  SET printed_at = NULL, printed_batch_id = NULL, updated_at = now()
                WHERE campaign_id = $1 AND subject_code = ANY($2) AND status = 'VALID'`,
              [campaignId, codes],
            );
          }

          for (const { item } of regressedItems) {
            await this.printStats.recordFailed(
              manager,
              item.campaignId,
              item.printerId ?? batch.printerId ?? null,
              now,
            );
          }
        }
      }

      // Bẫy 5 — recompute the batch's maintained counters from a real
      // COUNT in this same transaction, rather than incrementing N times;
      // this also self-heals any drift that predates this specific upload.
      const [counts]: Array<{
        printed: number;
        failed: number;
        total: number;
      }> = await manager.query(
        `SELECT COUNT(*) FILTER (WHERE status = 'PRINTED')::int AS printed,
                  COUNT(*) FILTER (WHERE status = 'FAILED')::int AS failed,
                  COUNT(*)::int AS total
             FROM print_items WHERE batch_id = $1`,
        [batchId],
      );
      await manager.update(PrintBatch, batchId, {
        printedCount: counts.printed,
        failedCount: counts.failed,
        itemCount: counts.total,
      });

      // Bẫy 4's reopen rule — only when this upload actually sent an item
      // back to RENDERED, and only if the batch had already been marked
      // DONE; goes to READY (not PRINTING), matching `exportPackage()`'s
      // own precondition so "Xuất gói" can run again immediately.
      if (failedItems.length > 0) {
        await manager.query(
          `UPDATE print_batches SET status = 'READY', done_at = NULL WHERE id = $1 AND status = 'DONE'`,
          [batchId],
        );
      }

      await manager.update(PrintResultImport, importRow.id, {
        status: 'DONE',
        totalRows: rows.length,
        matchedRows: matched,
        printedRows: printedCount,
        failedRows: failedCount,
        unmatchedRows: unmatched,
      });
    });

    // Best-effort, outside the transaction — same precedent
    // `CampaignSubjectService.importRoster` follows for its own two
    // uploads.
    let errorReportFsFileId: string | null = null;
    if (reportRows.length > 0) {
      try {
        const buffer = await this.buildErrorReport(reportRows);
        const result = await this.fileStorage.uploadRaw({
          virtualPath: `print-batches/${batchId}/result-imports/${importRow.id}-errors.xlsx`,
          mimeType:
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          data: new Uint8Array(buffer),
          idempotencyKey: randomUUID(),
          visibility: 'public',
        });
        errorReportFsFileId = result.fileId;
      } catch (error) {
        this.logger.warn(
          `error-report upload failed for result import ${importRow.id}: ${(error as Error).message}`,
        );
      }
    }

    let fsFileId: string | null = null;
    try {
      const result = await this.fileStorage.uploadRaw({
        virtualPath: `print-batches/${batchId}/result-imports/${importRow.id}-${file.originalname}`,
        mimeType: file.mimetype,
        data: new Uint8Array(file.buffer),
        idempotencyKey: randomUUID(),
        visibility: 'public',
      });
      fsFileId = result.fileId;
    } catch (error) {
      this.logger.warn(
        `original-file upload failed for result import ${importRow.id}: ${(error as Error).message}`,
      );
    }

    await this.imports.update(importRow.id, { errorReportFsFileId, fsFileId });

    return this.toDao({
      ...importRow,
      status: 'DONE',
      totalRows: rows.length,
      matchedRows: matched,
      printedRows: printedCount,
      failedRows: failedCount,
      unmatchedRows: unmatched,
      errorReportFsFileId,
      fsFileId,
    });
  }

  async listImports(batchId: string): Promise<PrintResultImportDao[]> {
    await this.assertBatchExists(batchId);
    const rows = await this.imports.find({
      where: { batchId },
      order: { createdAt: 'DESC' },
    });
    return Promise.all(rows.map((r) => this.toDao(r)));
  }

  async getImport(
    batchId: string,
    importId: string,
  ): Promise<PrintResultImportDao> {
    await this.assertBatchExists(batchId);
    const row = await this.imports.findOne({
      where: { id: importId, batchId },
    });
    if (!row)
      throw new NotFoundException('Không tìm thấy lần upload kết quả in');
    return this.toDao(row);
  }

  async buildTemplate(): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Ket qua in');
    sheet.addRow(['Mã SV', 'Tình trạng', 'Ghi chú']);
    sheet.addRow(['SV001', 'Đã in', '']);
    sheet.addRow(['SV002', 'Lỗi', 'Kẹt giấy']);
    return Buffer.from(await workbook.xlsx.writeBuffer());
  }

  private async assertBatchExists(batchId: string): Promise<void> {
    const exists = await this.batches.exist({ where: { id: batchId } });
    if (!exists) throw new NotFoundException('Không tìm thấy đợt in');
  }

  private async toDao(row: PrintResultImport): Promise<PrintResultImportDao> {
    const dao = new PrintResultImportDao();
    dao.id = row.id;
    dao.batchId = row.batchId;
    dao.fileName = row.fileName;
    dao.uploadedByUserId = row.uploadedByUserId ?? null;
    dao.status = row.status;
    dao.totalRows = row.totalRows;
    dao.matchedRows = row.matchedRows;
    dao.printedRows = row.printedRows;
    dao.failedRows = row.failedRows;
    dao.unmatchedRows = row.unmatchedRows;
    dao.failureReason = row.failureReason ?? null;
    dao.createdAt = row.createdAt;
    if (row.errorReportFsFileId) {
      try {
        const link = await this.fileStorage.issueViewLink(
          row.errorReportFsFileId,
          row.uploadedByUserId ?? 'system',
        );
        dao.errorReportUrl = link.url;
      } catch {
        dao.errorReportUrl = null;
      }
    }
    return dao;
  }

  private async parseWorkbook(buffer: Buffer): Promise<ParsedResultRow[]> {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(
      buffer as unknown as Parameters<typeof workbook.xlsx.load>[0],
    );
    const sheet = workbook.worksheets[0];
    if (!sheet) throw new Error('File không có sheet nào');

    const headerRow = sheet.getRow(1);
    const columnByField: Partial<Record<ResultFieldKey, number>> = {};
    headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      const text = this.cellToString(cell.value);
      if (!text) return;
      const field = NORMALIZED_HEADER_ALIASES[normalizeText(text)];
      if (field && columnByField[field] === undefined) {
        columnByField[field] = colNumber;
      }
    });

    const missingRequired = REQUIRED_FIELDS.filter(
      (f) => columnByField[f] === undefined,
    );
    if (missingRequired.length > 0) {
      throw new Error(
        `Không tìm thấy cột bắt buộc trong dòng tiêu đề: ${missingRequired.join(', ')}`,
      );
    }

    const rows: ParsedResultRow[] = [];
    for (let r = 2; r <= sheet.rowCount; r++) {
      const excelRow = sheet.getRow(r);
      if (excelRow.cellCount === 0) continue;
      const get = (field: ResultFieldKey): string | null => {
        const col = columnByField[field];
        return col === undefined
          ? null
          : this.cellToString(excelRow.getCell(col).value);
      };
      const subjectCode = get('subjectCode');
      const printStatus = get('printStatus');
      if (!subjectCode && !printStatus) continue; // fully blank row
      rows.push({
        rowNo: r,
        subjectCode,
        printStatus,
        errorReason: get('errorReason'),
      });
    }
    return rows;
  }

  private cellToString(value: ExcelJS.CellValue): string | null {
    if (value == null) return null;
    if (typeof value === 'object') {
      if (value instanceof Date) return value.toISOString();
      if ('text' in value)
        return String((value as { text: unknown }).text).trim() || null;
      if ('result' in value) {
        return String((value as { result: unknown }).result).trim() || null;
      }
      return null;
    }
    const text = String(value).trim();
    return text || null;
  }

  private async buildErrorReport(
    rows: Array<{ rowNo: number; subjectCode: string | null; reason: string }>,
  ): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Lỗi');
    sheet.addRow(['Dòng', 'Mã SV', 'Lý do']);
    for (const row of rows) {
      sheet.addRow([row.rowNo, row.subjectCode ?? '', row.reason]);
    }
    return Buffer.from(await workbook.xlsx.writeBuffer());
  }
}
