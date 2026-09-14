import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Expose, Type } from 'class-transformer';
import { CampaignDao } from './campaign.dao';
import { MembershipDao } from './campaign-member.dao';
import { DeviceDao } from './device.dao';

/**
 * One row of `GET /v1/me/campaigns` — a `CampaignDao` plus the caller's own
 * membership status for it, and (D-Q17, cms-8-screens-api-plan.md §9.3)
 * which kiosk(s) under this campaign are assigned to the caller. The kiosk
 * compares its own `deviceId` against this list: a match means walk
 * straight in, no match means show these instead of blocking (D-Q17's own
 * "không chặn" default).
 */
export class MeCampaignDao extends CampaignDao {
  @ApiProperty({ type: MembershipDao })
  @Expose()
  @Type(() => MembershipDao)
  membership: MembershipDao;

  @ApiPropertyOptional({ type: [DeviceDao] })
  @Expose()
  @Type(() => DeviceDao)
  assignedDevices: DeviceDao[];
}
