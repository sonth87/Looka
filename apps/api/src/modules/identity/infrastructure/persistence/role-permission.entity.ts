import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '@app/shared/database/base.entity';

/** Plain join row — no aggregate of its own; owned by `Role` (role.aggregate.ts). */
@Entity('role_permissions')
export class RolePermissionEntity extends BaseEntity {
  @Column('uuid', { name: 'role_id' })
  @Index()
  roleId: string;

  @Column('uuid', { name: 'permission_id' })
  @Index()
  permissionId: string;
}
