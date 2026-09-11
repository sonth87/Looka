/**
 * Exponential backoff, capped — the same shape as
 * `modules/capture/services/upload-worker.service.ts`'s own
 * `computeNextRetryAt` (kept there too; not re-pointed at this copy in
 * Phase 0 to avoid touching working outbox code — see plan §6 Phase 2).
 * New outbox/job drainers should use this one instead of writing a fourth
 * copy.
 */
export function computeNextRetryAt(
  attempts: number,
  maxDelaySeconds: number,
  now: number = Date.now(),
): Date {
  const safeAttempts = Number.isFinite(attempts) ? attempts : 0;
  const exponent = Math.min(Math.max(safeAttempts, 0), 8);
  const delaySeconds = Math.min(maxDelaySeconds, 2 ** exponent);
  return new Date(now + delaySeconds * 1000);
}
