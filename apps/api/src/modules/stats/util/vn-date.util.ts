/**
 * `Asia/Ho_Chi_Minh` has no DST, so a fixed +7h offset then reading the UTC
 * date parts reproduces the local calendar date without a timezone library —
 * same technique `device-management/services/device-event.service.ts`'s
 * `campaignsTimeseries`/`campaignDayStats` already use for `byDay`. Kept as
 * its own small utility here rather than imported from that file — see this
 * module's "duplicate small things rather than couple modules" convention
 * (matches `photo-review.service.ts`'s own stated reasoning for
 * `resolveSessionContext` etc.).
 */
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

/** `YYYY-MM-DD` for `at` in Asia/Ho_Chi_Minh — the `date` column every `stats_*` table buckets by. */
export function vnDateString(at: Date): string {
  return new Date(at.getTime() + VN_OFFSET_MS).toISOString().slice(0, 10);
}

/** `date` N days before `vnDateString(now)` — used by the daily-recompute cron for "D-1"/"D-2". */
export function vnDateDaysAgo(daysAgo: number, now: Date = new Date()): string {
  const nowVn = new Date(now.getTime() + VN_OFFSET_MS);
  nowVn.setUTCDate(nowVn.getUTCDate() - daysAgo);
  return nowVn.toISOString().slice(0, 10);
}

/** `{from, to}` defaulting to the last `days` days (inclusive of today) when either query param is omitted — every `stats` list/query endpoint's "mặc định N ngày gần nhất" rule. */
export function defaultDateRange(
  from: string | undefined,
  to: string | undefined,
  days: number,
): { from: string; to: string } {
  return {
    from: from ?? vnDateDaysAgo(days - 1),
    to: to ?? vnDateString(new Date()),
  };
}
