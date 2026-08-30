import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CommonService } from '@app/modules/shared/common/common.service';
import { CampaignStatsDao } from '../dao';
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
}
