import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

/**
 * The one read path `PermissionsGuard` calls on every gated request — see
 * presentation/guards/permissions.guard.ts. Runs outside any
 * `UnitOfWork`/`TransactionContext` (a guard executes before the
 * CommandBus/QueryBus pipeline even starts), so this goes straight to
 * `DataSource`, same as the other read repositories in this module.
 */
@Injectable()
export class UserPermissionReadRepository {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async getGrantedCodes(userId: string): Promise<Set<string>> {
    const rows: Array<{ code: string }> = await this.dataSource.query(
      `
      SELECT DISTINCT p.code
      FROM user_roles ur
      JOIN role_permissions rp ON rp.role_id = ur.role_id
      JOIN permissions p ON p.id = rp.permission_id
      WHERE ur.user_id = $1
      `,
      [userId],
    );
    return new Set(rows.map((r) => r.code));
  }

  async getRoleCodes(userId: string): Promise<string[]> {
    const rows: Array<{ code: string }> = await this.dataSource.query(
      `
      SELECT r.code
      FROM user_roles ur
      JOIN roles r ON r.id = ur.role_id
      WHERE ur.user_id = $1
      ORDER BY r.code
      `,
      [userId],
    );
    return rows.map((r) => r.code);
  }
}
