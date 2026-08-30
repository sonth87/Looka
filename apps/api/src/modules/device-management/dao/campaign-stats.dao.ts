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
