import { ApiProperty } from '@nestjs/swagger';
import { Expose, Type } from 'class-transformer';
import { CampaignDao } from './campaign.dao';
import { MembershipDao } from './campaign-member.dao';

/**
 * One row of `GET /v1/me/campaigns` — a `CampaignDao` plus the caller's own
 * membership status for it.
 *
 * Used to also carry `assignedDevices[]` (D-Q17, cms-8-screens-api-plan.md
 * §9.3) — which kiosk(s) under this campaign were assigned to the caller,
 * via the now-deleted `campaign_kiosk_assignments` pairing. Removed
 * 2026-09-18 alongside that whole table: nothing on the kiosk/desktop side
 * ever actually consumed this field (confirmed by a repo-wide search before
 * removal), and campaign access no longer runs through a device pairing at
 * all — see `CampaignMemberService.grant()`'s own doc comment for the
 * replacement flow.
 */
export class MeCampaignDao extends CampaignDao {
  @ApiProperty({ type: MembershipDao })
  @Expose()
  @Type(() => MembershipDao)
  membership: MembershipDao;
}
