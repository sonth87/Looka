import { AdvisoryLockService } from '@app/shared/database/advisory-lock.service';
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { CampaignSnapshotService } from '../services/campaign-snapshot.service';
import { StatsJobService } from '../services/stats-job.service';

/**
 * `SNAPSHOT_REFRESH`, every 5 minutes — cms-8-screens-api-plan.md §2.9.
 * `pg_try_advisory_lock` via the already-global `AdvisoryLockService`
 * (`shared/foundation.module.ts`) ensures exactly one replica's tick does
 * the work; every other replica's tick is a harmless no-op. Only runs in
 * `SERVICE_TYPE=worker`/`all` — see `app-worker.module.ts`'s own doc comment
 * for why `ScheduleModule.forRoot()` (and so `@Cron`) only actually fires
 * there.
 */
@Injectable()
export class SnapshotRefreshWorker {
  private readonly logger = new Logger(SnapshotRefreshWorker.name);
  private running = false;

  constructor(
    private readonly lock: AdvisoryLockService,
    private readonly snapshotService: CampaignSnapshotService,
    private readonly jobService: StatsJobService,
  ) {}

  @Cron('*/5 * * * *')
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.lock.withLock('stats_snapshot_refresh', async () => {
        const job = await this.jobService.start({ kind: 'SNAPSHOT_REFRESH' });
        try {
          const rowsWritten = await this.snapshotService.refresh(null);
          await this.jobService.finish(job.id, rowsWritten);
        } catch (error) {
          await this.jobService.fail(job.id, (error as Error).message);
          throw error;
        }
      });
    } catch (error) {
      this.logger.error(
        `snapshot refresh tick failed: ${(error as Error).message}`,
      );
    } finally {
      this.running = false;
    }
  }
}
