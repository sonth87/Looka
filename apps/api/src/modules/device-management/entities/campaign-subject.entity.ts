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
  @ApiProperty({ description: 'Lần import đã tạo dòng này' })
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

  /** Cột thừa trong file Excel không map vào field nào ở trên — giữ lại thay vì bỏ (E6). */
  @Column('jsonb', { nullable: true })
  @ApiPropertyOptional({ description: 'Cột khác từ file, nếu có' })
  extra?: Record<string, unknown> | null;
}
