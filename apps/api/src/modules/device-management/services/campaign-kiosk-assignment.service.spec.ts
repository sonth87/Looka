import { Campaign } from '../entities/campaign.entity';
import { CampaignKioskAssignment } from '../entities/campaign-kiosk-assignment.entity';
import { Device } from '../entities/device.entity';
import { CampaignKioskAssignmentService } from './campaign-kiosk-assignment.service';

/**
 * `assign()`'s two writes (the assignment row itself, then the
 * auto-approved `campaign_members` upsert) used to run as two separate,
 * unwrapped statements — a failure between them could leave a kiosk
 * assigned with no corresponding approved membership row (2026-09-16
 * database audit, §3.2). A fake `EntityManager` can't prove Postgres
 * actually rolls both back together, but it does prove the structural fix:
 * both writes now happen from inside exactly one `dataSource.transaction()`
 * call, through the manager that transaction hands back — not through the
 * base (non-transactional) repositories directly.
 *
 * Fakes stay typed as plain object shapes (not cast to their real
 * class/interface until the `new CampaignKioskAssignmentService(...)` call
 * site) — same convention `campaign-member.guard.spec.ts` already uses —
 * so `expect(x.method)...` reads a `jest.Mock`-typed property instead of a
 * real class method, which is what `@typescript-eslint/unbound-method`
 * would otherwise flag.
 */
function fakeInsertQueryBuilder() {
  const execute = jest.fn().mockResolvedValue(undefined);
  const orUpdate = jest.fn(() => ({ execute }));
  const values = jest.fn(() => ({ orUpdate }));
  const into = jest.fn(() => ({ values }));
  const insert = jest.fn(() => ({ into }));
  return { insert, execute, orUpdate, values, into };
}

function fakeManager() {
  const savedViaManager: unknown[] = [];
  const repoLike = {
    save: jest.fn((entity: unknown) => {
      savedViaManager.push(entity);
      return Promise.resolve(entity);
    }),
  };
  const qb = fakeInsertQueryBuilder();
  return {
    withRepository: jest.fn(() => repoLike),
    createQueryBuilder: jest.fn(() => qb),
    savedViaManager,
    qb,
  };
}

function fakeDataSource() {
  const manager = fakeManager();
  const transaction = jest.fn((fn: (manager: unknown) => Promise<unknown>) =>
    fn(manager),
  );
  return { transaction, manager };
}

const CAMPAIGN = { id: 'campaign-1' } as Campaign;
const DEVICE = { id: 'device-1', campaignId: 'campaign-1' } as Device;

function buildService(
  dataSource: ReturnType<typeof fakeDataSource>,
  existingAssignment: CampaignKioskAssignment | null,
) {
  const repository = {
    findOne: jest.fn().mockResolvedValue(existingAssignment),
    find: jest.fn().mockResolvedValue([]),
    create: jest.fn((data: unknown) => data),
  };
  const deviceRepository = {
    find: jest.fn().mockResolvedValue([DEVICE]),
    findOne: jest.fn().mockResolvedValue(DEVICE),
  };
  const userRepository = { find: jest.fn().mockResolvedValue([]) };
  const campaignMemberRepository = {};
  const campaignService = {
    findCampaignEntityOrFail: jest.fn().mockResolvedValue(CAMPAIGN),
  };

  return new CampaignKioskAssignmentService(
    repository as never,
    deviceRepository as never,
    userRepository as never,
    campaignMemberRepository as never,
    dataSource as never,
    campaignService as never,
  );
}

describe('CampaignKioskAssignmentService.assign — transactional write (2026-09-16 database audit §3.2)', () => {
  it('a brand-new assignment: both the assignment row and the campaign_members upsert happen inside the SAME transaction call', async () => {
    const dataSource = fakeDataSource();
    const service = buildService(dataSource, null);

    await service.assign(
      'campaign-1',
      'device-1',
      { userId: 'user-1' },
      'admin-1',
    );

    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    // The assignment write went through the transaction's manager
    // (`saveWithTransaction`/`createWithTransaction`), not a bare
    // `this.repository.save()` outside it.
    expect(dataSource.manager.withRepository).toHaveBeenCalled();
    expect(dataSource.manager.savedViaManager).toHaveLength(1);
    // The membership upsert used the SAME manager's query builder, inside
    // the same transaction call — not `campaignMemberRepository` directly.
    expect(dataSource.manager.createQueryBuilder).toHaveBeenCalledTimes(1);
    expect(dataSource.manager.qb.execute).toHaveBeenCalledTimes(1);
  });

  it('re-assigning an existing row (update path) also runs both writes through the one transaction', async () => {
    const dataSource = fakeDataSource();
    const existing = {
      id: 'assignment-1',
      campaignId: 'campaign-1',
      deviceId: 'device-1',
      userId: 'old-user',
    } as CampaignKioskAssignment;
    const service = buildService(dataSource, existing);

    await service.assign(
      'campaign-1',
      'device-1',
      { userId: 'user-2' },
      'admin-1',
    );

    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    expect(dataSource.manager.savedViaManager).toEqual([
      expect.objectContaining({ id: 'assignment-1', userId: 'user-2' }),
    ]);
    expect(dataSource.manager.qb.execute).toHaveBeenCalledTimes(1);
  });
});
