import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { PrintResultImportStatus } from '../entities/print-result-import.entity';

export class PrintResultImportRowErrorDao {
  @ApiProperty({
    description: 'Số thứ tự dòng trong file Excel (tính cả header)',
  })
  rowNo: number;
  @ApiPropertyOptional() subjectCode: string | null;
  @ApiProperty({ description: 'Lý do dòng này không được ghi nhận' })
  reason: string;
}

export class PrintResultImportDao {
  @ApiProperty() id: string;
  @ApiProperty() batchId: string;
  @ApiProperty() fileName: string;
  @ApiPropertyOptional() uploadedByUserId?: string | null;
  @ApiProperty({ enum: ['PROCESSING', 'DONE', 'FAILED'] })
  status: PrintResultImportStatus;
  @ApiProperty() totalRows: number;
  @ApiProperty({
    description:
      'Số dòng khớp được mã SV trong đợt (dù trạng thái có đọc được hay không)',
  })
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
  /**
   * Rejected rows for THIS upload, inline — only populated on the direct
   * `POST .../result-imports` response (see `PrintResultImportService
   * .importResults`'s own doc comment on this field); a later
   * `listImports()`/`getImport()` read of the same row leaves this
   * undefined, use `errorReportUrl` there instead.
   */
  @ApiPropertyOptional({ type: [PrintResultImportRowErrorDao] })
  errors?: PrintResultImportRowErrorDao[];
}
