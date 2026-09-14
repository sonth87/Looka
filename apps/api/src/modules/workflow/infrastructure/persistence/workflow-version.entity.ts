import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '@app/shared/database/base.entity';
import type { WorkflowConfig } from '../../domain/schema/workflow-config.schema';

@Entity('workflow_versions')
export class WorkflowVersionEntity extends BaseEntity {
  @Column('uuid', { name: 'workflow_id' })
  @Index()
  workflowId: string;

  @Column('int')
  @ApiProperty()
  version: number;

  @Column('jsonb')
  @ApiProperty({
    description: 'Cấu hình 6 nhóm — xem workflow-config.schema.ts',
  })
  config: WorkflowConfig;

  @Column('timestamptz', { name: 'published_at', nullable: true })
  @ApiPropertyOptional({ description: 'null = còn là bản nháp, sửa được' })
  publishedAt: Date | null;

  @Column('uuid', { name: 'published_by_user_id', nullable: true })
  @ApiPropertyOptional()
  publishedByUserId: string | null;

  @Column('text', { nullable: true })
  @ApiPropertyOptional()
  note: string | null;
}
