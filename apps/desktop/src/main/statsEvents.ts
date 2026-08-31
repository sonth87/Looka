import { StatsEventRepository, type StatsEventType } from '@face/database';
import { getDatabase } from './db.js';
import { DeviceApiClient } from './deviceApi.js';

/**
 * Local queue + background push for admin-side stats events — see
 * docs/plans/multi-camera-device-management-discussion.md §3.4. Mirrors
 * `uploads.ts`'s `startUploads`/`stopUploads` shape (a module-level
 * singleton + a timer), deliberately simpler internally: see
 * `StatsEventRepository`'s own doc comment for why there is no retry-backoff
 * schedule here — a fixed tick interval, try what's pending, leave it
 * `PENDING` on any failure, is enough for a number nobody is blocked on.
 */

let repo: StatsEventRepository | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

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

async function tick(client: DeviceApiClient): Promise<void> {
  const pending = getRepo().claimPending();
  if (pending.length === 0) return;

  const ok = await client.pushEvents(
    pending.map((e) => ({
      type: e.type,
      occurredAt: new Date(e.occurredAt).toISOString(),
      metadata: e.metadata ?? undefined,
    }))
  );
  // On failure, rows stay PENDING untouched — picked up again next tick.
  // No backoff counter to update, no partial-batch bookkeeping: the whole
  // batch either lands or is retried whole next time.
  if (ok) getRepo().markSent(pending.map((e) => e.id));
}

/** Starts the periodic push. A no-op to call more than once — `stopStatsEventPush` must be called before restarting. */
export function startStatsEventPush(client: DeviceApiClient = new DeviceApiClient(), tickMs = 60_000): void {
  if (timer) return;
  timer = setInterval(() => void tick(client), tickMs);
}

export function stopStatsEventPush(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
