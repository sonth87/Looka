import { ApiPropertyOptional } from '@nestjs/swagger';
import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '@app/shared/database/base.entity';

/**
 * Plain join row backing the `UserRoleAssignment` aggregate
 * (user-role-assignment.aggregate.ts). `userId`/`roleId` are bare uuids
 * with no TypeORM `@ManyToOne` relation, matching this codebase's existing
 * convention of FK-by-column-only (e.g. `campaign_members.user_id`) rather
 * than ORM-managed relations.
 */
@Entity('user_roles')
export class UserRoleEntity extends BaseEntity {
  @Column('uuid', { name: 'user_id' })
  @Index()
  userId: string;

  @Column('uuid', { name: 'role_id' })
  @Index()
  roleId: string;

  @Column('uuid', { name: 'granted_by_user_id', nullable: true })
  @ApiPropertyOptional()
  grantedByUserId: string | null;

  @Column('timestamptz', { name: 'granted_at' })
  grantedAt: Date;
}
