import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { STATS_UNKNOWN_UUID } from '../stats.constants';
import { vnDateString } from '../util/vn-date.util';

type PrintCountColumn = 'rendered' | 'printed' | 'failed' | 'reprints';

/**
 * `stats_daily_print` — cms-8-screens-api-plan.md §2.9/P6, the one hook P4
 * left for this phase to fill in (see `StatsDailyPrint`'s own doc comment,
 * written at P4 time: "Ready for P6 to fill in without another migration").
 * Same shape/pattern as `ReviewStatsService`: called from inside
 * `modules/print`'s own transactions (`PrintItemService`), with that
 * transaction's `manager`, one `INSERT ... ON CONFLICT DO UPDATE` per
 * counter. Lives here (not inside `modules/print`) for the same reason
 * `CaptureStatsService`/`ReviewStatsService` live here rather than inside
 * `capture`/`photo-review` — every `stats_daily_*` writer is grouped in one
 * module so `StatsQueryService`/the nightly recompute/the dashboard all
 * have one place to look, and `modules/print` never needs its own
 * `TypeOrmModule.forFeature([StatsDailyPrint])` — it goes through this
 * service instead, same boundary rule as every other cross-module read
 * here (raw SQL, no entity import — this file being the one exception,
 * since it and `StatsDailyPrint` already live in the same module).
 *
 * `printerId` uses the `STATS_UNKNOWN_UUID` sentinel (not a real NULL) when
 * a count happens before a printer is known — e.g. `render()` can run on an
 * item that has no `printerId` yet (CENTRALIZED batches often never get
 * one) — same reasoning every other `stats_daily_*` grouping column already
 * documents: a real NULL would break the `UNIQUE(date, campaign_id,
 * printer_id)` upsert key (two NULLs never conflict in Postgres), silently
 * fragmenting one campaign's counts across a fresh row per insert instead
 * of accumulating.
 */
@Injectable()
export class PrintStatsService {
  private async increment(
    manager: EntityManager,
    date: string,
    campaignId: string,
    printerId: string | null,
    column: PrintCountColumn,
    by: number,
  ): Promise<void> {
    await manager.query(
      `INSERT INTO stats_daily_print (date, campaign_id, printer_id, ${column}, computed_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (date, campaign_id, printer_id)
       DO UPDATE SET ${column} = stats_daily_print.${column} + EXCLUDED.${column}, computed_at = now()`,
      [date, campaignId, printerId || STATS_UNKNOWN_UUID, by],
    );
  }

  async recordRendered(
    manager: EntityManager,
    campaignId: string,
    printerId: string | null,
    at: Date,
  ): Promise<void> {
    await this.increment(
      manager,
      vnDateString(at),
      campaignId,
      printerId,
      'rendered',
      1,
    );
  }

  /** Also bumps `blank_used` — one printed card consumes exactly one blank, same count `PrinterService.applyStockDelta`'s `PRINT` stock event decrements. */
  async recordPrinted(
    manager: EntityManager,
    campaignId: string,
    printerId: string | null,
    at: Date,
  ): Promise<void> {
    const date = vnDateString(at);
    await this.increment(manager, date, campaignId, printerId, 'printed', 1);
    await manager.query(
      `INSERT INTO stats_daily_print (date, campaign_id, printer_id, blank_used, computed_at)
       VALUES ($1, $2, $3, 1, now())
       ON CONFLICT (date, campaign_id, printer_id)
       DO UPDATE SET blank_used = stats_daily_print.blank_used + 1, computed_at = now()`,
      [date, campaignId, printerId || STATS_UNKNOWN_UUID],
    );
  }

  async recordFailed(
    manager: EntityManager,
    campaignId: string,
    printerId: string | null,
    at: Date,
  ): Promise<void> {
    await this.increment(
      manager,
      vnDateString(at),
      campaignId,
      printerId,
      'failed',
      1,
    );
  }

  async recordReprint(
    manager: EntityManager,
    campaignId: string,
    printerId: string | null,
    at: Date,
  ): Promise<void> {
    await this.increment(
      manager,
      vnDateString(at),
      campaignId,
      printerId,
      'reprints',
      1,
    );
  }
}
