import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { STATS_UNKNOWN_METHOD, STATS_UNKNOWN_UUID } from '../stats.constants';
import { vnDateString } from '../util/vn-date.util';

type CaptureCountColumn =
  | 'sessions_started'
  | 'sessions_completed'
  | 'retakes'
  | 'cb_help'
  | 'photos_ready'
  | 'photos_failed';

/** Linear-interpolation percentile — same semantics as Postgres's `percentile_cont`, for a value already pulled into JS (see `recomputeTimingAndBreakdowns`'s own doc comment for why this runs in JS rather than SQL). */
function percentile(sortedValues: number[], p: number): number | null {
  if (sortedValues.length === 0) return null;
  const idx = p * (sortedValues.length - 1);
  const lower = Math.floor(idx);
  const upper = Math.ceil(idx);
  if (lower === upper) return Math.round(sortedValues[lower]);
  const weight = idx - lower;
  return Math.round(
    sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight,
  );
}

/**
 * `stats_daily_captures`/`stats_daily_identification` — cms-8-screens-api-plan.md
 * §2.9. Two update paths, as the plan specifies:
 *
 * 1. **Action-based** (`applyDeviceEvent`/`applySessionCompletedWeb`) —
 *    called from inside the SAME transaction as the source write
 *    (`DeviceEventService.recordBatch`, `SessionService.completeSession`),
 *    via `INSERT ... ON CONFLICT (key) DO UPDATE SET col = col + n`. Handles
 *    every simple counter (`sessions_started/completed`, `retakes`,
 *    `cb_help`, `photos_ready/failed`, `subjects_captured`, `photos_total`,
 *    `timing_count/sum/min/max_ms`, `stats_daily_identification.count`).
 * 2. **Nightly recompute** (`recomputeTimingAndBreakdowns`) — `by_trigger`/
 *    `by_capture_mode` (jsonb) and `timing_p50/p95_ms` (true percentiles)
 *    ONLY. **Deliberately does NOT redo the simple counters above** — a
 *    full from-scratch SQL reconstruction of every counter the action-based
 *    path already maintains was assessed as disproportionate complexity/risk
 *    for this pass (a near-duplicate of the hot-path's own logic, in raw
 *    SQL, with real risk of subtly disagreeing with it) for a reconciliation
 *    safety net whose absence does not break anything — the hot path is
 *    self-sufficient on its own. This scoped version still delivers the
 *    plan's own explicitly-stated REASON for making this a cron job at all:
 *    "đây là nơi tính timing_p50_ms/timing_p95_ms" (percentiles cannot be
 *    incremented) and jsonb breakdown aggregation (an incremental jsonb
 *    merge-upsert is exactly the kind of complexity this scoping avoids).
 *    A true "recompute every counter from scratch" pass remains a
 *    reasonable future improvement, not required now.
 */
@Injectable()
export class CaptureStatsService {
  private async increment(
    manager: EntityManager,
    date: string,
    campaignId: string,
    deviceId: string,
    operatorUserId: string,
    column: CaptureCountColumn,
    by: number,
  ): Promise<void> {
    await manager.query(
      `INSERT INTO stats_daily_captures (date, campaign_id, device_id, operator_user_id, ${column}, computed_at)
       VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (date, campaign_id, device_id, operator_user_id)
       DO UPDATE SET ${column} = stats_daily_captures.${column} + EXCLUDED.${column}, computed_at = now()`,
      [date, campaignId, deviceId, operatorUserId, by],
    );
  }

  /** Hook point inside `DeviceEventService.recordBatch`'s transaction — one call per kiosk device event. */
  async applyDeviceEvent(
    manager: EntityManager,
    input: {
      campaignId: string;
      deviceId: string;
      type: string;
      occurredAt: Date;
      metadata: Record<string, unknown> | null;
    },
  ): Promise<void> {
    const date = vnDateString(input.occurredAt);
    const deviceId = input.deviceId || STATS_UNKNOWN_UUID;

    switch (input.type) {
      case 'SESSION_STARTED':
        return this.increment(
          manager,
          date,
          input.campaignId,
          deviceId,
          STATS_UNKNOWN_UUID,
          'sessions_started',
          1,
        );
      case 'SESSION_COMPLETED':
        return this.increment(
          manager,
          date,
          input.campaignId,
          deviceId,
          STATS_UNKNOWN_UUID,
          'sessions_completed',
          1,
        );
      case 'RETAKE':
        return this.increment(
          manager,
          date,
          input.campaignId,
          deviceId,
          STATS_UNKNOWN_UUID,
          'retakes',
          1,
        );
      case 'CB_HELP_INTERVENTION':
        return this.increment(
          manager,
          date,
          input.campaignId,
          deviceId,
          STATS_UNKNOWN_UUID,
          'cb_help',
          1,
        );
      case 'UPLOAD_SUCCESS':
        return this.increment(
          manager,
          date,
          input.campaignId,
          deviceId,
          STATS_UNKNOWN_UUID,
          'photos_ready',
          1,
        );
      case 'UPLOAD_FAILED':
        return this.increment(
          manager,
          date,
          input.campaignId,
          deviceId,
          STATS_UNKNOWN_UUID,
          'photos_failed',
          1,
        );
      case 'SESSION_REPORT':
        return this.applySessionReport(
          manager,
          date,
          input.campaignId,
          deviceId,
          input.metadata,
        );
      default:
        // PHOTO_STATUS/VIDEO_STATUS/ATTEMPT_SUPERSEDED/unknown — nothing counted here.
        return;
    }
  }

