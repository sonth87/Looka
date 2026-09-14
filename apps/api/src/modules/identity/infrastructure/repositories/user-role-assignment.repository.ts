import { Injectable } from '@nestjs/common';
import { TransactionContext } from '@app/shared/database/transaction-context';
import { UserRoleAssignment } from '../../domain/aggregate/user-role-assignment.aggregate';
import { UserRoleRevokedEvent } from '../../domain/event/user-role-revoked.event';
import { RoleEntity } from '../persistence/role.entity';
import { UserRoleEntity } from '../persistence/user-role.entity';
import { IUserRoleAssignmentRepository } from './user-role-assignment.repository.interface';

interface UserRoleJoinRow {
  role_code: string;
}

@Injectable()
export class UserRoleAssignmentRepository implements IUserRoleAssignmentRepository {
  constructor(private readonly context: TransactionContext) {}

  async findByUserAndRole(
    userId: string,
    roleId: string,
  ): Promise<UserRoleAssignment | null> {
    const manager = this.context.manager();
    const entity = await manager.findOneBy(UserRoleEntity, { userId, roleId });
    if (!entity) return null;
    const role = await manager.findOneBy(RoleEntity, { id: roleId });
    return UserRoleAssignment.reconstruct({
      id: entity.id,
      userId: entity.userId,
      roleId: entity.roleId,
      roleCode: role?.code ?? '',
      grantedByUserId: entity.grantedByUserId,
      grantedAt: entity.grantedAt,
    });
  }

  async listByUser(userId: string): Promise<UserRoleAssignment[]> {
    const manager = this.context.manager();
    const rows = await manager
      .createQueryBuilder(UserRoleEntity, 'ur')
      .innerJoin(RoleEntity, 'r', 'r.id = ur.role_id')
      .addSelect('r.code', 'role_code')
      .where('ur.user_id = :userId', { userId })
      .getRawAndEntities<UserRoleJoinRow>();
    return rows.entities.map((entity, i) =>
      UserRoleAssignment.reconstruct({
        id: entity.id,
        userId: entity.userId,
        roleId: entity.roleId,
        roleCode: rows.raw[i].role_code,
        grantedByUserId: entity.grantedByUserId,
        grantedAt: entity.grantedAt,
      }),
    );
  }

  async save(assignment: UserRoleAssignment): Promise<void> {
    const manager = this.context.manager();
    const entity = new UserRoleEntity();
    entity.id = assignment.id;
    entity.userId = assignment.userId;
    entity.roleId = assignment.roleId;
    entity.grantedByUserId = assignment.grantedByUserId;
    entity.grantedAt = assignment.grantedAt;
    await manager.save(UserRoleEntity, entity);

    this.context.registerEvents(assignment.domainEvents);
    assignment.clearDomainEvents();
  }

  /**
   * Deletes the row and registers `UserRoleRevokedEvent` itself — unlike
   * `save()`, there is no surviving aggregate instance to call `.raise()`
   * on after a delete, so this repository registers the event directly
   * rather than asking the caller to know about `TransactionContext`.
   */
  async revoke(
    userId: string,
    roleId: string,
  ): Promise<{ id: string; roleCode: string } | null> {
    const manager = this.context.manager();
    const entity = await manager.findOneBy(UserRoleEntity, { userId, roleId });
    if (!entity) return null;
    const role = await manager.findOneBy(RoleEntity, { id: roleId });
    const roleCode = role?.code ?? '';
    await manager.delete(UserRoleEntity, { id: entity.id });

    this.context.registerEvents([
      new UserRoleRevokedEvent(entity.id, userId, roleId, roleCode),
    ]);
    return { id: entity.id, roleCode };
  }
}
