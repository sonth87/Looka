import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { PrintResultImportStatus } from '../entities/print-result-import.entity';

export class PrintResultImportDao {
  @ApiProperty() id: string;
  @ApiProperty() batchId: string;
  @ApiProperty() fileName: string;
  @ApiPropertyOptional() uploadedByUserId?: string | null;
  @ApiProperty({ enum: ['PROCESSING', 'DONE', 'FAILED'] })
  status: PrintResultImportStatus;
  @ApiProperty() totalRows: number;
  @ApiProperty({ description: 'Số dòng khớp được mã SV trong đợt (dù trạng thái có đọc được hay không)' })
  matchedRows: number;
  @ApiProperty() printedRows: number;
  @ApiProperty() failedRows: number;
  @ApiProperty({
    description:
      'Số dòng không xử lý được — không khớp mã SV, HOẶC khớp mã SV nhưng không hiểu giá trị trạng thái (1 dòng có thể vừa matched vừa unmatched)',
  })
  unmatchedRows: number;
  @ApiPropertyOptional({ description: 'Link tải file báo cáo lỗi, nếu có' })
  errorReportUrl?: string | null;
  @ApiPropertyOptional() failureReason?: string | null;
  @ApiProperty() createdAt: Date;
}
