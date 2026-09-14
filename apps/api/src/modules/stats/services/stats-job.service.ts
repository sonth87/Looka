import { CommonService } from '@app/shared/common/common.service';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, Repository } from 'typeorm';
import { StatsJob } from '../entities/stats-job.entity';
import type { StatsJobKind } from '../stats.constants';

/** `stats_jobs` — the operational log backing `GET /v1/stats/jobs`/`GET /v1/stats/health`, and the row every cron tick/manual rebuild writes. */
@Injectable()
export class StatsJobService extends CommonService<StatsJob> {
  constructor(
    @InjectRepository(StatsJob)
    repository: Repository<StatsJob>,
  ) {
    super(repository);
  }

  async start(input: {
    kind: StatsJobKind;
    rangeFrom?: string | null;
    rangeTo?: string | null;
    scope?: Record<string, unknown> | null;
    triggeredByUserId?: string | null;
  }): Promise<StatsJob> {
    return this.create({
      kind: input.kind,
      rangeFrom: input.rangeFrom ?? null,
      rangeTo: input.rangeTo ?? null,
      scope: input.scope ?? null,
      status: 'RUNNING',
      startedAt: new Date(),
      triggeredByUserId: input.triggeredByUserId ?? null,
    });
  }

  async finish(id: string, rowsWritten: number): Promise<void> {
    await this.update(id, {
      status: 'DONE',
      finishedAt: new Date(),
      rowsWritten,
    });
  }

  async fail(id: string, error: string): Promise<void> {
    await this.update(id, { status: 'FAILED', finishedAt: new Date(), error });
  }

  async list(query: {
    kind?: StatsJobKind;
    status?: string;
    page?: number;
    limit?: number;
  }): Promise<{ items: StatsJob[]; total: number }> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const [items, total] = await this.repository.findAndCount({
      where: {
        ...(query.kind ? { kind: query.kind } : {}),
        ...(query.status ? { status: query.status } : {}),
      } as FindOptionsWhere<StatsJob>,
      order: { startedAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return { items, total };
  }

  /**
   * `GET /v1/stats/health` — last run + outcome of each cron kind, and
   * whether either is overdue (a `SNAPSHOT_REFRESH` more than 15 minutes
   * stale, or a `DAILY_RECOMPUTE` more than 26 hours stale — 2x their own
   * schedule plus slack).
   */
  async health(): Promise<{
    snapshotRefresh: {
      lastRunAt: Date | null;
      lastStatus: string | null;
      overdue: boolean;
    };
    dailyRecompute: {
      lastRunAt: Date | null;
      lastStatus: string | null;
      overdue: boolean;
    };
  }> {
    const [lastSnapshot, lastDaily] = await Promise.all([
      this.repository.findOne({
        where: { kind: 'SNAPSHOT_REFRESH' },
        order: { startedAt: 'DESC' },
      }),
      this.repository.findOne({
        where: { kind: 'DAILY_RECOMPUTE' },
        order: { startedAt: 'DESC' },
      }),
    ]);
    const now = Date.now();
    return {
      snapshotRefresh: {
        lastRunAt: lastSnapshot?.startedAt ?? null,
        lastStatus: lastSnapshot?.status ?? null,
        overdue:
          !lastSnapshot || now - lastSnapshot.startedAt.getTime() > 15 * 60_000,
      },
      dailyRecompute: {
        lastRunAt: lastDaily?.startedAt ?? null,
        lastStatus: lastDaily?.status ?? null,
        overdue:
          !lastDaily || now - lastDaily.startedAt.getTime() > 26 * 3_600_000,
      },
    };
  }
}
