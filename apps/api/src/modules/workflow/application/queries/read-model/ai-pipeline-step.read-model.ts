import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { SidecarEndpoint } from '../../../infrastructure/persistence/ai-pipeline-step.entity';

export class AiPipelineStepReadModel {
  @ApiProperty() id: string;
  @ApiProperty() code: string;
  @ApiProperty() nameVi: string;
  @ApiPropertyOptional({ nullable: true }) description: string | null;
  @ApiProperty({ enum: ['/card-photo', '/background', '/retouch', '/edit'] })
  sidecarEndpoint: SidecarEndpoint;
  @ApiPropertyOptional({ nullable: true }) paramsSchema: Record<
    string,
    unknown
  > | null;
  @ApiPropertyOptional({ nullable: true }) defaultParams: Record<
    string,
    unknown
  > | null;
  @ApiProperty() active: boolean;
  @ApiProperty() sortOrder: number;
  @ApiProperty() isSystem: boolean;
}
