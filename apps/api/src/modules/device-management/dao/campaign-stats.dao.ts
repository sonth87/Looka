import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * The "tối thiểu cần có" snapshot from
 * docs/plans/multi-camera-device-management-discussion.md §3.4: counts, not
 * yet the time-based averages that doc also asks for (that needs
 * `sending_started_at`-style timestamps this pass doesn't add — see that
 * section's own open question #15).
 */
/** Photo counts for a campaign (or summed across all of them) — see `SessionListItemDao` for the ready/pending/failed definitions this reuses. */
export class CampaignPhotoStatsDao {
  @ApiProperty()
  total: number;

  @ApiProperty()
  ready: number;

  @ApiProperty()
  pending: number;

  @ApiProperty()
  failed: number;
}

/** One device's row inside `CampaignStatsDao.byDevice` (A.8). */
export class CampaignDeviceStatsDao {
  @ApiProperty()
  deviceId: string;

  @ApiProperty()
  deviceName: string;

  @ApiProperty({ description: 'Số phiên đã hoàn tất trên thiết bị này' })
  sessions: number;

  @ApiProperty()
  photosReady: number;

  @ApiProperty()
  photosFailed: number;

  @ApiPropertyOptional({ description: 'Lần chụp gần nhất trên thiết bị này' })
  lastCaptureAt?: Date;
}

/** One day's row inside `CampaignStatsDao.byDay` — last 30 days, Asia/Ho_Chi_Minh (A.8). */
export class CampaignDayStatsDao {
  @ApiProperty({ example: '2026-09-06' })
  date: string;

  @ApiProperty()
  sessions: number;

  @ApiProperty()
  photos: number;
}

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

  /** Completed sessions recorded in `sessions` for this campaign (A.8) — distinct from `sessionsCompleted` above, which counts SESSION_COMPLETED device events instead. */
  @ApiProperty()
  sessions: number;

  @ApiProperty({ type: CampaignPhotoStatsDao })
  photos: CampaignPhotoStatsDao;

  @ApiProperty({ type: [CampaignDeviceStatsDao] })
  byDevice: CampaignDeviceStatsDao[];

  @ApiProperty({
    type: [CampaignDayStatsDao],
    description: '30 ngày gần nhất, giờ Việt Nam',
  })
  byDay: CampaignDayStatsDao[];
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

  @ApiProperty({
    description: 'Tổng số phiên đã hoàn tất, cộng dồn từ sessions (A.8)',
  })
  totalSessions: number;

  @ApiProperty({ type: CampaignPhotoStatsDao })
  totalPhotos: CampaignPhotoStatsDao;

  @ApiProperty({ type: [CampaignStatsSummaryItemDao] })
  campaigns: CampaignStatsSummaryItemDao[];
}
