import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Expose } from 'class-transformer';
import type { CampaignSubjectStatus } from '../entities/campaign-subject.entity';

export class CampaignSubjectDao {
  @ApiProperty()
  @Expose()
  id: string;

  @ApiProperty()
  @Expose()
  campaignId: string;

  @ApiProperty()
  @Expose()
  importId: string;

  @ApiProperty()
  @Expose()
  rowNo: number;

  @ApiProperty()
  @Expose()
  subjectCode: string;

  @ApiProperty()
  @Expose()
  fullName: string;

  @ApiPropertyOptional()
  @Expose()
  citizenId?: string | null;

  @ApiPropertyOptional()
  @Expose()
  className?: string | null;

  @ApiPropertyOptional()
  @Expose()
  faculty?: string | null;

  @ApiPropertyOptional()
  @Expose()
  major?: string | null;

  @ApiPropertyOptional()
  @Expose()
  dateOfBirth?: string | null;

  @ApiPropertyOptional()
  @Expose()
  cardValidUntil?: string | null;

  @ApiProperty({ enum: ['VALID', 'ERROR', 'DUPLICATE'] })
  @Expose()
  status: CampaignSubjectStatus;

  @ApiPropertyOptional()
  @Expose()
  errorMessage?: string | null;

  @ApiProperty()
  @Expose()
  createdAt: Date;
}

/**
 * `GET /v1/campaigns/:id/subjects/lookup?key=` response — kiosk-facing
 * (`DeviceCredentialsGuard`). Behavior now follows the campaign's own
 * `eligibilityConfig.mode` (2026-09-18, moved off the pinned workflow;
 * plan §2.2/§2.3) — see
 * `CampaignSubjectService.lookupSubject`'s own doc comment for the full
 * NONE/ROSTER/EXTERNAL_API/ROSTER_AND_API breakdown. `subject` is only ever
 * a real `campaign_subjects` roster row; `externalRecord` (additive,
 * §9.1 rule 1 — a plain-array kiosk build that doesn't know this field
 * exists just ignores it) carries the raw external-API record when the
 * match came from `DainamStudentInfoClient` and no roster row exists to
 * populate `subject` from (`EXTERNAL_API` mode, or `ROSTER_AND_API` with a
 * roster hit — `subject` and `externalRecord` are NOT mutually exclusive
 * for that mode, both are populated so a caller can see exactly what each
 * source contributed).
 */
export class CampaignSubjectLookupDao {
  @ApiProperty()
  @Expose()
  eligible: boolean;

  @ApiPropertyOptional()
  @Expose()
  reason?: string;

  @ApiPropertyOptional({ type: CampaignSubjectDao })
  @Expose()
  subject?: CampaignSubjectDao | null;

  @ApiPropertyOptional({
    description:
      'Bản ghi thô từ API sinh viên ngoài, nếu mode là EXTERNAL_API/ROSTER_AND_API và tra được',
  })
  @Expose()
  externalRecord?: Record<string, unknown> | null;
}
