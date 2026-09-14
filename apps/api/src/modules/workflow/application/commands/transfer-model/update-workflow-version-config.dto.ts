import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsObject, IsOptional, IsString } from 'class-validator';
import type { WorkflowConfig } from '../../../domain/schema/workflow-config.schema';

export class UpdateWorkflowVersionConfigDto {
  @ApiProperty({
    description: 'Cấu hình 6 nhóm đầy đủ — thay toàn bộ, không patch từng phần',
  })
  @IsObject()
  config: WorkflowConfig;

  @ApiPropertyOptional({ description: 'Ghi chú cho version này' })
  @IsOptional()
  @IsString()
  note?: string;
}
