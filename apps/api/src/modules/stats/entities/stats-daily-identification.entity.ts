import { Column, Entity, Index, Unique } from 'typeorm';
import { BaseEntity } from '../../../shared/database/base.entity';

/** One `(date, campaign, device, method)` bucket — §2.9. `method` is `STATS_UNKNOWN_METHOD` for a `SESSION_REPORT` that never reported one, `deviceId` is `STATS_UNKNOWN_UUID` — see that table's own doc comment for why both are NOT NULL sentinels, never real NULLs. */
@Entity('stats_daily_identification')
@Unique('UQ_stats_daily_identification_key', [
  'date',
  'campaignId',
  'deviceId',
  'method',
])
export class StatsDailyIdentification extends BaseEntity {
  @Column('date') date: string;

  @Column('uuid', { name: 'campaign_id' })
  @Index()
  campaignId: string;

  @Column('uuid', { name: 'device_id' })
  deviceId: string;

  @Column('varchar', { length: 30 })
  method: string;

  @Column('int', { default: 0 })
  count: number;

  @Column('timestamptz', { name: 'computed_at' })
  computedAt: Date;
}
