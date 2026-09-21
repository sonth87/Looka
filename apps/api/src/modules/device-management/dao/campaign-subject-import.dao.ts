import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Expose } from 'class-transformer';
import type {
  CampaignSubjectImportSource,
  CampaignSubjectImportStatus,
} from '../entities/campaign-subject-import.entity';

export class CampaignSubjectImportDao {
  @ApiProperty()
  @Expose()
  id: string;

  @ApiProperty()
  @Expose()
  campaignId: string;

  @ApiProperty({ enum: ['EXCEL', 'EXTERNAL_API'] })
  @Expose()
  source: CampaignSubjectImportSource;

  @ApiPropertyOptional()
  @Expose()
  sourceDetail?: Record<string, unknown> | null;

  @ApiProperty()
  @Expose()
  fileName: string;

  @ApiPropertyOptional()
  @Expose()
  uploadedByUserId?: string | null;

  @ApiProperty({
    enum: [
      'PROCESSING',
      'PENDING_FETCH',
      'FETCHING',
      'IMPORTING',
      'DONE',
      'FAILED',
    ],
  })
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

  @ApiPropertyOptional({ description: 'Lúc job nền hoàn tất, nếu là API pull' })
  @Expose()
  finishedAt?: Date | null;

  @ApiProperty()
  @Expose()
  createdAt: Date;
}
