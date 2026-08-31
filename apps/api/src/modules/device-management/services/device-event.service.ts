import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CommonService } from '@app/modules/shared/common/common.service';
import { AllCampaignsStatsDao, CampaignStatsDao, CampaignStatsSummaryItemDao } from '../dao';
import { DeviceEventInput } from '../dto/create-device-events.dto';
import { Device } from '../entities/device.entity';
import { DeviceEvent, DeviceEventType } from '../entities/device-event.entity';

@Injectable()
export class DeviceEventService extends CommonService<DeviceEvent> {
  constructor(
    @InjectRepository(DeviceEvent)
    repository: Repository<DeviceEvent>,
    @InjectRepository(Device)
    private readonly deviceRepository: Repository<Device>,
  ) {
    super(repository);
  }

  /**
   * Stores a batch as-is — no dedup, no idempotency key. Unlike
   * `UploadOutboxRepository.enqueue()` (which a kiosk retries against the
   * exact same idem_key until it lands), a stats event is a count, not a
   * durable artifact: an occasional duplicate slightly over-counts one
   * number, which is a far smaller problem than the dedup machinery needed
   * to prevent it. Kept simple on purpose for a first version.
   */
  async recordBatch(deviceId: string, campaignId: string, events: DeviceEventInput[]): Promise<number> {
    if (events.length === 0) return 0;
    const rows = events.map((e) =>
      this.new({
        deviceId,
        campaignId,
        type: e.type,
        occurredAt: new Date(e.occurredAt),
        metadata: e.metadata ?? null,
      }),
    );
    await this.repository.save(rows);
    return rows.length;
  }

  /**
   * The "tối thiểu cần có" snapshot from that doc's §3.4 — counts only, see
   * `CampaignStatsDao`'s own doc comment for what's deliberately not here
   * yet (time-based averages).
   */
  async campaignStats(campaignId: string): Promise<CampaignStatsDao> {
    const deviceCount = await this.deviceRepository.count({ where: { campaignId } });

    const rows = await this.repository
      .createQueryBuilder('e')
      .select('e.type', 'type')
      .addSelect('COUNT(*)', 'count')
      .where('e.campaign_id = :campaignId', { campaignId })
      .groupBy('e.type')
      .getRawMany<{ type: DeviceEventType; count: string }>();

    const countByType = new Map(rows.map((r) => [r.type, Number(r.count)]));

    const stats = new CampaignStatsDao();
    stats.campaignId = campaignId;
    stats.deviceCount = deviceCount;
    stats.sessionsCompleted = countByType.get(DeviceEventType.SESSION_COMPLETED) ?? 0;
    stats.uploadSuccess = countByType.get(DeviceEventType.UPLOAD_SUCCESS) ?? 0;
    stats.uploadFailed = countByType.get(DeviceEventType.UPLOAD_FAILED) ?? 0;
    stats.retakes = countByType.get(DeviceEventType.RETAKE) ?? 0;
    stats.cbHelpInterventions = countByType.get(DeviceEventType.CB_HELP_INTERVENTION) ?? 0;
    return stats;
  }


  /**
   * Same counts as `campaignStats()`, summed across every campaign, plus the
   * per-campaign breakdown they were summed from — for the CMS's overview
   * page (see `AllCampaignsStatsDao`'s own doc comment). Two grouped queries
   * total, not one call to `campaignStats()` per campaign, so this stays
   * cheap regardless of how many campaigns exist.
   *
   * `campaigns` is supplied by the caller (`CampaignController`, via
   * `CampaignService.findAllCampaigns()`) rather than queried here — this
   * service owns event/device counts, not campaign identity, matching how
   * `campaignStats()` already leaves campaign-existence checks to the
   * controller.
   */
  async allCampaignsStats(campaigns: { id: string; name: string }[]): Promise<AllCampaignsStatsDao> {
    const deviceRows = await this.deviceRepository
      .createQueryBuilder('d')
      .select('d.campaign_id', 'campaignId')
      .addSelect('COUNT(*)', 'count')
      .groupBy('d.campaign_id')
      .getRawMany<{ campaignId: string; count: string }>();
    const deviceCountByCampaign = new Map(deviceRows.map((r) => [r.campaignId, Number(r.count)]));

    const eventRows = await this.repository
      .createQueryBuilder('e')
      .select('e.campaign_id', 'campaignId')
      .addSelect('e.type', 'type')
      .addSelect('COUNT(*)', 'count')
      .groupBy('e.campaign_id')
      .addGroupBy('e.type')
      .getRawMany<{ campaignId: string; type: DeviceEventType; count: string }>();
    const eventCountByCampaign = new Map<string, Map<DeviceEventType, number>>();
    for (const row of eventRows) {
      if (!eventCountByCampaign.has(row.campaignId)) eventCountByCampaign.set(row.campaignId, new Map());
      eventCountByCampaign.get(row.campaignId)!.set(row.type, Number(row.count));
    }

    const summary = new AllCampaignsStatsDao();
    summary.totalCampaigns = campaigns.length;
    summary.totalDevices = 0;
    summary.totalSessionsCompleted = 0;
    summary.totalUploadSuccess = 0;
    summary.totalUploadFailed = 0;
    summary.totalRetakes = 0;
    summary.totalCbHelpInterventions = 0;
    summary.campaigns = campaigns.map((campaign) => {
      const countByType = eventCountByCampaign.get(campaign.id) ?? new Map<DeviceEventType, number>();
      const item = new CampaignStatsSummaryItemDao();
      item.campaignId = campaign.id;
      item.campaignName = campaign.name;
      item.deviceCount = deviceCountByCampaign.get(campaign.id) ?? 0;
      item.sessionsCompleted = countByType.get(DeviceEventType.SESSION_COMPLETED) ?? 0;
      item.uploadSuccess = countByType.get(DeviceEventType.UPLOAD_SUCCESS) ?? 0;
      item.uploadFailed = countByType.get(DeviceEventType.UPLOAD_FAILED) ?? 0;
      item.retakes = countByType.get(DeviceEventType.RETAKE) ?? 0;
      item.cbHelpInterventions = countByType.get(DeviceEventType.CB_HELP_INTERVENTION) ?? 0;

      summary.totalDevices += item.deviceCount;
      summary.totalSessionsCompleted += item.sessionsCompleted;
      summary.totalUploadSuccess += item.uploadSuccess;
      summary.totalUploadFailed += item.uploadFailed;
      summary.totalRetakes += item.retakes;
      summary.totalCbHelpInterventions += item.cbHelpInterventions;

      return item;
    });

    return summary;
  }
}
