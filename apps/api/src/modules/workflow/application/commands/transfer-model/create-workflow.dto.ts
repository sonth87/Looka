import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsObject, IsOptional, IsString, MaxLength } from 'class-validator';
import type { WorkflowConfig } from '../../../domain/schema/workflow-config.schema';

export class CreateWorkflowDto {
  @ApiProperty({
    description:
      'Mã nghiệp vụ (chữ hoa, số, gạch dưới), không đổi được sau khi tạo',
  })
  @IsString()
  @MaxLength(50)
  code: string;

  @ApiProperty({ description: 'Tên nghiệp vụ' })
  @IsString()
  @MaxLength(255)
  name: string;

  @ApiPropertyOptional({ description: 'Mô tả' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({
    description:
      'Cấu hình 6 nhóm (capture/identification/eligibility/aiProcessing/output/printing) — xem workflow-config.schema.ts. Kiểm tra kỹ ở handler, không chỉ ở đây.',
  })
  @IsObject()
  config: WorkflowConfig;
}
