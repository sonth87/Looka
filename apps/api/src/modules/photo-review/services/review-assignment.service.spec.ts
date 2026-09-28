import { QueryFailedError } from 'typeorm';
import { ReviewAssignment } from '../entities/review-assignment.entity';
import { PHOTO_REVIEW_ERROR_CODE } from '../photo-review.constants';
import {
  ReviewAssignmentService,
  ScopeTarget,
} from './review-assignment.service';

/** `CustomException.payload` only carries `{ error, code }` (no HTTP status) — see that class's own constructor; assert on the module's own error CODE instead of trying to read an HTTP status off the payload. */
const OUT_OF_SCOPE = {
  payload: { code: PHOTO_REVIEW_ERROR_CODE.OUT_OF_SCOPE },
};
const INVALID_GROUP_FIELD = {
  payload: { code: PHOTO_REVIEW_ERROR_CODE.INVALID_GROUP_FIELD },
};

/**
 * Fakes are kept typed as plain object shapes (not cast to their real
 * class/interface until the `new ReviewAssignmentService(...)` call site) —
 * same convention `print-item.service.spec.ts` already uses.
 */
function fakeRepo(rows: Partial<ReviewAssignment>[] = []) {
  return {
    find: jest.fn().mockResolvedValue(rows),
    findOne: jest.fn(),
    save: jest.fn(),
    create: jest.fn((x: unknown) => x),
    delete: jest.fn(),
  };
}

/**
 * `dataSource.query` is dispatched by a substring match on the SQL text,
 * covering every raw query this service issues (`is_admin` lookup,
 * `batchResolveUserInfo`, `batchResolveCampaignNames`, `groupValues`,
 * `listReviewers`) — good enough for these unit tests, which never assert
 * on exact SQL text for those helper lookups (only `buildScopeFilter`'s own
 * SQL fragment, built in-process with no DB round trip, is asserted on
 * directly).
 */
function fakeDataSource(opts: { isAdmin?: boolean } = {}) {
  const query = jest.fn((sql: string) => {
    if (sql.includes('is_admin')) {
      return Promise.resolve([{ is_admin: opts.isAdmin ?? false }]);
    }
    if (sql.includes('FROM campaigns')) {
      return Promise.resolve([{ id: 'c1', name: 'Campaign 1' }]);
    }
    if (sql.includes('FROM users')) {
      return Promise.resolve([
        {
          id: 'u1',
          name: 'User One',
          email: 'u1@example.com',
          department: null,
          faculty: null,
          roleCodes: [],
        },
      ]);
    }
    return Promise.resolve([]);
  });
  return { query, transaction: jest.fn() };
}

function makeService(
  rows: Partial<ReviewAssignment>[],
  opts: { isAdmin?: boolean } = {},
) {
  const repo = fakeRepo(rows);
  const dataSource = fakeDataSource(opts);
  const service = new ReviewAssignmentService(
    repo as never,
    dataSource as never,
  );
  return { service, repo, dataSource };
}

const TARGET_C1: ScopeTarget = {
  campaignId: 'c1',
  className: '12A1',
  faculty: 'CNTT',
  major: null,
};

