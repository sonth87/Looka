import { BaseEntity } from '@app/shared/database/base.entity';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { PrintBatch } from './print-batch.entity';

export type PrintResultImportStatus = 'PROCESSING' | 'DONE' | 'FAILED';

/**
 * One print-result Excel upload event — Giai đoạn 4 (plan §4.3, features
 * 4+5). Mirrors `CampaignSubjectImport`'s own `EXCEL` lifecycle exactly
 * (same reasoning: a bounded file a human uploads and waits on, parsed
 * synchronously — see that entity's own doc comment) — `created_at`
 * doubles as the upload date, same convention.
 *
 * `matchedRows` = rows whose `subjectCode` matched an item in this batch,
 * REGARDLESS of whether that row's own status text was understood;
 * `printedRows`/`failedRows` split the subset that WAS understood, by the
 * row's own reported outcome. `unmatchedRows` counts every row this import
 * could not act on for either of two independent reasons — `subjectCode`
 * matched nothing in this batch, OR the status text wasn't recognized as
 * either "printed" or "failed" (see `classifyStatus`'s own `UNKNOWN`
 * outcome) — so a single row CAN be counted in both `matchedRows` (code
 * found) and `unmatchedRows` (nothing done with it) at once; both problem
 * kinds land in the same downloadable error report, never treated as a
 * whole-file failure — see `PrintResultImportService`'s own doc comment
 * for the two-level "từ chối" distinction this table's `status` vs.
 * `unmatchedRows` encodes.
 */
@Entity('print_result_imports')
export class PrintResultImport extends BaseEntity {
  @Column('uuid', { name: 'batch_id' })
  @Index()
  @ApiProperty({ description: 'Đợt in liên quan' })
  batchId: string;

  @ManyToOne(() => PrintBatch, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'batch_id' })
  batch?: PrintBatch;

  @Column('varchar', { length: 255, name: 'file_name' })
  @ApiProperty({ description: 'Tên file gốc' })
  fileName: string;

  @Column('varchar', { length: 255, nullable: true, name: 'fs_file_id' })
  @ApiPropertyOptional({ description: 'Id file gốc trên file-service' })
  fsFileId?: string | null;

  @Column('uuid', { nullable: true, name: 'uploaded_by_user_id' })
  @ApiPropertyOptional({ description: 'Người upload' })
  uploadedByUserId?: string | null;

  @Column('varchar', { length: 10, default: 'PROCESSING' })
  @ApiProperty({
    description: 'PROCESSING | DONE | FAILED',
    enum: ['PROCESSING', 'DONE', 'FAILED'],
  })
  status: PrintResultImportStatus;

  @Column('int', { default: 0, name: 'total_rows' })
  @ApiProperty({ description: 'Tổng số dòng đọc được' })
  totalRows: number;

  @Column('int', { default: 0, name: 'matched_rows' })
  @ApiProperty({ description: 'Số dòng khớp được mã SV trong đợt' })
  matchedRows: number;

  @Column('int', { default: 0, name: 'printed_rows' })
  @ApiProperty({ description: 'Số dòng xác nhận đã in' })
  printedRows: number;

  @Column('int', { default: 0, name: 'failed_rows' })
  @ApiProperty({ description: 'Số dòng báo lỗi/từ chối' })
  failedRows: number;

  @Column('int', { default: 0, name: 'unmatched_rows' })
  @ApiProperty({ description: 'Số dòng không khớp mã SV nào trong đợt' })
  unmatchedRows: number;

  /** Xlsx liệt kê từng dòng không khớp/lỗi — chỉ có khi unmatchedRows/failedRows > 0. */
  @Column('varchar', {
    length: 255,
    nullable: true,
    name: 'error_report_fs_file_id',
  })
  @ApiPropertyOptional({ description: 'Id file báo cáo lỗi trên file-service' })
  errorReportFsFileId?: string | null;

  @Column('text', { nullable: true, name: 'failure_reason' })
  @ApiPropertyOptional({
    description: 'Lý do FAILED (file sai định dạng, thiếu cột bắt buộc...)',
  })
  failureReason?: string | null;
}
