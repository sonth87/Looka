import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { RoleReadModel } from '../../application/queries/read-model/role.read-model';

interface RoleRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  createdAt: Date;
  updatedAt: Date;
  permissionCodes: string[];
  userCount: string;
}

/**
 * Query-side read repository (plan §7 Q7: queries never touch raw SQL from
 * the handler, only from here). Uses `DataSource` directly, not
 * `TransactionContext` — query handlers do not open a `UnitOfWork`
 * (target tree comment: "queries/handler … KHÔNG UnitOfWork, KHÔNG ghi").
 */
@Injectable()
export class RoleCatalogReadRepository {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async list(): Promise<RoleReadModel[]> {
    const rows = await this.dataSource.query<RoleRow[]>(`
      SELECT
        r.id, r.code, r.name, r.description, r.is_system AS "isSystem",
        r.created_at AS "createdAt", r.updated_at AS "updatedAt",
        COALESCE(array_agg(DISTINCT p.code) FILTER (WHERE p.code IS NOT NULL), ARRAY[]::text[]) AS "permissionCodes",
        COUNT(DISTINCT ur.user_id) AS "userCount"
      FROM roles r
      LEFT JOIN role_permissions rp ON rp.role_id = r.id
      LEFT JOIN permissions p ON p.id = rp.permission_id
      LEFT JOIN user_roles ur ON ur.role_id = r.id
      GROUP BY r.id
      ORDER BY r.is_system DESC, r.name ASC
    `);
    return rows.map((row) => this.toReadModel(row));
  }

  async getById(id: string): Promise<RoleReadModel | null> {
    const rows = await this.dataSource.query<RoleRow[]>(
      `
      SELECT
        r.id, r.code, r.name, r.description, r.is_system AS "isSystem",
        r.created_at AS "createdAt", r.updated_at AS "updatedAt",
        COALESCE(array_agg(DISTINCT p.code) FILTER (WHERE p.code IS NOT NULL), ARRAY[]::text[]) AS "permissionCodes",
        COUNT(DISTINCT ur.user_id) AS "userCount"
      FROM roles r
      LEFT JOIN role_permissions rp ON rp.role_id = r.id
      LEFT JOIN permissions p ON p.id = rp.permission_id
      LEFT JOIN user_roles ur ON ur.role_id = r.id
      WHERE r.id = $1
      GROUP BY r.id
      `,
      [id],
    );
    if (rows.length === 0) return null;
    return this.toReadModel(rows[0]);
  }

  private toReadModel(row: RoleRow): RoleReadModel {
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      description: row.description,
      isSystem: row.isSystem,
      permissionCodes: row.permissionCodes,
      userCount: Number(row.userCount),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