describe('ReviewAssignmentService — per-campaign scope (2026-09-28 pivot)', () => {
  describe('assertInScope', () => {
    it('a whole-campaign row (groupField/groupValue both null) grants access to any group within that campaign', async () => {
      const { service } = makeService([
        { campaignId: 'c1', groupField: null, groupValue: null },
      ]);
      await expect(
        service.assertInScope('u1', TARGET_C1),
      ).resolves.toBeUndefined();
    });

    it('a group row in the campaign grants access when the field value matches', async () => {
      const { service } = makeService([
        { campaignId: 'c1', groupField: 'faculty', groupValue: 'CNTT' },
      ]);
      await expect(
        service.assertInScope('u1', TARGET_C1),
      ).resolves.toBeUndefined();
    });

    it('a group row in the campaign REJECTS when the field value does not match', async () => {
      const { service } = makeService([
        { campaignId: 'c1', groupField: 'faculty', groupValue: 'Khoa khác' },
      ]);
      await expect(
        service.assertInScope('u1', TARGET_C1),
      ).rejects.toMatchObject(OUT_OF_SCOPE);
    });

    it('the SAME group grant in a DIFFERENT campaign does not grant access', async () => {
      const { service } = makeService([
        { campaignId: 'c2', groupField: 'faculty', groupValue: 'CNTT' },
      ]);
      await expect(
        service.assertInScope('u1', TARGET_C1),
      ).rejects.toMatchObject(OUT_OF_SCOPE);
    });

    it('a REVIEWER with zero rows anywhere sees nothing (strict — old "0 rows = unrestricted" rule is gone)', async () => {
      const { service } = makeService([]);
      await expect(
        service.assertInScope('u1', TARGET_C1),
      ).rejects.toMatchObject(OUT_OF_SCOPE);
    });

    it('an admin is unrestricted regardless of rows', async () => {
      const { service, repo } = makeService([], { isAdmin: true });
      await expect(
        service.assertInScope('admin1', TARGET_C1),
      ).resolves.toBeUndefined();
      // isAdmin short-circuits BEFORE the allowed-rows check, but resolveActor
      // still fetches rows in the same round trip — assert it did not need
      // any row to exist to pass.
      expect(repo.find).toHaveBeenCalledWith({ where: { userId: 'admin1' } });
    });

    it('a null actorUserId (internal re-fetch after an already-checked mutation) is treated as unrestricted, no DB call', async () => {
      const { service, repo, dataSource } = makeService([]);
      await expect(
        service.assertInScope(null, TARGET_C1),
      ).resolves.toBeUndefined();
      expect(repo.find).not.toHaveBeenCalled();
      expect(dataSource.query).not.toHaveBeenCalled();
    });
  });

  describe('buildScopeFilter', () => {
    it('returns null for an admin (no SQL filter needed)', async () => {
      const { service } = makeService([], { isAdmin: true });
      await expect(service.buildScopeFilter('admin1', 0)).resolves.toBeNull();
    });

    it('returns a never-true filter for a non-admin with zero rows', async () => {
      const { service } = makeService([]);
      await expect(service.buildScopeFilter('u1', 0)).resolves.toEqual({
        sql: '1=0',
        params: [],
      });
    });

    it('builds the correct SQL/params shape for a mix of whole-campaign and group rows, continuing $N from paramOffset', async () => {
      const { service } = makeService([
        { campaignId: 'c1', groupField: null, groupValue: null },
        { campaignId: 'c2', groupField: 'className', groupValue: '12A1' },
      ]);
      const result = await service.buildScopeFilter('u1', 2);
      expect(result).toEqual({
        sql: '(s.campaign_id = $3 OR (s.campaign_id = $4 AND s.class_name = $5))',
        params: ['c1', 'c2', '12A1'],
      });
    });
  });

  describe('assertWholeCampaignAccess (stats/aggregate endpoints)', () => {
    it('admin passes with no campaignId', async () => {
      const { service } = makeService([], { isAdmin: true });
      await expect(
        service.assertWholeCampaignAccess('admin1', undefined),
      ).resolves.toBeUndefined();
    });

    it('non-admin with a whole-campaign row for the requested campaign passes', async () => {
      const { service } = makeService([
        { campaignId: 'c1', groupField: null, groupValue: null },
      ]);
      await expect(
        service.assertWholeCampaignAccess('u1', 'c1'),
      ).resolves.toBeUndefined();
    });

    it('non-admin with only a GROUP row for the campaign is rejected (cannot safely scope an aggregate)', async () => {
      const { service } = makeService([
        { campaignId: 'c1', groupField: 'faculty', groupValue: 'CNTT' },
      ]);
      await expect(
        service.assertWholeCampaignAccess('u1', 'c1'),
      ).rejects.toMatchObject(OUT_OF_SCOPE);
    });

    it('non-admin with no campaignId at all is rejected (no "all campaigns" aggregate view)', async () => {
      const { service } = makeService([
        { campaignId: 'c1', groupField: null, groupValue: null },
      ]);
      await expect(
        service.assertWholeCampaignAccess('u1', undefined),
      ).rejects.toMatchObject(OUT_OF_SCOPE);
    });
  });

  describe('create — auto-grant + idempotent duplicate', () => {
    function fakeManager(savedRow: Partial<ReviewAssignment>) {
      const repo = {
        create: jest.fn((x: unknown) => x),
        save: jest.fn().mockResolvedValue(savedRow),
      };
      return {
        getRepository: jest.fn().mockReturnValue(repo),
        query: jest.fn().mockResolvedValue(undefined),
      };
    }

    it('creating an assignment auto-grants the REVIEWER role in the same transaction', async () => {
      const { service, dataSource } = makeService([]);
      const savedRow: Partial<ReviewAssignment> = {
        id: 'ra1',
        userId: 'u1',
        campaignId: 'c1',
        groupField: null,
        groupValue: null,
        createdByUserId: null,
        createdAt: new Date(),
      };
      const manager = fakeManager(savedRow);
      dataSource.transaction.mockImplementation((cb: (m: unknown) => unknown) =>
        cb(manager),
      );

      const dto = { userId: 'u1', campaignId: 'c1' } as never;
      await service.create(dto, 'admin1');

      expect(manager.query).toHaveBeenCalledWith(
        expect.stringContaining('REVIEWER'),
        ['u1'],
      );
    });

    it('re-granting the same (user, campaign, group) is a harmless no-op — returns the existing row, no error surfaced', async () => {
      const { service, repo, dataSource } = makeService([]);
      const existing: Partial<ReviewAssignment> = {
        id: 'ra-existing',
        userId: 'u1',
        campaignId: 'c1',
        groupField: null,
        groupValue: null,
        createdByUserId: 'admin1',
        createdAt: new Date(),
      };
      dataSource.transaction.mockImplementation(() => {
        throw new QueryFailedError(
          'INSERT INTO review_assignments ...',
          [],
          new Error('duplicate key value violates unique constraint'),
        );
      });
      repo.findOne.mockResolvedValue(existing);

      const dto = { userId: 'u1', campaignId: 'c1' } as never;
      const result = await service.create(dto, 'admin1');

      expect(result.id).toBe('ra-existing');
      expect(repo.findOne).toHaveBeenCalled();
    });

    it('rejects groupField without groupValue (and vice versa) before ever touching the transaction', async () => {
      const { service, dataSource } = makeService([]);
      const dto = {
        userId: 'u1',
        campaignId: 'c1',
        groupField: 'faculty',
      } as never;
      await expect(service.create(dto, 'admin1')).rejects.toMatchObject(
        INVALID_GROUP_FIELD,
      );
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });
  });
});
