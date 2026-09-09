import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Column, Entity, Index, JoinColumn, ManyToOne, Unique } from 'typeorm';
import { BaseEntity } from '../../shared/common/base.entity';
import { Campaign } from './campaign.entity';

/**
 * "Sinh viên dự kiến" — the campaign's expected-student roster (2026-09-09,
 * CCCD-scan capture-identification feature). Replaces
 * `packages/ui/src/lib/studentTestData.ts`'s hardcoded fake data as the
 * thing a kiosk actually checks a scanned citizen against: the kiosk's own
 * file-watch handler (`apps/desktop/src/main/cccdWatcher.ts`) reads a scanned
 * CCCD number off the external scanner's output file, then calls
 * `GET /v1/campaigns/:id/roster/lookup?citizenId=...` (gated the same way as
 * `GET /v1/campaigns/:id/config` — `CampaignMemberGuard`, an approved
 * operator of an OPEN campaign) to find the matching row here.
 *
 * `citizenId` (the CCCD number) is the actual match key — unique per
 * campaign, since the same person's CCCD should only ever have one roster
 * row within one campaign's expected-student list. `studentCode` is kept
 * distinct from it (never matched against): it is what the rest of the
 * platform already treats as a person's identity for a captured session
 * (`subject_photo_sets.subjectCode`, `sessions.subject_code`, the CMS
 * "Sinh viên" capture-log tab) — a roster row's whole reason to exist is to
 * hand that code (plus name/class/major/year) to the capture flow once its
 * `citizenId` matches a scan, exactly the shape `StudentLookupResult.FOUND`
 * already expects from the old manual "nhập mã sinh viên" lookup.
 *
 * Populated via CSV bulk import (`POST /v1/campaigns/:id/roster/import`,
 * `CampaignStudentRosterService.importRoster`) — a real, admin-managed CRUD
 * resource (not a system-seeded catalog like `CaptureAnglePreset`), so rows
 * are hard-deletable/editable to fix a bad import, same reasoning
 * `CaptureConfiguration`'s own doc comment gives for why that table is a
 * genuine CRUD resource rather than soft-deleted.
 */
@Entity('campaign_student_roster')
@Unique('UQ_campaign_student_roster_campaign_citizen', ['campaignId', 'citizenId'])
export class CampaignStudentRoster extends BaseEntity {
  @Column('uuid', { name: 'campaign_id' })
  @Index()
  @ApiProperty({ description: 'Campaign mà hồ sơ dự kiến này thuộc về' })
  campaignId: string;

  @ManyToOne(() => Campaign, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'campaign_id' })
  campaign?: Campaign;

  @Column('varchar', { length: 100, name: 'student_code' })
  @ApiProperty({ description: 'Mã sinh viên — mã dùng xuyên suốt hệ thống (phiên chụp, hồ sơ ảnh)' })
  studentCode: string;

  @Column('varchar', { length: 255, name: 'student_name' })
  @ApiProperty({ description: 'Họ tên sinh viên' })
  studentName: string;

  /**
   * The CCCD number — the actual match key against a scanned card. Not
   * validated as strictly-12-digit here (defensive: a real scanner's exact
   * output format is not yet confirmed, see `cccdScanFile.ts`'s own doc
   * comment), just a required, trimmed string, unique per campaign.
   */
  @Column('varchar', { length: 20, name: 'citizen_id' })
  @ApiProperty({ description: 'Số CCCD — khoá đối chiếu khi quét thẻ' })
  citizenId: string;

  @Column('varchar', { length: 100, name: 'class_name', nullable: true })
  @ApiPropertyOptional({ description: 'Lớp — chỉ để hiển thị, không dùng đối chiếu' })
  className?: string | null;

  @Column('varchar', { length: 255, nullable: true })
  @ApiPropertyOptional({ description: 'Chuyên ngành — chỉ để hiển thị' })
  major?: string | null;

  @Column('varchar', { length: 20, name: 'academic_year', nullable: true })
  @ApiPropertyOptional({ description: 'Năm học, ví dụ "2025-2026" — chỉ để hiển thị' })
  academicYear?: string | null;
}
