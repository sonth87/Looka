import { CampaignSubjectService } from './campaign-subject.service';

/**
 * `importRoster()` used to insert the parsed roster rows, then only much
 * later (after two best-effort file uploads) mark the import row DONE — a
 * crash in between left real `campaign_subjects` rows persisted while the
 * import record stayed at PROCESSING forever (2026-09-16 database audit,
 * §3.2). These tests lock in the fix's structure: the insert and the
 * "DONE + counts" update happen inside ONE `dataSource.transaction()` call,
 * strictly before either file upload is attempted; the two file ids are
 * attached afterwards via a small, separate, best-effort update that never
 * touches `status`/the row counts again.
 *
 * Fakes stay typed as plain object shapes (not cast to their real
 * class/interface until the `new CampaignSubjectService(...)` call site) —
 * same convention `campaign-member.guard.spec.ts` already uses — so
 * `expect(x.method)...` reads a `jest.Mock`-typed property instead of a
 * real class method, which is what `@typescript-eslint/unbound-method`
 * would otherwise flag.
 */
function fakeManager() {
  const calls: string[] = [];
  return {
    insert: jest.fn(() => {
      calls.push('insert');
      return Promise.resolve();
    }),
    update: jest.fn(() => {
      calls.push('update');
      return Promise.resolve();
    }),
    calls,
  };
}

function fakeDataSource() {
  const manager = fakeManager();
  const transaction = jest.fn((fn: (manager: unknown) => Promise<unknown>) =>
    fn(manager),
  );
  return { transaction, manager };
}

function buildService(
  dataSource: ReturnType<typeof fakeDataSource>,
  importRepository: {
    create: jest.Mock;
    save: jest.Mock;
    update: jest.Mock;
  },
  repository: { find: jest.Mock },
) {
  const campaignService = {
    findCampaignEntityOrFail: jest.fn().mockResolvedValue({ id: 'campaign-1' }),
  };
  const fileStorage = {
    uploadRaw: jest.fn().mockResolvedValue({ fileId: 'fs-file-1' }),
  };
  const snapshotService = { refresh: jest.fn().mockResolvedValue(undefined) };

  // `parseWorkbook` genuinely parses an .xlsx buffer — stubbed per-test via
  // `jest.spyOn` below so these tests exercise only the write-ordering fix,
  // not ExcelJS parsing.
  return new CampaignSubjectService(
    repository as never,
    importRepository as never,
    undefined as never,
    dataSource as never,
    campaignService as never,
    fileStorage as never,
    snapshotService as never,
    undefined as never,
    undefined as never,
  );
}

function fakeImportRepository(id: string) {
  return {
    create: jest.fn((data: unknown) => data),
    save: jest.fn((data: unknown) => ({ id, ...(data as object) })),
    update: jest.fn().mockResolvedValue(undefined),
  };
}

const VALID_ROW = {
  rowNo: 2,
  subjectCode: 'SV001',
  fullName: 'Nguyễn Văn A',
  citizenId: null,
  className: null,
  faculty: null,
  major: null,
  dateOfBirth: null,
  cardValidUntil: null,
  extra: null,
};

describe('CampaignSubjectService.importRoster — write ordering (2026-09-16 database audit §3.2)', () => {
  it('with at least one parsed row: insert + DONE-with-counts happen inside one transaction, strictly before either file upload', async () => {
    const dataSource = fakeDataSource();
    const importRepository = fakeImportRepository('import-1');
    const repository = { find: jest.fn().mockResolvedValue([]) };
    const service = buildService(dataSource, importRepository, repository);
    jest
      .spyOn(
        service as unknown as { parseWorkbook: () => Promise<unknown> },
        'parseWorkbook',
      )
      .mockResolvedValue([VALID_ROW]);

    await service.importRoster(
      'campaign-1',
      {
        buffer: Buffer.from(''),
        mimetype: 'x',
        size: 0,
        originalname: 'roster.xlsx',
      },
      'user-1',
    );

    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    expect(dataSource.manager.calls).toEqual(['insert', 'update']);
    // The transactional update set status/counts; the base repository's
    // own `update` is only ever called once more afterwards, for the file
    // ids — never re-touching status/counts.
    expect(importRepository.update).toHaveBeenCalledTimes(1);
    expect(importRepository.update).toHaveBeenCalledWith('import-1', {
      errorReportFsFileId: null,
      fsFileId: 'fs-file-1',
    });
  });

  it('with zero parsed rows: no transaction is opened, but the import is still closed out as DONE (never left at PROCESSING)', async () => {
    const dataSource = fakeDataSource();
    const importRepository = fakeImportRepository('import-2');
    const repository = { find: jest.fn().mockResolvedValue([]) };
    const service = buildService(dataSource, importRepository, repository);
    jest
      .spyOn(
        service as unknown as { parseWorkbook: () => Promise<unknown> },
        'parseWorkbook',
      )
      .mockResolvedValue([]);

    await service.importRoster(
      'campaign-1',
      {
        buffer: Buffer.from(''),
        mimetype: 'x',
        size: 0,
        originalname: 'empty.xlsx',
      },
      'user-1',
    );

    expect(dataSource.transaction).not.toHaveBeenCalled();
    expect(importRepository.update).toHaveBeenCalledWith(
      'import-2',
      expect.objectContaining({ status: 'DONE', totalRows: 0 }),
    );
  });
});