  /** Hook point inside `SessionService.completeSession`'s transaction — the WEB-path (kiosk-web/`x-api-key`) counterpart of `SESSION_COMPLETED`. */
  async applySessionCompletedWeb(
    manager: EntityManager,
    campaignId: string | null | undefined,
    deviceId: string | null | undefined,
    operatorUserId: string | null | undefined,
    at: Date,
  ): Promise<void> {
    if (!campaignId) return;
    await this.increment(
      manager,
      vnDateString(at),
      campaignId,
      deviceId || STATS_UNKNOWN_UUID,
      operatorUserId || STATS_UNKNOWN_UUID,
      'sessions_completed',
      1,
    );
  }

  private async applySessionReport(
    manager: EntityManager,
    date: string,
    campaignId: string,
    deviceId: string,
    metadata: Record<string, unknown> | null,
  ): Promise<void> {
    if (!metadata) return;
    const operatorUserId =
      typeof metadata.operatorUserId === 'string' && metadata.operatorUserId
        ? metadata.operatorUserId
        : STATS_UNKNOWN_UUID;
    const photos = Array.isArray(metadata.photos)
      ? (metadata.photos as Array<Record<string, unknown>>)
      : [];

    await manager.query(
      `INSERT INTO stats_daily_captures (date, campaign_id, device_id, operator_user_id, subjects_captured, photos_total, computed_at)
       VALUES ($1, $2, $3, $4, 1, $5, now())
       ON CONFLICT (date, campaign_id, device_id, operator_user_id)
       DO UPDATE SET
         subjects_captured = stats_daily_captures.subjects_captured + 1,
         photos_total = stats_daily_captures.photos_total + EXCLUDED.photos_total,
         computed_at = now()`,
      [date, campaignId, deviceId, operatorUserId, photos.length],
    );

    const identifiedAt =
      typeof metadata.identifiedAt === 'string'
        ? Date.parse(metadata.identifiedAt)
        : NaN;
    const finishedAt =
      typeof metadata.finishedAt === 'string'
        ? Date.parse(metadata.finishedAt)
        : NaN;
    if (
      !Number.isNaN(identifiedAt) &&
      !Number.isNaN(finishedAt) &&
      finishedAt >= identifiedAt
    ) {
      const durationMs = finishedAt - identifiedAt;
      await manager.query(
        `INSERT INTO stats_daily_captures (date, campaign_id, device_id, operator_user_id, timing_count, timing_sum_ms, timing_min_ms, timing_max_ms, computed_at)
         VALUES ($1, $2, $3, $4, 1, $5, $5, $5, now())
         ON CONFLICT (date, campaign_id, device_id, operator_user_id)
         DO UPDATE SET
           timing_count = stats_daily_captures.timing_count + 1,
           timing_sum_ms = stats_daily_captures.timing_sum_ms + EXCLUDED.timing_sum_ms,
           timing_min_ms = LEAST(stats_daily_captures.timing_min_ms, EXCLUDED.timing_min_ms),
           timing_max_ms = GREATEST(stats_daily_captures.timing_max_ms, EXCLUDED.timing_max_ms),
           computed_at = now()`,
        [date, campaignId, deviceId, operatorUserId, durationMs],
      );
    }

    const method =
      typeof metadata.identificationMethod === 'string' &&
      metadata.identificationMethod
        ? metadata.identificationMethod
        : STATS_UNKNOWN_METHOD;
    await manager.query(
      `INSERT INTO stats_daily_identification (date, campaign_id, device_id, method, count, computed_at)
       VALUES ($1, $2, $3, $4, 1, now())
       ON CONFLICT (date, campaign_id, device_id, method)
       DO UPDATE SET count = stats_daily_identification.count + 1, computed_at = now()`,
      [date, campaignId, deviceId, method],
    );
  }

