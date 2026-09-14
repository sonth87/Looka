import { Column, Entity, Index, Unique } from 'typeorm';
import { BaseEntity } from '../../../shared/database/base.entity';

/**
 * One `(date, campaign, printer)` bucket — §2.9. Table created now per the
 * plan's full DB list, but **left unpopulated this pass**: its only source
 * (`PrintService`, `PrintChannel` status callbacks) doesn't exist yet —
 * print batches/items/printers are P5/P6 scope. Ready for P6 to fill in
 * without another migration.
 */
@Entity('stats_daily_print')
@Unique('UQ_stats_daily_print_key', ['date', 'campaignId', 'printerId'])
export class StatsDailyPrint extends BaseEntity {
  @Column('date') date: string;

  @Column('uuid', { name: 'campaign_id' })
  @Index()
  campaignId: string;

  @Column('uuid', { name: 'printer_id' })
  printerId: string;

  @Column('int', { default: 0 })
  rendered: number;

  @Column('int', { default: 0 })
  printed: number;

  @Column('int', { default: 0 })
  failed: number;

  @Column('int', { default: 0 })
  reprints: number;

  @Column('int', { default: 0, name: 'blank_used' })
  blankUsed: number;

  @Column('timestamptz', { name: 'computed_at' })
  computedAt: Date;
}
