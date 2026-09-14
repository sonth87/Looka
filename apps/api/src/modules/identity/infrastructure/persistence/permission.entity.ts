import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '@app/shared/database/base.entity';

/**
 * Not an aggregate — see role.aggregate.ts's own doc comment for why. Rows
 * here are upserted at boot by `PermissionCatalogService` from
 * `@RequirePermission(code)` decorators found by `DiscoveryService`; no
 * migration ever inserts one by hand (cms-8-screens-api-plan.md §1.1 E1).
 */
@Entity('permissions')
export class PermissionEntity extends BaseEntity {
  @Column('varchar', { length: 100, unique: true })
  @ApiProperty({ description: 'Mã quyền, ví dụ campaign:write' })
  code: string;

  @Column('varchar', { length: 50 })
  @Index()
  @ApiProperty({ description: 'Nhóm quyền, phần trước dấu :' })
  group: string;

  @Column('varchar', { length: 10, nullable: true })
  @ApiPropertyOptional({ description: 'HTTP method của route mang quyền này' })
  method: string | null;

  @Column('varchar', { length: 255, nullable: true })
  @ApiPropertyOptional({ description: 'Đường dẫn route mang quyền này' })
  path: string | null;

  @Column('text', { nullable: true })
  @ApiPropertyOptional({ description: 'Mô tả' })
  description: string | null;
}
