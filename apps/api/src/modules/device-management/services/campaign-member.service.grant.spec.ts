import { CampaignMemberService } from './campaign-member.service';

/**
 * Unit test for `CampaignMemberService.grant()` (2026-09-18 — replaces the
 * deleted `campaign_kiosk_assignments` auto-approve side effect, see that
 * method's own doc comment). Fakes stay plain object shapes cast with
 * `as never` at the constructor call site, same convention
 * `campaign-subject.service.import-roster.spec.ts` already uses — no real
 * Postgres needed since what's being checked is the SHAPE of the upsert
 * call (which columns get updated on conflict, which don't), not real SQL
 * conflict-resolution behaviour.
 */
function buildService(overrides: {
  findCampaignEntityOrFail?: jest.Mock;
  createQueryBuilder?: jest.Mock;
  find?: jest.Mock;
  userFind?: jest.Mock;
}) {
  const insertBuilder = {
    insert: jest.fn().mockReturnThis(),
    into: jest.fn().mockReturnThis(),
    values: jest.fn().mockReturnThis(),
    orUpdate: jest.fn().mockReturnThis(),
    execute: jest.fn().mockResolvedValue(undefined),
  };
  const createQueryBuilder =
    overrides.createQueryBuilder ?? jest.fn().mockReturnValue(insertBuilder);

  const repository = {
    createQueryBuilder,
    find: overrides.find ?? jest.fn().mockResolvedValue([]),
  };
  const userRepository = {
    find: overrides.userFind ?? jest.fn().mockResolvedValue([]),
  };
  const campaignService = {
    findCampaignEntityOrFail:
      overrides.findCampaignEntityOrFail ??
      jest.fn().mockResolvedValue({ id: 'campaign-1' }),
  };

  const service = new CampaignMemberService(
    repository as never,
    userRepository as never,
    campaignService as never,
  );
  return { service, insertBuilder, repository, campaignService };
}

describe('CampaignMemberService.grant', () => {
  it('404s when the campaign does not exist — never issues the upsert', async () => {
    const notFound = jest.fn().mockRejectedValue(new Error('not found'));
    const { service, insertBuilder } = buildService({
      findCampaignEntityOrFail: notFound,
    });

    await expect(
      service.grant('missing-campaign', { userIds: ['user-1'] }, 'admin-1'),
    ).rejects.toThrow('not found');
    expect(insertBuilder.insert).not.toHaveBeenCalled();
  });

  it('upserts one row per userId, all APPROVED, with a note marking this as a bulk grant', async () => {
    const { service, insertBuilder } = buildService({});

    await service.grant('campaign-1', { userIds: ['user-1', 'user-2'] }, 'admin-1');

    expect(insertBuilder.values).toHaveBeenCalledTimes(1);
    const values = insertBuilder.values.mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(values).toHaveLength(2);
    for (const row of values) {
      expect(row.status).toBe('APPROVED');
      expect(row.decidedByUserId).toBe('admin-1');
      expect(row.note).toBe('GRANTED');
    }
    expect(values.map((r) => r.userId)).toEqual(['user-1', 'user-2']);
    expect(values.every((r) => r.campaignId === 'campaign-1')).toBe(true);
  });

  it('only updates status/decidedAt/decidedByUserId/note on conflict — never requestedAt, so a re-grant does not clobber an existing row\'s original request time', async () => {
    const { service, insertBuilder } = buildService({});

    await service.grant('campaign-1', { userIds: ['user-1'] }, 'admin-1');

    expect(insertBuilder.orUpdate).toHaveBeenCalledWith(
      ['status', 'decided_at', 'decided_by_user_id', 'note'],
      ['campaign_id', 'user_id'],
    );
  });

  it('conflict target is (campaign_id, user_id) — idempotent per user per campaign, same call twice is safe', async () => {
    const { service, insertBuilder } = buildService({});

    await service.grant('campaign-1', { userIds: ['user-1'] }, 'admin-1');
    await service.grant('campaign-1', { userIds: ['user-1'] }, 'admin-1');

    expect(insertBuilder.execute).toHaveBeenCalledTimes(2);
    for (const call of insertBuilder.orUpdate.mock.calls) {
      expect(call[1]).toEqual(['campaign_id', 'user_id']);
    }
  });

  it('returns the granted rows re-read from the repository, with identity attached', async () => {
    const find = jest.fn().mockResolvedValue([
      {
        id: 'row-1',
        campaignId: 'campaign-1',
        userId: 'user-1',
        status: 'APPROVED',
      },
    ]);
    const userFind = jest.fn().mockResolvedValue([
      { id: 'user-1', email: 'a@dainam.edu.vn', displayName: 'Nguyễn A' },
    ]);
    const { service } = buildService({ find, userFind });

    const result = await service.grant('campaign-1', { userIds: ['user-1'] }, 'admin-1');

    expect(result).toHaveLength(1);
    expect(result[0].email).toBe('a@dainam.edu.vn');
    expect(result[0].displayName).toBe('Nguyễn A');
  });
});
