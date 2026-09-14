import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Column, Entity } from 'typeorm';
import { BaseEntity } from '@app/shared/database/base.entity';

export type SidecarEndpoint =
  '/card-photo' | '/background' | '/retouch' | '/edit';

/** Catalog only — not an aggregate, same reasoning `PermissionEntity` documents: no independent business state to protect. */
@Entity('ai_pipeline_steps')
export class AiPipelineStepEntity extends BaseEntity {
  @Column('varchar', { length: 50, unique: true })
  @ApiProperty({ description: 'Mã bước, ví dụ CARD_CROP' })
  code: string;

  @Column('varchar', { length: 255, name: 'name_vi' })
  @ApiProperty()
  nameVi: string;

  @Column('text', { nullable: true })
  @ApiPropertyOptional()
  description: string | null;

  @Column('varchar', { length: 20, name: 'sidecar_endpoint' })
  @ApiProperty({ enum: ['/card-photo', '/background', '/retouch', '/edit'] })
  sidecarEndpoint: SidecarEndpoint;

  @Column('jsonb', { name: 'params_schema', nullable: true })
  @ApiPropertyOptional()
  paramsSchema: Record<string, unknown> | null;

  @Column('jsonb', { name: 'default_params', nullable: true })
  @ApiPropertyOptional()
  defaultParams: Record<string, unknown> | null;

  @Column('boolean', { default: true })
  @ApiProperty()
  active: boolean;

  @Column('int', { name: 'sort_order', default: 0 })
  @ApiProperty()
  sortOrder: number;

  @Column('boolean', { name: 'is_system', default: false })
  @ApiProperty()
  isSystem: boolean;
}
