import type { JobsOptions } from 'bullmq';
import {
  AiEditJobKind,
  AiEditJobOrigin,
  PhotoVariantKind,
} from '../photo-review.constants';

/**
 * BullMQ job payload for both the `ai-edit` (user lane) and
 * `ai-edit-background` (kiosk-auto/recovery lane) queues — 2026-09-29,
 * AI-edit queue lifecycle + priority rework. `payload` is kept ONLY for a
 * legacy in-flight job enqueued before this rework (no `attempt`/durable
 * `ai_request_params` yet) — every job `enqueueAiEditJob` creates from now
 * on reads `cfg`/`steps`/`seed` back off the variant row's own
 * `aiRequestParams` instead (see that column's own doc comment on
 * `PhotoVariant`), so a lost/replayed Redis job can always be reconstructed
 * from Postgres alone.
 */
export interface AiEditJobData {
  setId: string;
  variantId: string;
  /** Legacy-only — see this interface's own doc comment. */
  payload?: { cfg?: number; steps?: number; seed?: number };
  /** Who/what caused this job to be enqueued — logging/observability only, see `AiEditJobOrigin`'s own doc comment. */
  origin?: AiEditJobOrigin;
  /**
   * Which `ai_attempts` value this job was claimed at
   * (`enqueueAiEditJob`'s guarded UPDATE `RETURNING ai_attempts`) —
   * `runQueuedAiEditJob` uses this to detect a stale/superseded job
   * (`ai_attempts` on the row has since moved on) and skip it rather than
   * reprocessing or clobbering a newer attempt's result. `undefined` only
   * for a legacy job predating this field, treated as attempt `0`.
   */
  attempt?: number;
}

/** Deterministic BullMQ job id for one claim of one variant — `pv-<variantId>-<attempt>` (bullmq forbids `:` and a pure-integer id, both satisfied here). Adding a job with an id that already exists is a silent no-op (bullmq's own behavior), which is exactly the de-dup this rework wants: two racing claims of the SAME attempt can never enqueue two jobs. */
export function aiEditJobId(variantId: string, attempt: number): string {
  return `pv-${variantId}-${attempt}`;
}

/**
 * Which `AiEditSlotGate` lane / BullMQ queue an `AiEditJobOrigin` maps to —
 * `USER` is always the user lane, `AUTO`/`RECOVERY` are always the
 * background lane (see `AiEditJobOrigin`'s own doc comment). Centralised
 * here (2026-09-29 simplification fix) so a caller of `enqueueAiEditJob`
 * cannot pass a `lane` that disagrees with its own `origin` — the two used
 * to be two separate fields that every call site had to keep in sync by
 * hand.
 */
export type AiEditLane = 'user' | 'background';
export function laneForOrigin(origin: AiEditJobOrigin): AiEditLane {
  return origin === AiEditJobOrigin.USER ? 'user' : 'background';
}

/** `PhotoVariantKind` → which `AiEditJobKind` (BullMQ job name) enqueues/processes it — the same `CARD_AI` ⇒ `AI_EDIT` / else ⇒ `REPROCESS` mapping every AI-edit queue call site needs. Centralised here (2026-09-29 dedup fix — this used to be written out inline at 3 separate call sites in `PhotoReviewService`, all copies of each other). */
export function aiEditJobKindFor(kind: PhotoVariantKind): AiEditJobKind {
  return kind === PhotoVariantKind.CARD_AI
    ? AiEditJobKind.AI_EDIT
    : AiEditJobKind.REPROCESS;
}

/**
 * BullMQ job states that count as "still live" (queued or already running)
 * in either AI-edit queue — shared (2026-09-29 dedup fix) by
 * `PhotoReviewService.promoteToUserLane`'s own "is there already a job for
 * this variant in the user queue" check and
 * `requeueStuckAiEditVariants`'s recovery-sweep liveness check, which must
 * agree on this or a job can look "live" to one and "not live" to the
 * other. Deliberately NOT used for `promoteToUserLane`'s OWN background-queue
 * removability check just above that — `Queue.remove()` can only act on
 * `waiting`/`prioritized`/`delayed` (never `active`/`waiting-children`), a
 * narrower, intentionally different list.
 */
export const AI_EDIT_LIVE_JOB_STATES = [
  'active',
  'waiting',
  'prioritized',
  'delayed',
  'waiting-children',
] as const;

/** Shared BullMQ job options for both lanes — bounded retention so a busy queue does not grow Redis memory unboundedly; BullMQ's own Redis-backed lock is what already gives "exactly one worker runs this job", so no `attempts`/backoff option is set here (a failed job's retry path is this module's own DB-status-driven recovery sweep, not BullMQ's). */
export const AI_EDIT_JOB_OPTS: JobsOptions = {
  removeOnComplete: { age: 86_400, count: 1_000 },
  removeOnFail: { age: 7 * 86_400 },
};
