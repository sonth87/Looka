import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../shared/database/base.entity';
import { Campaign } from './campaign.entity';

export type CampaignSubjectImportStatus = 'PROCESSING' | 'DONE' | 'FAILED';

/**
 * One Excel upload event — cms-8-screens-api-plan.md §2.2/§2.3/D-Q3 (recreates
 * the roster `campaign_student_roster` deleted 2026-09-08). Every row of the
 * file becomes one `CampaignSubject` referencing this import; deleting an
 * import cascades to its subject rows (see that entity's own FK).
 *
 * Parsed and validated **synchronously**, within the same request the CMS
 * admin uploads the file in — not through a durable outbox+worker job the
 * way kiosk photo/video uploads are (see `UploadWorkerService`'s own doc
 * comment for that pattern). A roster is a few hundred to a few thousand
 * rows uploaded once by a human who is waiting for the result, not an
 * unattended device write that must survive a network blip on its own — the
 * same reasoning `UserCommandController.uploadAvatar`'s own doc comment
 * gives for uploading synchronously rather than through an outbox. `status`
 * still models `PROCESSING` (briefly, while parsing) so a genuine background
 * worker could replace this later without an API shape change.
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

  @Column('varchar', { length: 255, name: 'file_name' })
  @ApiProperty({ description: 'Tên file gốc' })
  fileName: string;

  /** File gốc lưu tại file-service để tra cứu lại — không bắt buộc (upload thất bại parse vẫn ghi được lịch sử). */
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
