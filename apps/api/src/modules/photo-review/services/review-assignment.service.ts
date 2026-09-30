import { CustomException } from '@app/shared/errors/legacy';
import { toDao } from '@app/shared/http/to-dao.helper';
import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import {
  DataSource,
  EntityManager,
  FindOptionsWhere,
  IsNull,
  Repository,
} from 'typeorm';
import { QueryFailedError } from 'typeorm';
import { MyReviewCampaignDao, ReviewAssignmentDao, ReviewerDao } from '../dao';
import { CreateReviewAssignmentDto } from '../dto';
import { ReviewAssignment } from '../entities/review-assignment.entity';
import {
  PHOTO_REVIEW_ERROR_CODE,
  REVIEW_ASSIGNMENT_GROUP_FIELDS,
} from '../photo-review.constants';

/** Minimal shape this service needs from a `SubjectPhotoSet` to check scope. */
export interface ScopeTarget {
  campaignId: string;
  className?: string | null;
  faculty?: string | null;
  major?: string | null;
}

/**
 * The 403 for a reviewer acting outside their assigned campaign/group. One
 * factory so the single-set routes (`assertInScope`) and the bulk decision
 * path (`PhotoReviewService.decideMany`, which evaluates the scope predicate
 * itself) can never report different text or codes for the same refusal.
 */
export function outOfScopeError(): CustomException {
  return new CustomException(
    'Bạn không được phân công duyệt đợt/nhóm của hồ sơ này',
    PHOTO_REVIEW_ERROR_CODE.OUT_OF_SCOPE,
    HttpStatus.FORBIDDEN,
  );
}

/** What `resolveActor` needs to decide access for one caller. */
interface ActorScope {
  isAdmin: boolean;
  rows: ReviewAssignment[];
}

/**
 * "Ai được duyệt đợt/nhóm nào" (plan §5.2, feature 13; PER-CAMPAIGN pivot
 * 2026-09-28 — see `ReviewAssignment`'s own doc comment and migration
 * `1838000000000-ReviewAssignmentsPerCampaign.ts` for the full history).
 *
 * **Access rule**, for a non-admin actor on a target `(campaignId,
 * className?, faculty?, major?)`: allowed iff they hold a whole-campaign row
 * (`groupField`/`groupValue` both `NULL`) for that `campaignId`, OR a group
 * row for that `campaignId` whose `groupField` value equals the target's
 * corresponding column. A user with ZERO rows for a campaign sees NOTHING
 * in it — this table is the SOLE gate now, not just a narrowing filter (the
 * old "0 rows = unrestricted" rule is gone). `users.is_admin` always
 * bypasses this table entirely, checked fresh on every call via
 * `resolveActor` (this table intentionally holds no rows for admins).
 *
 * `ReviewerRoleGuard` (route-level "is this person a reviewer at all") is a
 * separate, still-required earlier gate — unaffected by any of this.
 */
