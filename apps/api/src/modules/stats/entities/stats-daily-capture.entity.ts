import { Column, Entity, Index, Unique } from 'typeorm';
import { BaseEntity } from '../../../shared/database/base.entity';

/**
 * One `(date, campaign, device, operator)` bucket — cms-8-screens-api-plan.md
 * §2.9. `deviceId`/`operatorUserId` are `uuid NOT NULL DEFAULT
 * STATS_UNKNOWN_UUID` (never a real nullable column) — see
 * `stats.constants.ts`'s own doc comment for why: Postgres `UNIQUE` treats
 * two NULLs as distinct, which would break the `ON CONFLICT (...) DO UPDATE
 * SET col = col + n` upsert this table lives on.
 *
 * `byTrigger`/`byCaptureMode` (jsonb `{AUTO:5, GESTURE:2, ...}`) and
 * `timingP50Ms`/`timingP95Ms` are populated ONLY by the nightly
 * `DAILY_RECOMPUTE` cron, never the action-based hot path — see
 * `CaptureStatsService`'s own doc comment for why an incremental jsonb
 * merge-upsert and true percentiles are cron-only by design, not a gap.
 */
@Entity('stats_daily_captures')
@Unique('UQ_stats_daily_captures_key', [
  'date',
  'campaignId',
  'deviceId',
  'operatorUserId',
])
export class StatsDailyCapture extends BaseEntity {
  @Column('date') date: string;

  @Column('uuid', { name: 'campaign_id' })
  @Index()
  campaignId: string;

  @Column('uuid', { name: 'device_id' })
  deviceId: string;

  @Column('uuid', { name: 'operator_user_id' })
  operatorUserId: string;

  @Column('int', { default: 0, name: 'sessions_started' })
  sessionsStarted: number;

  @Column('int', { default: 0, name: 'sessions_completed' })
  sessionsCompleted: number;

  @Column('int', { default: 0, name: 'subjects_captured' })
  subjectsCaptured: number;

  @Column('int', { default: 0, name: 'photos_total' })
  photosTotal: number;

  @Column('int', { default: 0, name: 'photos_ready' })
  photosReady: number;

  @Column('int', { default: 0, name: 'photos_failed' })
  photosFailed: number;

  @Column('int', { default: 0 })
  retakes: number;

  @Column('int', { default: 0, name: 'cb_help' })
  cbHelp: number;

  @Column('jsonb', { default: {}, name: 'by_trigger' })
  byTrigger: Record<string, number>;

  @Column('jsonb', { default: {}, name: 'by_capture_mode' })
  byCaptureMode: Record<string, number>;

  @Column('int', { default: 0, name: 'timing_count' })
  timingCount: number;

  @Column('bigint', { default: 0, name: 'timing_sum_ms' })
  timingSumMs: string;

  @Column('int', { nullable: true, name: 'timing_min_ms' })
  timingMinMs?: number | null;

  @Column('int', { nullable: true, name: 'timing_max_ms' })
  timingMaxMs?: number | null;

  @Column('int', { nullable: true, name: 'timing_p50_ms' })
  timingP50Ms?: number | null;

  @Column('int', { nullable: true, name: 'timing_p95_ms' })
  timingP95Ms?: number | null;

  @Column('timestamptz', { name: 'computed_at' })
  computedAt: Date;
}
