import { PhotoAiError } from '../application/ports/photo-ai.port';
import { AI_EDIT_MAX_ATTEMPTS } from '../photo-review.constants';

/**
 * Pure decision function (2026-09-29, AI-edit queue lifecycle rework;
 * simplified same-day per user request "bỏ PENDING đi") — whether a job-path
 * failure is worth retrying automatically, or should resolve straight to
 * `FAILED`. Extracted out of `processReprocessJob`/`processAiEditJob`'s own
 * `catch` blocks so the retryable-vs-permanent rule has exactly one place to
 * read/test, rather than being duplicated (and potentially drifting) across
 * both.
 *
 * - `'retry'`: the failure is one `AiEditRecoveryService`'s periodic sweep
 *   can plausibly fix by itself (a `Timeout` — this app's own call, or
 *   undici's own lower ceiling underneath it, took too long; or a
 *   `Retryable` — the AI service's own transient 503/504) AND this variant
 *   has not yet exhausted `AI_EDIT_MAX_ATTEMPTS`. The caller does NOT
 *   transition `photo_variants.status` for this outcome — it stays
 *   `PROCESSING` (only `note`/`updated_at` change), and the sweep's own
 *   stale-`PROCESSING`-with-no-live-job check is what eventually re-claims
 *   it. There is deliberately no separate "waiting to retry" status.
 * - `PhotoVariantStatus.FAILED`: everything else — `Terminal` (forbidden
 *   prompt, identity mismatch, a missing source — see
 *   `processReprocessJob`'s own "no original photo" throw), `Unavailable`
 *   (the AI service's base URL itself is unreachable — not something a
 *   retry fixes on its own), a plain (non-`PhotoAiError`) exception (e.g. a
 *   DB/file-storage failure), OR a Timeout/Retryable that has already used
 *   up every attempt.
 */
export function resolveAiJobFailureStatus(
  error: unknown,
  aiAttempts: number,
): 'retry' | 'FAILED' {
  if (!(error instanceof PhotoAiError)) return 'FAILED';
  const isRetryableKind =
    error.kind === 'Timeout' || error.kind === 'Retryable';
  if (!isRetryableKind) return 'FAILED';
  if (aiAttempts >= AI_EDIT_MAX_ATTEMPTS) return 'FAILED';
  return 'retry';
}
