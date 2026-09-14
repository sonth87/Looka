import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../../shared/database/base.entity';
import type { StatsJobKind, StatsJobStatus } from '../stats.constants';

/** Append-only operational log — §2.9. One row per cron tick (`SNAPSHOT_REFRESH`/`DAILY_RECOMPUTE`) or manual `POST /v1/stats/rebuild` call, backing `GET /v1/stats/jobs` and `GET /v1/stats/health`. */
@Entity('stats_jobs')
export class StatsJob extends BaseEntity {
  @Column('varchar', { length: 20 })
  @Index()
  kind: StatsJobKind;

  @Column('date', { nullable: true, name: 'range_from' })
  rangeFrom?: string | null;

  @Column('date', { nullable: true, name: 'range_to' })
  rangeTo?: string | null;

  @Column('jsonb', { nullable: true })
  scope?: Record<string, unknown> | null;

  @Column('varchar', { length: 10 })
  @Index()
  status: StatsJobStatus;

  @Column('timestamptz', { name: 'started_at' })
  startedAt: Date;

  @Column('timestamptz', { nullable: true, name: 'finished_at' })
  finishedAt?: Date | null;

  @Column('int', { default: 0, name: 'rows_written' })
  rowsWritten: number;

  @Column('text', { nullable: true })
  error?: string | null;

  @Column('uuid', { nullable: true, name: 'triggered_by_user_id' })
  triggeredByUserId?: string | null;
}
