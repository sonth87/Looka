import { OUTBOX_MAX_RETRY_DELAY_SECONDS } from '../capture.constants';
import { computeNextRetryAt } from './upload-worker.service';

/**
 * Pins the backoff math on its own, without a database - what broke in the
 * field was Postgres's server-side type inference for a parameterized
 * `make_interval(secs => $n)` call, not this arithmetic. Moving the
 * computation into JavaScript (see the doc comment on `computeNextRetryAt`)
 * removes that failure mode entirely; these tests exist to keep the
 * arithmetic itself honest going forward.
 */
describe('computeNextRetryAt', () => {
  const NOW = Date.UTC(2026, 0, 1, 0, 0, 0);

  test('doubles the delay with each attempt', () => {
    const first = computeNextRetryAt(1, NOW).getTime() - NOW;
    const second = computeNextRetryAt(2, NOW).getTime() - NOW;
    const third = computeNextRetryAt(3, NOW).getTime() - NOW;

    expect(first).toBe(2_000);
    expect(second).toBe(4_000);
    expect(third).toBe(8_000);
  });

  test('caps the delay rather than growing without bound', () => {
    // The exponent cap (8 doublings = 256s) binds before the 300s ceiling
    // does; the ceiling is the actual promise ("never waits longer than
    // this"), not something today's formula ever reaches on its own.
    const atCap = computeNextRetryAt(20, NOW).getTime() - NOW;
    expect(atCap).toBe(256_000);
    expect(atCap).toBeLessThanOrEqual(OUTBOX_MAX_RETRY_DELAY_SECONDS * 1000);
  });

  test('never produces a delay Postgres would reject', () => {
    // The bug this regresses: a malformed input reaching the database as
    // NaN/undefined, which `make_interval` rejected as "interval out of
    // range". A `Date` cannot be NaN-valued without `getTime()` itself
    // reporting it, so this is the whole class of failure, pinned shut.
    for (const attempts of [-5, 0, 1, 3, 8, 100, Number.NaN]) {
      const result = computeNextRetryAt(attempts, NOW);
      expect(Number.isFinite(result.getTime())).toBe(true);
      expect(result.getTime()).toBeGreaterThanOrEqual(NOW);
    }
  });

  test('a negative attempt count is treated as zero, not extrapolated', () => {
    expect(computeNextRetryAt(-3, NOW).getTime()).toBe(
      computeNextRetryAt(0, NOW).getTime(),
    );
  });
});
