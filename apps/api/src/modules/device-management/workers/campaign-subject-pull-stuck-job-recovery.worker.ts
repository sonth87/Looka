import { AdvisoryLockService } from '@app/shared/database/advisory-lock.service';
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

/**
 * Housekeeping sweep for the 2-tier pull queue (plan §3.1's own "Chống
 * kẹt") — every 5 minutes, resets:
 * - `campaign_subject_imports` stuck at `FETCHING` for more than 30
 *   minutes (`CampaignSubjectPullFetchWorker` claimed it, then crashed
 *   before finishing) back to `PENDING_FETCH`, so the next fetch tick
 *   re-claims it.
 * - `campaign_subject_import_chunks` stuck at `PROCESSING` past their own
 *   claim window (`CampaignSubjectPullWriteWorker` claimed it, then
 *   crashed mid-transaction) back to `PENDING`, so the next write tick
 *   re-claims it — see that worker's own `claimNext` doc comment for why
 *   `next_retry_at` (not a dedicated timestamp column) is what "past its
 *   claim window" means here.
 *
 * Both resets are safe to run unconditionally: `CampaignSubjectPullWriteWorker`'s
 * upsert is idempotent (same `(campaign_id, subject_code)` conflict target
 * every time), and re-fetching from the API is a plain HTTP GET/POST with
 * no side effects — nothing here can double-apply or corrupt data, only
 * redo work that was already safely durable.
 */
@Injectable()
export class CampaignSubjectPullStuckJobRecoveryWorker {
  private readonly logger = new Logger(
    CampaignSubjectPullStuckJobRecoveryWorker.name,
  );
  private running = false;

  constructor(
    private readonly lock: AdvisoryLockService,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  @Cron('*/5 * * * *')
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.lock.withLock('campaign_subject_pull_stuck_recovery', () =>
        this.runOnce(),
      );
    } catch (error) {
      this.logger.error(
        `stuck-job recovery tick failed: ${(error as Error).message}`,
      );
    } finally {
      this.running = false;
    }
  }

  private async runOnce(): Promise<void> {
    // `[rows]: [T[], number]` destructure — a bare `DataSource.query()` for
    // `UPDATE ... RETURNING` returns a `[rows, rowCount]` tuple, not a flat
    // array (see `CampaignSubjectPullFetchWorker.claimNext`'s own doc
    // comment; confirmed empirically). Reading `.length` off the raw tuple
    // instead would always be 2, making every tick log a false "recovered 2
    // stuck job(s)" regardless of whether anything was actually stale.
    const [staleImports]: [Array<{ id: string }>, number] =
      await this.dataSource.query(
        `UPDATE campaign_subject_imports
            SET status = 'PENDING_FETCH', updated_at = now()
          WHERE status = 'FETCHING' AND updated_at < now() - interval '30 minutes'
          RETURNING id`,
      );
    if (staleImports.length > 0) {
      this.logger.warn(
        `recovered ${staleImports.length} stuck FETCHING import(s) back to PENDING_FETCH`,
      );
    }

    const [staleChunks]: [Array<{ id: string }>, number] =
      await this.dataSource.query(
        `UPDATE campaign_subject_import_chunks
            SET status = 'PENDING'
          WHERE status = 'PROCESSING' AND next_retry_at < now()
          RETURNING id`,
      );
    if (staleChunks.length > 0) {
      this.logger.warn(
        `recovered ${staleChunks.length} stuck PROCESSING chunk(s) back to PENDING`,
      );
    }
  }
}
