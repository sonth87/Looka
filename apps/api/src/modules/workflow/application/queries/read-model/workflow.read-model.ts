import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { WorkflowConfig } from '../../../domain/schema/workflow-config.schema';

export class WorkflowVersionSummary {
  @ApiProperty() id: string;
  @ApiProperty() version: number;
  @ApiProperty() isDraft: boolean;
  @ApiPropertyOptional({ nullable: true }) publishedAt: Date | null;
  @ApiPropertyOptional({ nullable: true }) note: string | null;
}

export class WorkflowReadModel {
  @ApiProperty() id: string;
  @ApiProperty() code: string;
  @ApiProperty() name: string;
  @ApiPropertyOptional({ nullable: true }) description: string | null;
  @ApiProperty({ enum: ['DRAFT', 'ACTIVE', 'ARCHIVED'] }) status:
    'DRAFT' | 'ACTIVE' | 'ARCHIVED';
  @ApiPropertyOptional({ nullable: true }) currentVersionId: string | null;
  @ApiPropertyOptional({ nullable: true }) currentVersion: number | null;
  @ApiPropertyOptional({
    description:
      'Cấu hình của version hiện tại (hoặc bản nháp nếu chưa từng publish)',
  })
  currentConfig: WorkflowConfig | null;
  @ApiProperty() campaignCount: number;
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;
}

export class WorkflowUsageReadModel {
  @ApiProperty() campaignId: string;
  @ApiProperty() campaignName: string;
  @ApiPropertyOptional({ nullable: true }) campaignCode: string | null;
  @ApiProperty() workflowVersionId: string;
  @ApiProperty() version: number;
}
