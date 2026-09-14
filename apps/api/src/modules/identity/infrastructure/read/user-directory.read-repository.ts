import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Pagination } from '@app/shared/http/pagination';
import { UserReadModel } from '../../application/queries/read-model/user.read-model';

export interface ListUsersFilter {
  q?: string;
  roleCode?: string;
  status?: 'ACTIVE' | 'DISABLED';
  source?: 'SSO' | 'MANUAL' | 'SYNC';
  page: number;
  limit: number;
}

interface UserRow {
  id: string;
  ssoUserCode: string | null;
  email: string;
  displayName: string | null;
  title: string | null;
  code: string | null;
  phone: string | null;
  avatarFsFileId: string | null;
  isAdmin: boolean;
  status: 'ACTIVE' | 'DISABLED';
  source: 'SSO' | 'MANUAL' | 'SYNC';
  roleCodes: string[];
  lastLoginAt: Date | null;
  createdAt: Date;
}

/**
 * Query-side read repository for the "Người dùng & phân quyền" screen
 * (cms-8-screens-api-plan.md §2.8). Reads the EXISTING `users` table (not
 * owned by `modules/identity` yet — see `user-profile.repository.ts`'s own
 * doc comment) joined against this module's own `user_roles`/`roles`.
 */
@Injectable()
export class UserDirectoryReadRepository {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async list(filter: ListUsersFilter): Promise<Pagination<UserReadModel>> {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filter.q) {
      params.push(`%${filter.q}%`);
      const p = params.length;
      conditions.push(
        `(u.email ILIKE $${p} OR u.display_name ILIKE $${p} OR u.code ILIKE $${p} OR u.phone ILIKE $${p})`,
      );
    }
    if (filter.status) {
      params.push(filter.status);
      conditions.push(`u.status = $${params.length}`);
    }
    if (filter.source) {
      params.push(filter.source);
      conditions.push(`u.source = $${params.length}`);
    }
    if (filter.roleCode) {
      params.push(filter.roleCode);
      conditions.push(
        `EXISTS (SELECT 1 FROM user_roles ur2 JOIN roles r2 ON r2.id = ur2.role_id WHERE ur2.user_id = u.id AND r2.code = $${params.length})`,
      );
    }
    const where =
      conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countRows: Array<{ count: string }> = await this.dataSource.query(
      `SELECT COUNT(*)::text AS count FROM users u ${where}`,
      params,
    );
    const totalItems = Number(countRows[0]?.count ?? 0);

    const limitParamIndex = params.length + 1;
    const offsetParamIndex = params.length + 2;
    const rows: UserRow[] = await this.dataSource.query(
      `
      SELECT
        u.id, u.sso_user_code AS "ssoUserCode", u.email, u.display_name AS "displayName",
        u.title, u.code, u.phone, u.avatar_fs_file_id AS "avatarFsFileId",
        u.is_admin AS "isAdmin", u.status, u.source,
        u.last_login_at AS "lastLoginAt", u.created_at AS "createdAt",
        COALESCE(
          (SELECT array_agg(r.code ORDER BY r.code)
           FROM user_roles ur JOIN roles r ON r.id = ur.role_id
           WHERE ur.user_id = u.id),
          ARRAY[]::text[]
        ) AS "roleCodes"
      FROM users u
      ${where}
      ORDER BY u.created_at DESC
      LIMIT $${limitParamIndex} OFFSET $${offsetParamIndex}
      `,
      [...params, filter.limit, (filter.page - 1) * filter.limit],
    );

    return new Pagination<UserReadModel>(rows, {
      itemCount: rows.length,
      totalItems,
      itemsPerPage: filter.limit,
      totalPages: Math.ceil(totalItems / filter.limit) || 1,
      currentPage: filter.page,
    });
  }

  async getById(id: string): Promise<UserReadModel | null> {
    const rows: UserRow[] = await this.dataSource.query(
      `
      SELECT
        u.id, u.sso_user_code AS "ssoUserCode", u.email, u.display_name AS "displayName",
        u.title, u.code, u.phone, u.avatar_fs_file_id AS "avatarFsFileId",
        u.is_admin AS "isAdmin", u.status, u.source,
        u.last_login_at AS "lastLoginAt", u.created_at AS "createdAt",
        COALESCE(
          (SELECT array_agg(r.code ORDER BY r.code)
           FROM user_roles ur JOIN roles r ON r.id = ur.role_id
           WHERE ur.user_id = u.id),
          ARRAY[]::text[]
        ) AS "roleCodes"
      FROM users u
      WHERE u.id = $1
      `,
      [id],
    );
    return rows[0] ?? null;
  }

  /** Backs `GET /v1/roles/:id/users`. */
  async listByRole(
    roleId: string,
    page: number,
    limit: number,
  ): Promise<Pagination<UserReadModel>> {
    const countRows: Array<{ count: string }> = await this.dataSource.query(
      `SELECT COUNT(*)::text AS count FROM user_roles WHERE role_id = $1`,
      [roleId],
    );
    const totalItems = Number(countRows[0]?.count ?? 0);

    const rows: UserRow[] = await this.dataSource.query(
      `
      SELECT
        u.id, u.sso_user_code AS "ssoUserCode", u.email, u.display_name AS "displayName",
        u.title, u.code, u.phone, u.avatar_fs_file_id AS "avatarFsFileId",
        u.is_admin AS "isAdmin", u.status, u.source,
        u.last_login_at AS "lastLoginAt", u.created_at AS "createdAt",
        COALESCE(
          (SELECT array_agg(r.code ORDER BY r.code)
           FROM user_roles ur2 JOIN roles r ON r.id = ur2.role_id
           WHERE ur2.user_id = u.id),
          ARRAY[]::text[]
        ) AS "roleCodes"
      FROM users u
      JOIN user_roles ur ON ur.user_id = u.id
      WHERE ur.role_id = $1
      ORDER BY u.email ASC
      LIMIT $2 OFFSET $3
      `,
      [roleId, limit, (page - 1) * limit],
    );

    return new Pagination<UserReadModel>(rows, {
      itemCount: rows.length,
      totalItems,
      itemsPerPage: limit,
      totalPages: Math.ceil(totalItems / limit) || 1,
      currentPage: page,
    });
  }
}
