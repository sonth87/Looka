import { PrintItem } from '../entities/print-item.entity';
import { PrintItemService } from './print-item.service';

/**
 * `list()`'s `operatorName` column — upload-identity-and-workflow-cleanup-
 * plan-2026-09-17.md §D.3.c ("In thẻ theo campaign"): `setId` →
 * `subject_photo_sets.source_session_id` → `sessions.operator_user_id` →
 * `users`, resolved via `resolveOperatorNames()` (cross-module raw SQL, same
 * convention as `CampaignService.bulkCapturedCounts`). Fakes stay typed as
 * plain object shapes (not cast to their real class/interface until the
 * `new PrintItemService(...)` call site) — same convention
 * `print-item.service.spec.ts` already uses.
 */
function fakeQueryBuilder(rows: PrintItem[], totalItems: number) {
  const qb: {
    andWhere: jest.Mock;
    addSelect: jest.Mock;
    orderBy: jest.Mock;
    addOrderBy: jest.Mock;
    skip: jest.Mock;
    take: jest.Mock;
    getManyAndCount: jest.Mock;
  } = {
    andWhere: jest.fn(),
    addSelect: jest.fn(),
    orderBy: jest.fn(),
    addOrderBy: jest.fn(),
    skip: jest.fn(),
    take: jest.fn(),
    getManyAndCount: jest.fn().mockResolvedValue([rows, totalItems]),
  };
  qb.andWhere.mockReturnValue(qb);
  qb.addSelect.mockReturnValue(qb);
  qb.orderBy.mockReturnValue(qb);
  qb.addOrderBy.mockReturnValue(qb);
  qb.skip.mockReturnValue(qb);
  qb.take.mockReturnValue(qb);
  return qb;
}

function fakeItemsRepo(qb: ReturnType<typeof fakeQueryBuilder>) {
  return { createQueryBuilder: jest.fn(() => qb) };
}

function fakeDataSource(
  operatorRows: Array<{ set_id: string; operator_name: string | null }>,
) {
  return { query: jest.fn().mockResolvedValue(operatorRows) };
}

function buildService(
  items: ReturnType<typeof fakeItemsRepo>,
  dataSource: ReturnType<typeof fakeDataSource>,
) {
  return new PrintItemService(
    items as never,
    undefined as never, // events
    undefined as never, // batches
    dataSource as never,
    undefined as never, // templateService
    undefined as never, // renderService
    undefined as never, // fileStorage
    undefined as never, // printStats
    undefined as never, // printerService
  );
}

function fakePrintItem(overrides: Partial<PrintItem>): PrintItem {
  return {
    id: 'item-1',
    batchId: null,
    campaignId: 'campaign-1',
    setId: 'set-1',
    variantId: 'variant-1',
    subjectCode: 'SV001',
    fullName: 'Nguyen Van A',
    className: 'CNTT01',
    faculty: 'CNTT',
    templateId: null,
    status: 'PENDING',
    printerId: null,
    printedAt: null,
    renderedAt: null,
    errorMessage: null,
    reprintOfItemId: null,
    createdAt: new Date('2026-09-17T00:00:00Z'),
    updatedAt: new Date('2026-09-17T00:00:00Z'),
    ...overrides,
  };
}

describe('PrintItemService.list — operatorName (plan §D.3.c)', () => {
  it('resolves operatorName per row via setId -> subject_photo_sets -> sessions -> users, batched in one query', async () => {
    const rows = [
      fakePrintItem({ id: 'item-1', setId: 'set-1' }),
      fakePrintItem({ id: 'item-2', setId: 'set-2' }),
    ];
    const qb = fakeQueryBuilder(rows, 2);
    const items = fakeItemsRepo(qb);
    const dataSource = fakeDataSource([
      { set_id: 'set-1', operator_name: 'Nguyễn Văn A' },
      { set_id: 'set-2', operator_name: null },
    ]);
    const service = buildService(items, dataSource);

    const result = await service.list({});

    expect(dataSource.query).toHaveBeenCalledTimes(1);
    const [sql, params] = dataSource.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('subject_photo_sets');
    expect(sql).toContain('source_session_id');
    expect(sql).toContain('operator_user_id');
    expect(sql).toContain('FROM subject_photo_sets sps');
    expect(sql).toContain(
      'LEFT JOIN sessions s ON s.id = sps.source_session_id',
    );
    expect(sql).toContain('LEFT JOIN users u ON u.id = s.operator_user_id');
    expect(params).toEqual([['set-1', 'set-2']]);

    expect(result.items[0].id).toBe('item-1');
    expect(result.items[0].operatorName).toBe('Nguyễn Văn A');
    expect(result.items[1].id).toBe('item-2');
    expect(result.items[1].operatorName).toBeNull();
  });

  it('never queries operator names when the page has no items', async () => {
    const qb = fakeQueryBuilder([], 0);
    const items = fakeItemsRepo(qb);
    const dataSource = fakeDataSource([]);
    const service = buildService(items, dataSource);

    const result = await service.list({});

    expect(dataSource.query).not.toHaveBeenCalled();
    expect(result.items).toEqual([]);
  });
});
