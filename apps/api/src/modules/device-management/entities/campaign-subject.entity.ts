import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../shared/database/base.entity';
import { Campaign } from './campaign.entity';
import { CampaignSubjectImport } from './campaign-subject-import.entity';

export type CampaignSubjectStatus = 'VALID' | 'ERROR' | 'DUPLICATE';

/**
 * One roster row — cms-8-screens-api-plan.md §2.2 (D-Q3). Recreates the
 * `campaign_student_roster` table dropped 2026-09-08 (migration
 * `1804000000000`), with `faculty`/`dateOfBirth`/`cardValidUntil` added
 * because the print module (P6) needs them on the card. `status` keeps
 * every row from the source file, including invalid ones — `ERROR`/
 * `DUPLICATE` rows are never dropped, so the CMS "xem lỗi ở đâu" list
 * (`GET /v1/campaigns/:id/subjects?status=ERROR`) has something to show.
 *
 * Only a `VALID` row is unique per `(campaignId, subjectCode)` (a partial
 * index in the migration) — a re-upload of the same student is expected to
 * collide and lands as `DUPLICATE`, not a hard constraint violation.
 *
 * 2026-09-21 (13-features-and-2-blockers-plan §3.1) — `importId` now also
 * covers an API pull: `CampaignSubjectImport.source` distinguishes `EXCEL`
 * from `EXTERNAL_API`, so there is only ever ONE "how did this row get
 * here" pointer, not two competing ones (an earlier draft of this feature
 * tried a separate nullable `syncId` FK — reverted, see git history).
 */
@Entity('campaign_subjects')
export class CampaignSubject extends BaseEntity {
  @Column('uuid', { name: 'campaign_id' })
  @Index()
  @ApiProperty({ description: 'Campaign đợt chụp' })
  campaignId: string;

  @ManyToOne(() => Campaign, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'campaign_id' })
  campaign?: Campaign;

  @Column('uuid', { name: 'import_id' })
  @Index()
  @ApiProperty({
    description: 'Lần import (Excel hoặc API pull) đã tạo dòng này',
  })
  importId: string;

  @ManyToOne(() => CampaignSubjectImport, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'import_id' })
  import?: CampaignSubjectImport;

  @Column('int', { name: 'row_no' })
  @ApiProperty({ description: 'Số dòng trong file Excel gốc' })
  rowNo: number;

  @Column('varchar', { length: 100, name: 'subject_code' })
  @ApiProperty({ description: 'Mã sinh viên' })
  subjectCode: string;

  @Column('varchar', { length: 255, name: 'full_name' })
  @ApiProperty({ description: 'Họ tên' })
  fullName: string;

  @Column('varchar', { length: 20, nullable: true, name: 'citizen_id' })
  @ApiPropertyOptional({ description: 'Số CCCD' })
  citizenId?: string | null;

  @Column('varchar', { length: 100, nullable: true, name: 'class_name' })
  @ApiPropertyOptional({ description: 'Lớp' })
  className?: string | null;

  @Column('varchar', { length: 255, nullable: true })
  @ApiPropertyOptional({ description: 'Khoa' })
  faculty?: string | null;

  @Column('varchar', { length: 255, nullable: true })
  @ApiPropertyOptional({ description: 'Ngành' })
  major?: string | null;

  @Column('date', { nullable: true, name: 'date_of_birth' })
  @ApiPropertyOptional({ description: 'Ngày sinh' })
  dateOfBirth?: string | null;

  @Column('date', { nullable: true, name: 'card_valid_until' })
  @ApiPropertyOptional({ description: 'Thời hạn thẻ' })
  cardValidUntil?: string | null;

  @Column('varchar', { length: 10 })
  @ApiProperty({
    description: 'VALID | ERROR | DUPLICATE',
    enum: ['VALID', 'ERROR', 'DUPLICATE'],
  })
  status: CampaignSubjectStatus;

  @Column('text', { nullable: true, name: 'error_message' })
  @ApiPropertyOptional({ description: 'Lý do lỗi/trùng, nếu có' })
  errorMessage?: string | null;

  /**
   * Cột thừa trong file Excel không map vào field nào ở trên — giữ lại thay
   * vì bỏ (E6). Với dòng đến từ API pull, đây là TOÀN BỘ bản ghi thô (plan
   * §3.1) chứ không chỉ phần "thừa" — xem `CampaignSubjectPullWriteWorker`.
   */
  @Column('jsonb', { nullable: true })
  @ApiPropertyOptional({
    description:
      'Cột khác từ file, hoặc toàn bộ bản ghi thô nếu đến từ API pull',
  })
  extra?: Record<string, unknown> | null;

  /**
   * Feature 6 — set by the print-result-upload flow (Giai đoạn 4) when a
   * human confirms this subject's card actually printed; NEVER set/cleared
   * by a roster import or API pull (see `CampaignSubjectPullWriteWorker`'s
   * own doc comment on its upsert SQL). `null` means "chưa in", not "no
   * data".
   */
  @Column('timestamptz', { nullable: true, name: 'printed_at' })
  @ApiPropertyOptional({
    description: 'Thời điểm SV này được xác nhận đã in thẻ',
  })
  printedAt?: Date | null;

  /** Đợt in đã in thẻ này — không FK, trỏ chéo sang module `print` (`print_batches`). */
  @Column('uuid', { nullable: true, name: 'printed_batch_id' })
  @ApiPropertyOptional({ description: 'Đợt in đã in thẻ này, nếu có' })
  printedBatchId?: string | null;
}
