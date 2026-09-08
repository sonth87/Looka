import { StatsEventRepository, type StatsEventType } from '@face/database';
import { getDatabase } from './db.js';
import { DeviceApiClient } from './deviceApi.js';

/**
 * Local queue + background push for admin-side stats events — see
 * docs/plans/multi-camera-device-management-discussion.md §3.4. Mirrors
 * `uploads.ts`'s `startUploads`/`stopUploads` shape (a module-level
 * singleton + a timer), deliberately simpler internally: see
 * `StatsEventRepository`'s own doc comment for why there is no per-batch
 * retry-backoff schedule — a fixed tick interval, try what's pending, leave
 * it `PENDING` on any failure, is enough for a number nobody is blocked on.
 * The one exception, added 2026-09-08, is a confirmed 401 (`authRejectedUntil`
 * below): that one failure mode is worth pausing on, because it means this
 * device's credentials were rejected and every 15s retry until a fresh
 * activation package is loaded is guaranteed to fail the same way.
 */

let repo: StatsEventRepository | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

/**
 * Set on a confirmed 401 from `pushEvents`, cleared on the next success —
 * the 2026-09-08 fix for the "kiosk 3" incident, where a rotated device
 * secret made this worker retry a doomed push every 15s forever with no
 * signal to anyone. `0` means "not backed off." Rows still stay `PENDING`
 * either way (see `tick`'s own comment) — this only pauses the network call,
 * it never drops queued events.
 */
let authRejectedUntil = 0;
/** So the warning below logs once per rejection window, not every skipped tick. */
let authRejectedWarned = false;

function getRepo(): StatsEventRepository {
  if (!repo) repo = new StatsEventRepository(getDatabase());
  return repo;
}

/** Queues one event for the next push tick. Never throws — a failed enqueue must not interrupt the capture flow that reported it. */
export function recordStatsEvent(type: StatsEventType, metadata?: Record<string, unknown>): void {
  try {
    getRepo().enqueue({
      id: crypto.randomUUID(),
      type,
      occurredAt: Date.now(),
      metadata,
    });
  } catch (err) {
    console.error('[statsEvents] enqueue failed:', (err as Error).message);
  }
}

/**
 * How long a confirmed 401 pauses pushing — the 2026-09-08 fix. Ten minutes
 * mirrors nothing in particular except "long enough to stop hammering a
 * device the admin portal has already told us is rejected, short enough
 * that a rejection caused by server-side state — e.g. the campaign
 * `expiresAt` that `DeviceService.verifyCredentials` checks — clears itself
 * once an admin extends or clears it, with no restart needed here." A
 * rotated or revoked secret instead needs a freshly-loaded activation
 * package and a restart, which resets this module's state anyway. Rows
 * stay `PENDING` for the whole window; they are not lost, only not retried
 * until it elapses.
 */
const AUTH_REJECTED_BACKOFF_MS = 10 * 60_000;

async function tick(client: DeviceApiClient): Promise<void> {
  if (Date.now() < authRejectedUntil) return;

  // Capped at 50: a batch this size keeps one push request small and fast
  // even after a long offline stretch fills the local queue, while still
  // draining it within a handful of ticks once connectivity returns — see
  // startStatsEventPush's own doc comment for the tick cadence this pairs
  // with.
  const pending = getRepo().claimPending(50);
  if (pending.length === 0) return;

  const result = await client.pushEvents(
    pending.map((e) => ({
      type: e.type,
      occurredAt: new Date(e.occurredAt).toISOString(),
      metadata: e.metadata ?? undefined,
    }))
  );
  if (result === 'ok') {
    // Rows stay PENDING until markSent; a rejection window from an earlier,
    // now-fixed activation package is over the moment a push actually lands.
    authRejectedUntil = 0;
    authRejectedWarned = false;
    getRepo().markSent(pending.map((e) => e.id));
    return;
  }
  if (result === 'unauthorized') {
    authRejectedUntil = Date.now() + AUTH_REJECTED_BACKOFF_MS;
    if (!authRejectedWarned) {
      console.warn(
        '[statsEvents] device rejected (401) — pausing stats push for ' +
          `${AUTH_REJECTED_BACKOFF_MS / 60_000} minutes; load a fresh activation package to clear this.`
      );
      authRejectedWarned = true;
    }
    // Falls through with rows left PENDING, same as every other failure —
    // no partial-batch bookkeeping: the whole batch either lands or is
    // retried whole next time the backoff window has elapsed.
  }
  // 'failed' (network error, no device identity, other non-2xx): rows stay
  // PENDING untouched — picked up again next tick, no backoff counter.
}

/** Starts the periodic push. A no-op to call more than once — `stopStatsEventPush` must be called before restarting. */
/** Starts the periodic push. A no-op to call more than once — `stopStatsEventPush` must be called before restarting. */
export function startStatsEventPush(client: DeviceApiClient = new DeviceApiClient(), tickMs = 15_000): void {
  if (timer) return;
  timer = setInterval(() => void tick(client), tickMs);
}

export function stopStatsEventPush(): void {
  if (timer) clearInterval(timer);
  timer = null;
  authRejectedUntil = 0;
  authRejectedWarned = false;
}
