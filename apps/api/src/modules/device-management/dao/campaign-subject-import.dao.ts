import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Expose } from 'class-transformer';
import type { CampaignSubjectImportStatus } from '../entities/campaign-subject-import.entity';

export class CampaignSubjectImportDao {
  @ApiProperty()
  @Expose()
  id: string;

  @ApiProperty()
  @Expose()
  campaignId: string;

  @ApiProperty()
  @Expose()
  fileName: string;

  @ApiPropertyOptional()
  @Expose()
  uploadedByUserId?: string | null;

  @ApiProperty({ enum: ['PROCESSING', 'DONE', 'FAILED'] })
  @Expose()
  status: CampaignSubjectImportStatus;

  @ApiProperty()
  @Expose()
  totalRows: number;

  @ApiProperty()
  @Expose()
  validRows: number;

  @ApiProperty()
  @Expose()
  errorRows: number;

  @ApiPropertyOptional({ description: 'Link tải file báo cáo lỗi, nếu có' })
  @Expose()
  errorReportUrl?: string | null;

  @ApiPropertyOptional()
  @Expose()
  failureReason?: string | null;

  @ApiProperty()
  @Expose()
  createdAt: Date;
}
