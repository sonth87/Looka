import { AdvisoryLockService } from '@app/shared/database/advisory-lock.service';
import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { Cron } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import { CaptureStatsService } from '../services/capture-stats.service';
import { StatsJobService } from '../services/stats-job.service';
import { vnDateDaysAgo } from '../util/vn-date.util';

/**
 * `DAILY_RECOMPUTE`, 01:00 every day — cms-8-screens-api-plan.md §2.9,
 * "tính lại D-1 và D-2" (yesterday and the day before, so a kiosk batch
 * that arrived just after midnight still gets folded in on the next run).
 * Same advisory-lock discipline as `SnapshotRefreshWorker`.
 */
@Injectable()
export class DailyRecomputeWorker {
  private readonly logger = new Logger(DailyRecomputeWorker.name);
  private running = false;

  constructor(
    private readonly lock: AdvisoryLockService,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly captureStats: CaptureStatsService,
    private readonly jobService: StatsJobService,
  ) {}

  @Cron('0 1 * * *')
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.lock.withLock('stats_daily_recompute', async () => {
        const dates = [vnDateDaysAgo(1), vnDateDaysAgo(2)];
        const job = await this.jobService.start({
          kind: 'DAILY_RECOMPUTE',
          rangeFrom: dates[1],
          rangeTo: dates[0],
        });
        try {
          let rowsWritten = 0;
          for (const date of dates) {
            rowsWritten += await this.dataSource.transaction((manager) =>
              this.captureStats.recomputeTimingAndBreakdowns(
                manager,
                date,
                null,
              ),
            );
          }
          await this.jobService.finish(job.id, rowsWritten);
        } catch (error) {
          await this.jobService.fail(job.id, (error as Error).message);
          throw error;
        }
      });
    } catch (error) {
      this.logger.error(
        `daily recompute tick failed: ${(error as Error).message}`,
      );
    } finally {
      this.running = false;
    }
  }
}
