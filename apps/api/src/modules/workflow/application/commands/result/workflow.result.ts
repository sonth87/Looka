import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class WorkflowResult {
  @ApiProperty() id: string;
  @ApiProperty() code: string;
  @ApiProperty() name: string;
  @ApiPropertyOptional({ nullable: true }) description: string | null;
  @ApiProperty({ enum: ['DRAFT', 'ACTIVE', 'ARCHIVED'] }) status:
    'DRAFT' | 'ACTIVE' | 'ARCHIVED';
  @ApiPropertyOptional({ nullable: true }) currentVersionId: string | null;
}

export class WorkflowVersionResult {
  @ApiProperty() id: string;
  @ApiProperty() workflowId: string;
  @ApiProperty() version: number;
  @ApiProperty() isDraft: boolean;
}
