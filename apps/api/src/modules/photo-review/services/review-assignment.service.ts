import { CustomException } from '@app/shared/errors/legacy';
import { toDao } from '@app/shared/http/to-dao.helper';
import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { QueryFailedError } from 'typeorm';
import { ReviewAssignmentDao, ReviewerDao } from '../dao';
import { CreateReviewAssignmentDto } from '../dto';
import { ReviewAssignment } from '../entities/review-assignment.entity';
import {
  PHOTO_REVIEW_ERROR_CODE,
  REVIEW_ASSIGNMENT_GROUP_FIELDS,
} from '../photo-review.constants';

/** Minimal shape this service needs from a `SubjectPhotoSet` to check scope. */
export interface ScopeTarget {
  className?: string | null;
  faculty?: string | null;
  major?: string | null;
}

/**
 * "Ai được duyệt nhóm nào" (plan §5.2, feature 13). A user with ZERO rows
 * here is UNRESTRICTED — this table only ever narrows visibility, it is
 * never the sole gate (there is still `ReviewerRoleGuard` for "is this
 * person a reviewer at all"). See `assertInScope`/`buildScopeFilter`, the
 * two methods `PhotoReviewService` calls into.
 */
@Injectable()
export class ReviewAssignmentService {
  constructor(
    @InjectRepository(ReviewAssignment)
    private readonly repository: Repository<ReviewAssignment>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  async list(userId?: string): Promise<ReviewAssignmentDao[]> {
    const rows = await this.repository.find({
      where: userId ? { userId } : {},
      order: { createdAt: 'DESC' },
    });
    const infoMap = await this.batchResolveUserInfo(rows.map((r) => r.userId));
    return toDao(
      ReviewAssignmentDao,
      rows.map((r) => {
        const info = infoMap.get(r.userId);
        return {
          id: r.id,
          userId: r.userId,
          userName: info?.name,
          userEmail: info?.email,
          userDepartment: info?.department,
          userFaculty: info?.faculty,
          userRoleCodes: info?.roleCodes ?? [],
          groupField: r.groupField,
          groupValue: r.groupValue,
          createdByUserId: r.createdByUserId ?? undefined,
          createdAt: r.createdAt,
        };
      }),
    );
  }

  async create(
    dto: CreateReviewAssignmentDto,
    actorUserId: string | null,
  ): Promise<ReviewAssignmentDao> {
    const repo = this.repository;
    try {
      const created = await repo.save(
        repo.create({
          userId: dto.userId,
          groupField: dto.groupField,
          groupValue: dto.groupValue,
          createdByUserId: actorUserId,
        }),
      );
      const info = (await this.batchResolveUserInfo([created.userId])).get(
        created.userId,
      );
      return toDao(ReviewAssignmentDao, {
        id: created.id,
        userId: created.userId,
        userName: info?.name,
        userEmail: info?.email,
        userDepartment: info?.department,
        userFaculty: info?.faculty,
        userRoleCodes: info?.roleCodes ?? [],
        groupField: created.groupField,
        groupValue: created.groupValue,
        createdByUserId: created.createdByUserId ?? undefined,
        createdAt: created.createdAt,
      });
    } catch (error) {
      // UQ_review_assignments_user_field_value — re-granting the same group
      // to the same person is a harmless no-op, not an error the CMS needs
      // to surface; return the existing row instead of a 409.
      if (error instanceof QueryFailedError) {
        const existing = await repo.findOne({
          where: {
            userId: dto.userId,
            groupField: dto.groupField,
            groupValue: dto.groupValue,
          },
        });
        if (existing) {
          const info = (await this.batchResolveUserInfo([existing.userId])).get(
            existing.userId,
          );
          return toDao(ReviewAssignmentDao, {
            id: existing.id,
            userId: existing.userId,
            userName: info?.name,
            userEmail: info?.email,
            userDepartment: info?.department,
            userFaculty: info?.faculty,
            userRoleCodes: info?.roleCodes ?? [],
            groupField: existing.groupField,
            groupValue: existing.groupValue,
            createdByUserId: existing.createdByUserId ?? undefined,
            createdAt: existing.createdAt,
          });
        }
      }
      throw error;
    }
  }

  async remove(id: string): Promise<void> {
    await this.repository.delete({ id });
  }

  /**
   * "Người có quyền duyệt" (2026-09-22 — replaces the old scoped-only
   * "Thêm phân công" add-flow) — every user whose `users.roles` jsonb array
   * contains `'REVIEWER'` (the same flag `ReviewerRoleGuard` checks), i.e.
   * everyone with UNRESTRICTED review access. Distinct from `list()` above,
   * which reads `review_assignments` rows (narrowing grants) — a person can
   * appear in neither, either, or both lists.
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
    await this.dataSource.query(
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
   * CMS assignment picker's group-value dropdown — same query shape as
   * `CampaignSubjectService.distinctValues`, but global (no `campaignId`
   * filter) since assignments are global too.
   */
  async groupValues(
    field: (typeof REVIEW_ASSIGNMENT_GROUP_FIELDS)[number],
  ): Promise<string[]> {
    const column = {
      className: 'class_name',
      faculty: 'faculty',
      major: 'major',
    }[field];
    const rows: Array<{ value: string }> = await this.dataSource.query(
      `SELECT DISTINCT ${column} AS value FROM subject_photo_sets WHERE ${column} IS NOT NULL ORDER BY value LIMIT 500`,
    );
    return rows.map((r) => r.value);
  }

  /**
   * Throws 403 if `actorUserId` has at least one assignment row and none of
   * them match `target`. A `null` actor (should not happen behind
   * `SsoAuthGuard`+`ReviewerRoleGuard`, but this module's other methods
   * type `actorUserId` as nullable throughout — see e.g.
   * `PhotoReviewService.writeEvent`) is treated as unrestricted, same as
   * zero assignment rows.
   */
  async assertInScope(
    actorUserId: string | null,
    target: ScopeTarget,
  ): Promise<void> {
    if (!actorUserId) return;
    const rows = await this.repository.find({ where: { userId: actorUserId } });
    if (rows.length === 0) return;
    const allowed = rows.some((r) => {
      const value = target[r.groupField];
      return value != null && value === r.groupValue;
    });
    if (!allowed) {
      throw new CustomException(
        'Bạn không được phân công duyệt nhóm của hồ sơ này',
        PHOTO_REVIEW_ERROR_CODE.OUT_OF_SCOPE,
        HttpStatus.FORBIDDEN,
      );
    }
  }

  /**
   * SQL fragment + params for `PhotoReviewService.listSets`'s own
   * `conditions`/`params` arrays — `null` when `actorUserId` is
   * unrestricted (no rows to filter by), else an OR-of-assignments
   * fragment referencing table alias `s` (the same alias `listSets`
   * already uses for `subject_photo_sets`). `paramOffset` is the number of
   * params already pushed onto the caller's array, so `$N` placeholders
   * continue the same sequence.
   */
  async buildScopeFilter(
    actorUserId: string | null,
    paramOffset: number,
  ): Promise<{ sql: string; params: unknown[] } | null> {
    if (!actorUserId) return null;
    const rows = await this.repository.find({ where: { userId: actorUserId } });
    if (rows.length === 0) return null;

    const columnByField: Record<string, string> = {
      className: 's.class_name',
      faculty: 's.faculty',
      major: 's.major',
    };
    const clauses: string[] = [];
    const params: unknown[] = [];
    rows.forEach((r, i) => {
      params.push(r.groupValue);
      clauses.push(`${columnByField[r.groupField]} = $${paramOffset + i + 1}`);
    });
    return { sql: `(${clauses.join(' OR ')})`, params };
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
