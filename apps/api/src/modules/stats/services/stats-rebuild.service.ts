import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { CaptureStatsService } from './capture-stats.service';
import { CampaignSnapshotService } from './campaign-snapshot.service';
import { StatsJobService } from './stats-job.service';

/**
 * `POST /v1/stats/rebuild {from, to, campaignId?}` — cms-8-screens-api-plan.md
 * §2.9, "dùng khi sửa logic đếm hoặc nhập dữ liệu cũ". Runs the SAME
 * timing/breakdown recompute `DailyRecomputeWorker` runs nightly, but over
 * an admin-chosen date range and (optionally) one campaign, plus a snapshot
 * refresh at the end. Starts the `stats_jobs` row synchronously (so the
 * caller gets an id back immediately) and does the actual work
 * fire-and-forget — a real multi-day rebuild can run long, and the plan's
 * own wording ("chạy job nền") asks for background execution, unlike P3's
 * roster import (a single bounded file a human is already waiting on).
 */
@Injectable()
export class StatsRebuildService {
  private readonly logger = new Logger(StatsRebuildService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly captureStats: CaptureStatsService,
    private readonly snapshotService: CampaignSnapshotService,
    private readonly jobService: StatsJobService,
  ) {}

  async rebuild(input: {
    from: string;
    to: string;
    campaignId?: string | null;
    triggeredByUserId: string | null;
  }): Promise<{ jobId: string }> {
    const job = await this.jobService.start({
      kind: 'REBUILD',
      rangeFrom: input.from,
      rangeTo: input.to,
      scope: input.campaignId ? { campaignId: input.campaignId } : null,
      triggeredByUserId: input.triggeredByUserId,
    });

    void this.runRebuild(
      job.id,
      input.from,
      input.to,
      input.campaignId ?? null,
    );

    return { jobId: job.id };
  }

  private async runRebuild(
    jobId: string,
    from: string,
    to: string,
    campaignId: string | null,
  ): Promise<void> {
    try {
      const campaignIds = campaignId ? [campaignId] : null;
      let rowsWritten = 0;

      for (const date of this.datesBetween(from, to)) {
        rowsWritten += await this.dataSource.transaction((manager) =>
          this.captureStats.recomputeTimingAndBreakdowns(
            manager,
            date,
            campaignIds,
          ),
        );
      }
      rowsWritten += await this.snapshotService.refresh(campaignIds);

      await this.jobService.finish(jobId, rowsWritten);
    } catch (error) {
      this.logger.error(
        `stats rebuild ${jobId} failed: ${(error as Error).message}`,
        (error as Error).stack,
      );
      await this.jobService
        .fail(jobId, (error as Error).message)
        .catch(() => undefined);
    }
  }

  /**
   * `from`/`to` are already plain VN-local calendar-date strings (what the
   * admin typed, or what `GET /v1/stats/jobs` shows) — iterated as plain
   * dates, deliberately NOT through `vnDateString()` (that helper converts
   * an instant/timestamp into a calendar date; applying it here would
   * shift an already-correct calendar date by the same +7h offset a second
   * time).
   */
  private datesBetween(from: string, to: string): string[] {
    const dates: string[] = [];
    let cursor = new Date(`${from}T00:00:00Z`);
    const end = new Date(`${to}T00:00:00Z`);
    while (cursor.getTime() <= end.getTime()) {
      dates.push(cursor.toISOString().slice(0, 10));
      cursor = new Date(cursor.getTime() + 24 * 3_600_000);
    }
    return dates;
  }
}
