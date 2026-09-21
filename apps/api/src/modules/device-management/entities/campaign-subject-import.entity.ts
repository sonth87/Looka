import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../shared/database/base.entity';
import { Campaign } from './campaign.entity';

export type CampaignSubjectImportStatus =
  'PROCESSING' | 'PENDING_FETCH' | 'FETCHING' | 'IMPORTING' | 'DONE' | 'FAILED';
export type CampaignSubjectImportSource = 'EXCEL' | 'EXTERNAL_API';

/**
 * One roster-import event — either an Excel upload OR a full API pull
 * (2026-09-21, 13-features-and-2-blockers-plan §3.1, feature 1) —
 * cms-8-screens-api-plan.md §2.2/§2.3/D-Q3 (recreates the roster
 * `campaign_student_roster` deleted 2026-09-08). Every row becomes one
 * `CampaignSubject` referencing this import; deleting an import cascades to
 * its subject rows (see that entity's own FK) — `CampaignSubjectService.
 * deleteImport` additionally refuses when any of those rows has
 * `printedAt` set, since a cascade would silently erase print history.
 *
 * `source` picks which lifecycle this row is in:
 * - `EXCEL`: parsed and validated **synchronously**, within the same
 *   request the CMS admin uploads the file in — not through a durable
 *   outbox+worker job the way kiosk photo/video uploads are (see
 *   `UploadWorkerService`'s own doc comment for that pattern). A roster
 *   Excel file is a few hundred to a few thousand rows uploaded once by a
 *   human who is waiting for the result, not an unattended device write
 *   that must survive a network blip on its own — the same reasoning
 *   `UserCommandController.uploadAvatar`'s own doc comment gives for
 *   uploading synchronously rather than through an outbox. Only ever uses
 *   `PROCESSING` (briefly, while parsing) → `DONE`/`FAILED`.
 * - `EXTERNAL_API`: a full, unfiltered pull of this campaign's own
 *   `eligibilityConfig.api` — can be ~24k records / ~20MB, an order of
 *   magnitude past what the Excel path's synchronous reasoning covers, so
 *   it runs through the durable 2-tier queue
 *   (`campaign_subject_import_chunks`, `CampaignSubjectPullFetchWorker` /
 *   `CampaignSubjectPullWriteWorker`) instead. Walks
 *   `PENDING_FETCH → FETCHING → IMPORTING → DONE`/`FAILED`.
 */
@Entity('campaign_subject_imports')
export class CampaignSubjectImport extends BaseEntity {
  @Column('uuid', { name: 'campaign_id' })
  @Index()
  @ApiProperty({ description: 'Campaign đợt chụp' })
  campaignId: string;

  @ManyToOne(() => Campaign, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'campaign_id' })
  campaign?: Campaign;

  @Column('varchar', { length: 12, default: 'EXCEL' })
  @ApiProperty({
    description: 'EXCEL | EXTERNAL_API',
    enum: ['EXCEL', 'EXTERNAL_API'],
  })
  source: CampaignSubjectImportSource;

  /** Free-form detail specific to `source` — e.g. the pulled record count/discovered field keys for an `EXTERNAL_API` import. Not used by the `EXCEL` path today. */
  @Column('jsonb', { nullable: true, name: 'source_detail' })
  @ApiPropertyOptional({
    description:
      'Chi tiết riêng theo nguồn, ví dụ danh sách field phát hiện được từ API',
  })
  sourceDetail?: Record<string, unknown> | null;

  /**
   * A real file name for `EXCEL`; a synthetic `external-api-<iso>.json` for
   * `EXTERNAL_API` (see `CampaignSubjectService.requestPull`) — kept
   * `NOT NULL` on purpose so `CampaignSubjectImportDao`/the CMS's existing
   * "lịch sử import" table render both sources with zero special-casing.
   */
  @Column('varchar', { length: 255, name: 'file_name' })
  @ApiProperty({
    description: 'Tên file gốc, hoặc tên tổng hợp cho lần kéo API',
  })
  fileName: string;

  /** Lúc job nền hoàn tất (DONE hoặc FAILED) — chỉ có ý nghĩa cho `EXTERNAL_API`, luôn null cho `EXCEL` (đóng gói xong ngay trong request). */
  @Column('timestamptz', { nullable: true, name: 'finished_at' })
  @ApiPropertyOptional({ description: 'Lúc job nền hoàn tất, nếu là API pull' })
  finishedAt?: Date | null;

  /** File gốc lưu tại file-service để tra cứu lại — không bắt buộc (upload thất bại parse vẫn ghi được lịch sử). */
  @Column('varchar', { length: 255, nullable: true, name: 'fs_file_id' })
  @ApiPropertyOptional({ description: 'Id file gốc trên file-service' })
  fsFileId?: string | null;

  @Column('uuid', { nullable: true, name: 'uploaded_by_user_id' })
  @ApiPropertyOptional({ description: 'Người upload' })
  uploadedByUserId?: string | null;

  @Column('varchar', { length: 14, default: 'PROCESSING' })
  @ApiProperty({
    description:
      'PROCESSING | DONE | FAILED (EXCEL) — PENDING_FETCH | FETCHING | IMPORTING | DONE | FAILED (EXTERNAL_API)',
    enum: [
      'PROCESSING',
      'PENDING_FETCH',
      'FETCHING',
      'IMPORTING',
      'DONE',
      'FAILED',
    ],
  })
  status: CampaignSubjectImportStatus;

  @Column('int', { default: 0, name: 'total_rows' })
  @ApiProperty({ description: 'Tổng số dòng đọc được' })
  totalRows: number;

  @Column('int', { default: 0, name: 'valid_rows' })
  @ApiProperty({ description: 'Số dòng hợp lệ' })
  validRows: number;

  @Column('int', { default: 0, name: 'error_rows' })
  @ApiProperty({ description: 'Số dòng lỗi/trùng' })
  errorRows: number;

  /** Xlsx liệt kê từng dòng lỗi + lý do — chỉ có khi errorRows > 0. */
  @Column('varchar', {
    length: 255,
    nullable: true,
    name: 'error_report_fs_file_id',
  })
  @ApiPropertyOptional({ description: 'Id file báo cáo lỗi trên file-service' })
  errorReportFsFileId?: string | null;

  @Column('text', { nullable: true, name: 'failure_reason' })
  @ApiPropertyOptional({
    description: 'Lý do FAILED (ví dụ file không đọc được)',
  })
  failureReason?: string | null;
}