@Injectable()
export class ReviewAssignmentService {
  constructor(
    @InjectRepository(ReviewAssignment)
    private readonly repository: Repository<ReviewAssignment>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  async list(
    userId?: string,
    campaignId?: string,
  ): Promise<ReviewAssignmentDao[]> {
    const where: FindOptionsWhere<ReviewAssignment> = {};
    if (userId) where.userId = userId;
    if (campaignId) where.campaignId = campaignId;
    const rows = await this.repository.find({
      where,
      order: { createdAt: 'DESC' },
    });
    const [infoMap, campaignMap] = await Promise.all([
      this.batchResolveUserInfo(rows.map((r) => r.userId)),
      this.batchResolveCampaignNames(rows.map((r) => r.campaignId)),
    ]);
    return toDao(
      ReviewAssignmentDao,
      rows.map((r) =>
        this.toRowDao(r, infoMap.get(r.userId), campaignMap.get(r.campaignId)),
      ),
    );
  }

  /**
   * Both-or-neither on `groupField`/`groupValue` — `CreateReviewAssignmentDto`
   * itself only validates each field's own shape (class-validator has no
   * convenient way to express "these two together or neither" for a plain
   * DTO here), so this is checked in-service instead, same as this module's
   * existing preference for a plain check over a custom validator for a
   * two-field relationship (see that DTO's own doc comment).
   */
  private assertValidGroupPair(dto: CreateReviewAssignmentDto): void {
    if (Boolean(dto.groupField) !== Boolean(dto.groupValue)) {
      throw new CustomException(
        'groupField and groupValue must be provided together, or both omitted for whole-campaign access',
        PHOTO_REVIEW_ERROR_CODE.INVALID_GROUP_FIELD,
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  /**
   * Creating an assignment auto-grants the `REVIEWER` role (plan decision
   * 2026-09-28, §3) in the SAME transaction as the row insert — a person
   * assigned a campaign must actually be able to reach the review UI at
   * all, and doing both atomically means there is never a moment where the
   * assignment row exists but `ReviewerRoleGuard` would still reject them.
   * Removing an assignment later does NOT revoke the role (see
   * `remove`/`revokeReviewer`'s own doc comments) — only an explicit
   * "Gỡ quyền" does that.
   */
  async create(
    dto: CreateReviewAssignmentDto,
    actorUserId: string | null,
  ): Promise<ReviewAssignmentDao> {
    this.assertValidGroupPair(dto);
    const groupField = dto.groupField ?? null;
    const groupValue = dto.groupValue ?? null;

    let created: ReviewAssignment;
    try {
      created = await this.dataSource.transaction(async (manager) => {
        const repo = manager.getRepository(ReviewAssignment);
        const row = await repo.save(
          repo.create({
            userId: dto.userId,
            campaignId: dto.campaignId,
            groupField,
            groupValue,
            createdByUserId: actorUserId,
          }),
        );
        await this.grantReviewerTx(manager, dto.userId);
        return row;
      });
    } catch (error) {
      // UQ_review_assignments_user_campaign_field_value — re-granting the
      // same thing to the same person is a harmless no-op, not an error the
      // CMS needs to surface; return the existing row instead of a 409.
      if (error instanceof QueryFailedError) {
        const existing = await this.repository.findOne({
          where: {
            userId: dto.userId,
            campaignId: dto.campaignId,
            groupField: groupField ?? IsNull(),
            groupValue: groupValue ?? IsNull(),
          },
        });
        if (existing) {
          created = existing;
        } else {
          throw error;
        }
      } else {
        throw error;
      }
    }

    const [info, campaignName] = await Promise.all([
      this.batchResolveUserInfo([created.userId]).then((m) =>
        m.get(created.userId),
      ),
      this.resolveCampaignName(created.campaignId),
    ]);
    return toDao(
      ReviewAssignmentDao,
      this.toRowDao(created, info, campaignName),
    );
  }

  async remove(id: string): Promise<void> {
    await this.repository.delete({ id });
  }

  /**
   * "Người có quyền duyệt" (2026-09-22 — replaces the old scoped-only
   * "Thêm phân công" add-flow) — every user whose `users.roles` jsonb array
   * contains `'REVIEWER'` (the same flag `ReviewerRoleGuard` checks), i.e.
   * everyone with the ROLE at all. Distinct from `list()` above, which reads
   * `review_assignments` rows (per-campaign grants) — a person can appear in
   * neither, either, or both lists; since 2026-09-28 a REVIEWER-role user
   * with zero assignment rows sees nothing anywhere (see this class's own
   * top doc comment), so this list is no longer "who is unrestricted", just
   * "who holds the role at all" (a prerequisite, not a guarantee of access).
   */
  async listReviewers(): Promise<ReviewerDao[]> {
    const rows: Array<{
      id: string;
      name: string | null;
      email: string;
      department: string | null;
      faculty: string | null;
      roleCodes: string[];
    }> = await this.dataSource.query(`
      SELECT u.id, COALESCE(u.display_name, u.email) AS name, u.email, u.department, u.faculty,
        COALESCE(
          (SELECT array_agg(r.code ORDER BY r.code) FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = u.id),
          ARRAY[]::text[]
        ) AS "roleCodes"
      FROM users u
      WHERE u.roles @> '["REVIEWER"]'::jsonb
      ORDER BY name
    `);
    return toDao(
      ReviewerDao,
      rows.map((r) => ({
        userId: r.id,
        userName: r.name ?? undefined,
        userEmail: r.email,
        userDepartment: r.department,
        userFaculty: r.faculty,
        userRoleCodes: r.roleCodes,
      })),
    );
  }

  /** Idempotent — adding `'REVIEWER'` to a user who already has it is a no-op. */
  async grantReviewer(userId: string): Promise<void> {
    await this.dataSource.transaction((manager) =>
      this.grantReviewerTx(manager, userId),
    );
  }

  private async grantReviewerTx(
    manager: EntityManager,
    userId: string,
  ): Promise<void> {
    await manager.query(
      `UPDATE users SET roles = CASE WHEN roles @> '["REVIEWER"]'::jsonb THEN roles ELSE roles || '["REVIEWER"]'::jsonb END WHERE id = $1`,
      [userId],
    );
  }

  /** Removes only the `'REVIEWER'` tag — any other app-role tag a user might hold stays untouched. */
  async revokeReviewer(userId: string): Promise<void> {
    await this.dataSource.query(
      `UPDATE users SET roles = COALESCE(
         (SELECT jsonb_agg(elem) FROM jsonb_array_elements(roles) elem WHERE elem <> '"REVIEWER"'),
         '[]'::jsonb
       ) WHERE id = $1`,
      [userId],
    );
  }

  /**
   * Distinct non-null values of one `SubjectPhotoSet` roster column, for the
   * CMS assignment picker's group-value dropdown. `campaignId` (2026-09-28)
   * scopes the query to one campaign's own roster — the CMS always supplies
   * it now that every assignment requires picking a campaign first; left
   * optional (global, same as before) for backward compatibility.
   */
  async groupValues(
    field: (typeof REVIEW_ASSIGNMENT_GROUP_FIELDS)[number],
    campaignId?: string,
  ): Promise<string[]> {
    const column = {
      className: 'class_name',
      faculty: 'faculty',
      major: 'major',
    }[field];
    const rows: Array<{ value: string }> = await this.dataSource.query(
      `SELECT DISTINCT ${column} AS value FROM subject_photo_sets
        WHERE ${column} IS NOT NULL AND ($1::uuid IS NULL OR campaign_id = $1)
        ORDER BY value LIMIT 500`,
      [campaignId ?? null],
    );
    return rows.map((r) => r.value);
  }

  /**
   * `GET /v1/review/my-campaigns` (2026-09-28) — campaigns the calling
   * reviewer can act on at all: every campaign for an admin, or the
   * distinct campaigns they hold at least one row for otherwise. Feeds the
   * CMS review-list page's campaign dropdown so a scoped reviewer is never
   * offered a campaign they cannot see anything in — deliberately its own
   * lightweight endpoint rather than reusing `GET /v1/campaigns` (that one
   * needs no special permission today, but returns EVERY campaign
   * regardless of caller, which is the wrong list to show a scoped
   * reviewer).
   */
  async myCampaigns(
    actorUserId: string | null,
  ): Promise<MyReviewCampaignDao[]> {
    const { isAdmin, rows } = await this.resolveActor(actorUserId);
    if (isAdmin) {
      const campaigns: Array<{ id: string; name: string }> =
        await this.dataSource.query(
          `SELECT id, name FROM campaigns ORDER BY name`,
        );
      return toDao(
        MyReviewCampaignDao,
        campaigns.map((c) => ({ campaignId: c.id, campaignName: c.name })),
      );
    }
    const campaignIds = [...new Set(rows.map((r) => r.campaignId))];
    const nameMap = await this.batchResolveCampaignNames(campaignIds);
    const items = campaignIds
      .map((id) => ({ campaignId: id, campaignName: nameMap.get(id) }))
      .filter(
        (x): x is { campaignId: string; campaignName: string } =>
          !!x.campaignName,
      )
      .sort((a, b) => a.campaignName.localeCompare(b.campaignName));
    return toDao(MyReviewCampaignDao, items);
  }

  /**
   * Throws 403 if `actorUserId` is not admin and has no row (whole-campaign
   * or matching group) granting `target.campaignId`. A `null` actor (should
   * not happen behind `SsoAuthGuard`+`ReviewerRoleGuard`, but this module's
   * other methods type `actorUserId` as nullable throughout, and every
   * INTERNAL re-fetch after a mutation already checked scope earlier in the
   * same request — see e.g. `PhotoReviewService.setCurrent` calling
   * `getSetDetail` with no actor) is treated as unrestricted.
   */
  async assertInScope(
    actorUserId: string | null,
    target: ScopeTarget,
  ): Promise<void> {
    const inScope = await this.buildScopePredicate(actorUserId);
    if (!inScope(target)) throw outOfScopeError();
  }

  /**
   * Same rule as `assertInScope` (which is implemented on top of this, so the
   * two cannot drift), resolved ONCE for a whole batch: one `resolveActor`
   * round trip up front, then a synchronous per-target check. Bulk endpoints
   * (`PhotoReviewService.decideMany`) call this instead of `assertInScope`
   * per set, which would repeat the `is_admin` + assignments queries N times.
   * An admin or a null actor (see `assertInScope`) gets an always-true
   * predicate.
   *
   * The predicate is a SNAPSHOT of the actor's assignments taken now. It is
   * cheap and synchronous, so a long-running caller can (and
   * `decideMany`'s per-set write does) re-evaluate it against a FRESH copy of
   * the target under that target's row lock, but it will not notice an
   * assignment revoked after this call returned.
   */
  async buildScopePredicate(
    actorUserId: string | null,
  ): Promise<(target: ScopeTarget) => boolean> {
    const { isAdmin, rows } = await this.resolveActor(actorUserId);
    if (isAdmin) return () => true;
    return (target) => rows.some((r) => this.rowGrants(r, target));
  }

  /**
   * Throws 403 unless `actorUserId` is admin or holds a WHOLE-campaign row
   * (`groupField IS NULL`) for `campaignId` — used by endpoints that return
   * an aggregate over an entire campaign (`ReviewController.reviewStats`)
   * where a group-scoped grant cannot be safely honored: `stats_daily_review`
   * has no per-group breakdown to filter down to, so handing a group-scoped
   * reviewer the whole campaign's numbers would leak beyond their actual
   * scope. `campaignId` itself being absent is rejected the same way (a
   * non-admin has no "all campaigns" aggregate view).
   */
  async assertWholeCampaignAccess(
    actorUserId: string | null,
    campaignId: string | undefined,
  ): Promise<void> {
    const { isAdmin, rows } = await this.resolveActor(actorUserId);
    if (isAdmin) return;
    const allowed =
      !!campaignId &&
      rows.some((r) => r.campaignId === campaignId && r.groupField == null);
    if (!allowed) {
      throw new CustomException(
        'Bạn cần được phân công cả đợt chụp này để xem thống kê',
        PHOTO_REVIEW_ERROR_CODE.OUT_OF_SCOPE,
        HttpStatus.FORBIDDEN,
      );
    }
  }

  /**
   * SQL fragment + params for `PhotoReviewService.listSets`'s own
   * `conditions`/`params` arrays — `null` when `actorUserId` is admin (no
   * filter needed), `1=0` when they are a non-admin with zero rows anywhere
   * (strict: sees nothing, rather than the old "0 rows = unrestricted"),
   * else an OR-of-assignments fragment referencing table alias `s` (the
   * same alias `listSets` already uses for `subject_photo_sets`).
   * `paramOffset` is the number of params already pushed onto the caller's
   * array, so `$N` placeholders continue the same sequence.
   */
  async buildScopeFilter(
    actorUserId: string | null,
    paramOffset: number,
  ): Promise<{ sql: string; params: unknown[] } | null> {
    const { isAdmin, rows } = await this.resolveActor(actorUserId);
    if (isAdmin) return null;
    if (rows.length === 0) return { sql: '1=0', params: [] };

    const columnByField: Record<string, string> = {
      className: 's.class_name',
      faculty: 's.faculty',
      major: 's.major',
    };
    const clauses: string[] = [];
    const params: unknown[] = [];
    rows.forEach((r) => {
      if (r.groupField == null) {
        params.push(r.campaignId);
        clauses.push(`s.campaign_id = $${paramOffset + params.length}`);
      } else {
        params.push(r.campaignId, r.groupValue);
        const campaignParam = paramOffset + params.length - 1;
        const valueParam = paramOffset + params.length;
        clauses.push(
          `(s.campaign_id = $${campaignParam} AND ${columnByField[r.groupField]} = $${valueParam})`,
        );
      }
    });
    return { sql: `(${clauses.join(' OR ')})`, params };
  }

  private rowGrants(row: ReviewAssignment, target: ScopeTarget): boolean {
    if (row.campaignId !== target.campaignId) return false;
    if (row.groupField == null) return true;
    const value = target[row.groupField];
    return value != null && value === row.groupValue;
  }

  /**
   * One round trip covering both halves of "can this actor act at all":
   * `users.is_admin` (always bypasses this table) and their own
   * `review_assignments` rows. A `null` actorUserId short-circuits to
   * unrestricted without a query — see `assertInScope`'s own doc comment on
   * why a null actor is possible.
   */
  private async resolveActor(actorUserId: string | null): Promise<ActorScope> {
    if (!actorUserId) return { isAdmin: true, rows: [] };
    const [isAdmin, rows] = await Promise.all([
      this.queryIsAdmin(actorUserId),
      this.repository.find({ where: { userId: actorUserId } }),
    ]);
    return { isAdmin, rows };
  }

  /**
   * Broken out of `resolveActor` as its own method — purely so its return
   * type is a concrete `Promise<boolean>` rather than `Promise<any>`
   * (`dataSource.query` is untyped): `Promise.all` would otherwise infer
   * the WHOLE tuple as `any[]`, tripping `no-unsafe-assignment` on
   * `resolveActor`'s destructure. Same already-lint-clean pattern this
   * class's other raw-SQL helpers use (e.g. `groupValues`) — a `const` with
   * an explicit type annotation right on the `dataSource.query` call.
   */
  private async queryIsAdmin(userId: string): Promise<boolean> {
    const rows: Array<{ is_admin: boolean }> = await this.dataSource.query(
      `SELECT is_admin FROM users WHERE id = $1`,
      [userId],
    );
    return rows[0]?.is_admin === true;
  }

  private toRowDao(
    row: ReviewAssignment,
    info: UserInfo | undefined,
    campaignName: string | undefined,
  ) {
    return {
      id: row.id,
      userId: row.userId,
      userName: info?.name,
      userEmail: info?.email,
      userDepartment: info?.department,
      userFaculty: info?.faculty,
      userRoleCodes: info?.roleCodes ?? [],
      campaignId: row.campaignId,
      campaignName,
      groupField: row.groupField ?? undefined,
      groupValue: row.groupValue ?? undefined,
      createdByUserId: row.createdByUserId ?? undefined,
      createdAt: row.createdAt,
    };
  }

  private async resolveCampaignName(
    campaignId: string,
  ): Promise<string | undefined> {
    const map = await this.batchResolveCampaignNames([campaignId]);
    return map.get(campaignId);
  }

  private async batchResolveCampaignNames(
    campaignIds: string[],
  ): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    const unique = [...new Set(campaignIds)];
    if (unique.length === 0) return map;
    const rows: Array<{ id: string; name: string }> =
      await this.dataSource.query(
        `SELECT id, name FROM campaigns WHERE id = ANY($1)`,
        [unique],
      );
    for (const row of rows) map.set(row.id, row.name);
    return map;
  }

  /**
   * "Thông tin người dùng cần hiển thị nhiều hơn, khoa, nào, role gì" —
   * 2026-09-22. One batched lookup covering everything this module's
   * user-facing lists (`list`/`create`/`listReviewers`) show per person:
   * name/email/department/faculty straight off `users`, plus RBAC role
   * codes via the same `user_roles`/`roles` join `UserDirectoryReadRepository.
   * list` (identity module) already uses for the same "roleCodes" shape.
   */
  private async batchResolveUserInfo(
    userIds: string[],
  ): Promise<Map<string, UserInfo>> {
    const map = new Map<string, UserInfo>();
    const unique = [...new Set(userIds)];
    if (unique.length === 0) return map;
    const rows: Array<{
      id: string;
      name: string | null;
      email: string;
      department: string | null;
      faculty: string | null;
      roleCodes: string[];
    }> = await this.dataSource.query(
      `SELECT u.id, COALESCE(u.display_name, u.email) AS name, u.email, u.department, u.faculty,
         COALESCE(
           (SELECT array_agg(r.code ORDER BY r.code) FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = u.id),
           ARRAY[]::text[]
         ) AS "roleCodes"
       FROM users u WHERE u.id = ANY($1)`,
      [unique],
    );
    for (const row of rows) {
      map.set(row.id, {
        name: row.name ?? undefined,
        email: row.email,
        department: row.department,
        faculty: row.faculty,
        roleCodes: row.roleCodes,
      });
    }
    return map;
  }
}

interface UserInfo {
  name?: string;
  email: string;
  department: string | null;
  faculty: string | null;
  roleCodes: string[];
}
