import type { BrowserWindow } from 'electron';
import fs from 'node:fs';
import { parseCccdScanFile, type ParsedCccdScan } from './cccdScanFile.js';

/**
 * Watches the external CCCD-scanner's output file and pushes each new,
 * successfully-parsed scan to the main kiosk window over IPC (`cccd:scan`)
 * — 2026-09-09 "quét CCCD thay cho nhập mã SV" feature. See
 * `FaceCaptureApp.tsx`'s `handleCccdScan` for what happens on the renderer
 * side once a scan arrives (a roster lookup, then the same FOUND/NOT_FOUND
 * branching the old manual "nhập mã sinh viên" flow already had).
 *
 * Polling, not `fs.watch`: `fs.watch` is known-flaky on Windows (missed or
 * duplicate events, especially with software that writes via a temp-file-
 * then-rename, or over a network share) — this kiosk is a Windows desktop
 * app, so a short poll comparing file mtime+size is the defensible, boring
 * choice here, per the task brief's own suggestion.
 *
 * `LOOKA_CCCD_SCAN_PATH` overrides the watched path — same override
 * convention `secrets.ts`'s `LOOKA_ACTIVATION_PATH` already uses, for
 * development/testing where there is no real
 * `D:\Work\camera_server\response.json` to read from. Defaults to the exact
 * path the product brief specifies.
 */

const DEFAULT_SCAN_PATH = 'D:\\Work\\camera_server\\response.json';
const POLL_INTERVAL_MS = 1500;

function scanFilePath(): string {
  return process.env.LOOKA_CCCD_SCAN_PATH?.trim() || DEFAULT_SCAN_PATH;
}

let pollTimer: ReturnType<typeof setInterval> | null = null;
let lastSignature: string | null = null;

function fileSignature(stat: fs.Stats): string {
  return `${stat.mtimeMs}:${stat.size}`;
}

/**
 * One poll tick: reads the file's stat, skips entirely if unchanged since
 * the last tick (the common case — no new scan), and otherwise re-reads and
 * re-parses it. `lastSignature` is updated BEFORE parsing, not after — a
 * malformed read (scanner mid-write) must not be retried every single tick
 * until it happens to succeed; it will naturally be retried on the NEXT
 * genuine file change instead, same as a `null` parse result already is.
 */
function pollOnce(onScan: (scan: ParsedCccdScan) => void): void {
  const filePath = scanFilePath();
  let stat: fs.Stats;
  try {
    stat = fs.statSync(filePath);
  } catch {
    // Missing file — not an error, just "no scan yet" (the external scanner
    // may not have run yet, or the path is misconfigured on this box).
    return;
  }

  const signature = fileSignature(stat);
  if (signature === lastSignature) return; // unchanged since the last successful read
  lastSignature = signature;

  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    console.error('[cccd-watcher] failed to read scan file:', (err as Error).message);
    return;
  }

  const parsed = parseCccdScanFile(raw);
  if (!parsed) {
    // Malformed/partial/empty JSON — e.g. the scanner is still mid-write.
    // Treated as "no scan yet", never surfaced as a failed roster match —
    // see parseCccdScanFile's own doc comment.
    return;
  }

  onScan(parsed);
}

/**
 * Starts the poll loop. `mainWindow` is a getter (not the window itself) so
 * this can be wired up once from `index.ts` at startup, before the kiosk
 * window necessarily exists yet, and keep working correctly across a window
 * recreate (`app.on('activate', ...)`) without re-registering anything.
 *
 * Seeds `lastSignature` from whatever the file already contains at start-up
 * WITHOUT emitting a scan for it (see the `seedOnly` param) — otherwise a
 * kiosk restart would replay whoever was scanned last into a freshly
 * "waiting for scan" screen, which is not what starting the kiosk back up
 * should do.
 */
export function startCccdWatcher(mainWindow: () => BrowserWindow | null): void {
  if (pollTimer) return; // already running

  pollOnce(() => {
    /* seed-only: discard the very first tick's result, keep the signature */
  });

  pollTimer = setInterval(() => {
    pollOnce((scan) => {
      const win = mainWindow();
      win?.webContents.send('cccd:scan', scan);
    });
  }, POLL_INTERVAL_MS);
}

export function stopCccdWatcher(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  lastSignature = null;
}
