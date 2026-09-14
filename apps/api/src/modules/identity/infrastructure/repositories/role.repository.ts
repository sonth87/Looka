import { Injectable } from '@nestjs/common';
import { TransactionContext } from '@app/shared/database/transaction-context';
import { Role } from '../../domain/aggregate/role.aggregate';
import { PermissionEntity } from '../persistence/permission.entity';
import { RoleEntity } from '../persistence/role.entity';
import { RoleMapper } from '../persistence/role.mapper';
import { RolePermissionEntity } from '../persistence/role-permission.entity';
import { IRoleRepository } from './role.repository.interface';

/**
 * `EntityManager` always comes from `TransactionContext.manager()` — never
 * injected via `@InjectRepository()` — so every read/write here runs inside
 * whatever transaction `UnitOfWork.run()` currently has open (plan §4.4).
 */
@Injectable()
export class RoleRepository implements IRoleRepository {
  constructor(private readonly context: TransactionContext) {}

  async findById(id: string): Promise<Role | null> {
    const entity = await this.context.manager().findOneBy(RoleEntity, { id });
    if (!entity) return null;
    return RoleMapper.toDomain(entity, await this.permissionCodesOf(entity.id));
  }

  async findByCode(code: string): Promise<Role | null> {
    const entity = await this.context.manager().findOneBy(RoleEntity, { code });
    if (!entity) return null;
    return RoleMapper.toDomain(entity, await this.permissionCodesOf(entity.id));
  }

  async save(role: Role): Promise<void> {
    const manager = this.context.manager();
    const existing = await manager.findOneBy(RoleEntity, { id: role.id });
    const entity = RoleMapper.toEntity(role, existing ?? undefined);
    await manager.save(RoleEntity, entity);

    // `Role.setPermissions()` is a full-replace by design (role.aggregate.ts) —
    // mirror that here: delete then re-insert rather than diffing rows,
    // since a role's permission count is small (tens, not thousands).
    await manager.delete(RolePermissionEntity, { roleId: role.id });
    if (role.permissionCodes.length > 0) {
      const permissions = await manager
        .createQueryBuilder(PermissionEntity, 'p')
        .where('p.code IN (:...codes)', { codes: role.permissionCodes })
        .getMany();
      const rows = permissions.map((p) => {
        const row = new RolePermissionEntity();
        row.roleId = role.id;
        row.permissionId = p.id;
        return row;
      });
      if (rows.length > 0) {
        await manager.save(RolePermissionEntity, rows);
      }
    }

    this.context.registerEvents(role.domainEvents);
    role.clearDomainEvents();
  }

  async delete(id: string): Promise<void> {
    const manager = this.context.manager();
    await manager.delete(RolePermissionEntity, { roleId: id });
    await manager.delete(RoleEntity, { id });
  }

  private async permissionCodesOf(roleId: string): Promise<string[]> {
    const rows = await this.context
      .manager()
      .createQueryBuilder(PermissionEntity, 'p')
      .innerJoin(RolePermissionEntity, 'rp', 'rp.permission_id = p.id')
      .where('rp.role_id = :roleId', { roleId })
      .getMany();
    return rows.map((r) => r.code);
  }
}
