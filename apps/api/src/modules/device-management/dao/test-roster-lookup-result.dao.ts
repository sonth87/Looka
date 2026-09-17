import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Expose } from 'class-transformer';
import { CampaignSubjectDao } from './campaign-subject.dao';

/**
 * `POST /v1/campaigns/:id/subjects/test-roster-lookup` response (plan §E.3,
 * `upload-identity-and-workflow-cleanup-plan-2026-09-17.md`) — a dry-run of
 * `lookupSubject`'s ROSTER branch against a campaign's already-imported
 * roster, evaluated against `rules` sent straight from the NOT-YET-SAVED
 * workflow-editor form. See `CampaignSubjectService.testRosterLookup`'s own
 * doc comment for why this never writes `eligibility_check_logs`.
 */
export class TestRosterLookupResultDao {
  @ApiProperty({ description: 'Có tìm thấy dòng roster khớp key này không' })
  @Expose()
  found: boolean;

  @ApiPropertyOptional({ type: CampaignSubjectDao })
  @Expose()
  subject: CampaignSubjectDao | null;

  @ApiProperty()
  @Expose()
  eligible: boolean;

  @ApiPropertyOptional()
  @Expose()
  reason?: string;

  @ApiPropertyOptional({
    description: 'Context field đã đưa vào rule evaluator, để CMS hiện preview',
  })
  @Expose()
  context?: Record<string, unknown>;
}
