import fs from 'node:fs';
import { findByIdentityNumber, parseRosterFile, rosterFilePath, type RosterRecord } from './cccdRoster.js';

/**
 * In-memory cache of the external student roster file
 * (`D:\Work\camera_server\response.json`, or `LOOKA_CCCD_SCAN_PATH` in
 * dev/test), kept fresh by polling — 2026-09-09 architecture correction,
 * replacing the earlier same-day `cccdWatcher.ts` (which polled the same
 * file but for a wrong reason: it treated it as a per-scan write target and
 * pushed each "new scan" over IPC as `cccd:scan`). This file only ever
 * READS — nothing here, or anywhere else in this app after this correction,
 * writes to that path.
 *
 * Polling, not `fs.watch`: `fs.watch` is known-flaky on Windows (missed or
 * duplicate events, especially with software that writes via a temp-file-
 * then-rename or wholesale-rewrite, as this external roster refresh does) —
 * this kiosk is a Windows desktop app, so a short poll comparing file
 * mtime+size is the defensible, boring choice here, same reasoning the
 * earlier `cccdWatcher.ts` already used and worth keeping.
 *
 * No IPC push of any kind lives here anymore — the roster is looked up
 * on-demand via `lookupCccdByIdentityNumber()` (wired to the
 * `cccd:lookupByIdentityNumber` IPC handler in `index.ts`), called the
 * moment the kiosk's own embedded OCR corner
 * (`packages/ui`'s `CccdScanWaitingScreen.tsx`'s `ScanMonitorCorner`) gets a
 * stable read. This module's only job is keeping `cache` reasonably fresh
 * in the background.
 */
const POLL_INTERVAL_MS = 1500;

let pollTimer: ReturnType<typeof setInterval> | null = null;
let lastSignature: string | null = null;
let cache: RosterRecord[] = [];

function fileSignature(stat: fs.Stats): string {
  return `${stat.mtimeMs}:${stat.size}`;
}

/**
 * One poll tick: reads the file's stat, skips entirely if unchanged since
 * the last tick (the common case), and otherwise re-reads/re-parses it.
 * `lastSignature` is updated BEFORE parsing (mirroring the earlier
 * `cccdWatcher.ts`'s own reasoning) so a malformed read is naturally retried
 * on the next genuine file change rather than every tick until it happens to
 * succeed.
 *
 * Missing file, unreadable file, or a parse that comes back `null`
 * (`parseRosterFile`'s own "not a usable snapshot" cases) all leave `cache`
 * exactly as it was — see that function's own doc comment for why replacing
 * a good cache with nothing just because one read raced an external
 * wholesale rewrite would be actively worse than serving slightly-stale
 * data for one more tick.
 */
function pollOnce(): void {
  const filePath = rosterFilePath();
  let stat: fs.Stats;
  try {
    stat = fs.statSync(filePath);
  } catch {
    return; // missing file — not an error, just nothing to refresh from yet
  }

  const signature = fileSignature(stat);
  if (signature === lastSignature) return;
  lastSignature = signature;

  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    console.error('[cccd-roster] failed to read roster file:', (err as Error).message);
    return;
  }

  const parsed = parseRosterFile(raw);
  if (parsed === null) {
    // Malformed/partial/empty JSON, or not an array — e.g. the external
    // writer is mid-rewrite. Keep serving the previous cache.
    return;
  }
  cache = parsed;
}

/**
 * Starts the poll loop. Unlike the earlier `cccdWatcher.ts` (which seeded
 * its "last known state" silently on the first tick to avoid replaying a
 * stale scan into a fresh "waiting" screen), this polls and caches
 * immediately on the very first tick — there is no "replay" concern for a
 * pull-based lookup; the cache should simply be as fresh as possible as
 * early as possible.
 */
export function startCccdRosterWatcher(): void {
  if (pollTimer) return; // already running
  pollOnce();
  pollTimer = setInterval(pollOnce, POLL_INTERVAL_MS);
}

export function stopCccdRosterWatcher(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  lastSignature = null;
  cache = [];
}

/**
 * The kiosk's own call, made the moment `ScanMonitorCorner` gets a stable
 * OCR read — exact string match against `identity_number`, over the WHOLE
 * cached roster, no campaign-scoping (confirmed product decision,
 * 2026-09-09). `null` for a blank input or no match; a no-match is a normal,
 * expected outcome, not an error — see `cccd:lookupByIdentityNumber`'s own
 * doc comment in `index.ts`.
 */
export function lookupCccdByIdentityNumber(identityNumber: string): RosterRecord | null {
  return findByIdentityNumber(cache, identityNumber);
}
