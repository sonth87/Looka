import { ApiProperty } from '@nestjs/swagger';
import { Expose, Type } from 'class-transformer';
import { CampaignDao } from './campaign.dao';
import { MembershipDao } from './campaign-member.dao';

/** One row of `GET /v1/me/campaigns` — a `CampaignDao` plus the caller's own membership status for it. */
export class MeCampaignDao extends CampaignDao {
  @ApiProperty({ type: MembershipDao })
  @Expose()
  @Type(() => MembershipDao)
  membership: MembershipDao;
}
