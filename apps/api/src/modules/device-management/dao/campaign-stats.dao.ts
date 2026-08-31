import { ApiProperty } from '@nestjs/swagger';

/**
 * The "tối thiểu cần có" snapshot from
 * docs/plans/multi-camera-device-management-discussion.md §3.4: counts, not
 * yet the time-based averages that doc also asks for (that needs
 * `sending_started_at`-style timestamps this pass doesn't add — see that
 * section's own open question #15).
 */
export class CampaignStatsDao {
  @ApiProperty()
  campaignId: string;

  @ApiProperty()
  deviceCount: number;

  @ApiProperty()
  sessionsCompleted: number;

  @ApiProperty()
  uploadSuccess: number;

  @ApiProperty()
  uploadFailed: number;

  @ApiProperty()
  retakes: number;

  @ApiProperty()
  cbHelpInterventions: number;
}

/** One campaign's row inside `AllCampaignsStatsDao.campaigns` — same counts as `CampaignStatsDao`, plus the name a table needs to be readable without a second lookup. */
export class CampaignStatsSummaryItemDao extends CampaignStatsDao {
  @ApiProperty()
  campaignName: string;
}

/**
 * Sum of every campaign's `CampaignStatsDao`, plus the per-campaign
 * breakdown it was summed from — so a dashboard can show one grand total
 * without forcing a separate `GET :id/stats` call per campaign to build a
 * table underneath it.
 */
export class AllCampaignsStatsDao {
  @ApiProperty()
  totalCampaigns: number;

  @ApiProperty()
  totalDevices: number;

  @ApiProperty()
  totalSessionsCompleted: number;

  @ApiProperty()
  totalUploadSuccess: number;

  @ApiProperty()
  totalUploadFailed: number;

  @ApiProperty()
  totalRetakes: number;

  @ApiProperty()
  totalCbHelpInterventions: number;

  @ApiProperty({ type: [CampaignStatsSummaryItemDao] })
  campaigns: CampaignStatsSummaryItemDao[];
}