  /**
   * `DAILY_RECOMPUTE` — `by_trigger`/`by_capture_mode`/`timing_p50_ms`/
   * `timing_p95_ms` only, for one VN-local `date`. See this class's own doc
   * comment for why the simple counters are not redone here. Pulls raw
   * `SESSION_REPORT` metadata into JS and aggregates there (rather than a
   * `jsonb_array_elements` + `percentile_cont` SQL query) — simpler to get
   * right than the equivalent nested jsonb-aggregation SQL, and this runs
   * once a night over one day's rows, not a hot path.
   */
  async recomputeTimingAndBreakdowns(
    manager: EntityManager,
    date: string,
    campaignIds: string[] | null,
  ): Promise<number> {
    const rows: Array<{
      campaign_id: string;
      device_id: string;
      metadata: Record<string, unknown>;
    }> = await manager.query(
      `SELECT campaign_id, device_id, metadata FROM device_events
          WHERE type = 'SESSION_REPORT'
            AND to_char(occurred_at AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYYY-MM-DD') = $1
            AND ($2::uuid[] IS NULL OR campaign_id = ANY($2))`,
      [date, campaignIds],
    );

    interface Bucket {
      durations: number[];
      trigger: Map<string, number>;
      mode: Map<string, number>;
    }
    const buckets = new Map<string, Bucket>();

    for (const row of rows) {
      const metadata = row.metadata ?? {};
      const operatorUserId =
        typeof metadata.operatorUserId === 'string' && metadata.operatorUserId
          ? metadata.operatorUserId
          : STATS_UNKNOWN_UUID;
      const key = `${row.campaign_id}|${row.device_id}|${operatorUserId}`;
      const bucket: Bucket = buckets.get(key) ?? {
        durations: [],
        trigger: new Map(),
        mode: new Map(),
      };
      buckets.set(key, bucket);

      const identifiedAt =
        typeof metadata.identifiedAt === 'string'
          ? Date.parse(metadata.identifiedAt)
          : NaN;
      const finishedAt =
        typeof metadata.finishedAt === 'string'
          ? Date.parse(metadata.finishedAt)
          : NaN;
      if (
        !Number.isNaN(identifiedAt) &&
        !Number.isNaN(finishedAt) &&
        finishedAt >= identifiedAt
      ) {
        bucket.durations.push(finishedAt - identifiedAt);
      }

      const photos = Array.isArray(metadata.photos)
        ? (metadata.photos as Array<Record<string, unknown>>)
        : [];
      for (const photo of photos) {
        const trig =
          typeof photo.triggerSource === 'string' && photo.triggerSource
            ? photo.triggerSource
            : 'UNKNOWN';
        bucket.trigger.set(trig, (bucket.trigger.get(trig) ?? 0) + 1);
        const mode =
          typeof photo.captureMode === 'string' && photo.captureMode
            ? photo.captureMode
            : 'UNKNOWN';
        bucket.mode.set(mode, (bucket.mode.get(mode) ?? 0) + 1);
      }
    }

    let rowsWritten = 0;
    for (const [key, bucket] of buckets) {
      const [campaignId, deviceId, operatorUserId] = key.split('|');
      const sortedDurations = [...bucket.durations].sort((a, b) => a - b);
      const p50 = percentile(sortedDurations, 0.5);
      const p95 = percentile(sortedDurations, 0.95);
      const byTrigger = Object.fromEntries(bucket.trigger);
      const byCaptureMode = Object.fromEntries(bucket.mode);

      // No `RETURNING`/return-value inspection here on purpose: an
      // `INSERT ... ON CONFLICT ... DO UPDATE` statement's actual Postgres
      // command tag is "INSERT" when the insert path fires and "UPDATE"
      // when the conflict path fires — data-dependent, not fixed by the
      // query text — and `manager.query()` wraps a RETURNING result
      // differently for each (`[rows]` vs `[rows, affectedCount]`; see
      // `SessionService.completeSession`'s own comment on this exact
      // gotcha for a plain UPDATE). Destructuring either way is unsafe
      // for THIS query specifically, since which shape comes back varies
      // per row at runtime — confirmed live: an early version of this
      // method destructured assuming one fixed shape and silently summed
      // `NaN` into `rowsWritten` (`StatsJobService.finish` then failed
      // with "invalid input syntax for type integer: \"NaN\""). Simplest
      // robust fix: don't inspect the query result at all — one row is
      // upserted per loop iteration, so `rowsWritten` counts iterations.
      await manager.query(
        `INSERT INTO stats_daily_captures (date, campaign_id, device_id, operator_user_id, timing_p50_ms, timing_p95_ms, by_trigger, by_capture_mode, computed_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, now())
         ON CONFLICT (date, campaign_id, device_id, operator_user_id)
         DO UPDATE SET
           timing_p50_ms = EXCLUDED.timing_p50_ms,
           timing_p95_ms = EXCLUDED.timing_p95_ms,
           by_trigger = EXCLUDED.by_trigger,
           by_capture_mode = EXCLUDED.by_capture_mode,
           computed_at = now()`,
        [
          date,
          campaignId,
          deviceId,
          operatorUserId,
          p50,
          p95,
          JSON.stringify(byTrigger),
          JSON.stringify(byCaptureMode),
        ],
      );
      rowsWritten += 1;
    }
    return rowsWritten;
  }
}
