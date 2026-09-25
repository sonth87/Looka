/**
 * Automatic Canon connection watcher —
 * docs/plans/canon-auto-detect-polling-plan-2026-09-24.md. Polls
 * `detectTetheredCamera()` on a schedule instead of only on the Camera
 * Setup screen's manual "Kiểm tra kết nối" button, so the operator learns
 * about a connect/disconnect without opening that screen first.
 *
 * Deliberately polling, not a real USB hotplug notification — see the
 * plan's "Vì sao chọn polling" section for why: this app ships to kiosk
 * machines whose IT policy is unknown ("sẽ gửi bản release cho máy khác
 * dùng"). A PowerShell/WMI listener risks being silently blocked by
 * AppLocker/Group Policy on a locked-down machine with no way to detect
 * that it's blocked; a native libusb hotplug addon reintroduces the
 * Electron-ABI native-module packaging risk this codebase already steered
 * away from once (see `preload/index.ts`'s image-mirroring doc comment on
 * why not `sharp`). Polling reuses only `gphoto2.exe`, already proven to
 * package and run on other machines.
 *
 * Cadence (confirmed by the user 2026-09-24, not re-derived here):
 * disconnected — retry starting at `DISCONNECTED_BASE_MS`, doubling on
 * each consecutive failure up to `DISCONNECTED_MAX_MS`; connected — settle
 * to the much slower `CONNECTED_POLL_MS`, since the only thing left to
 * detect is a disconnect, not "is the camera ready yet".
 */
import { detectTetheredCamera, isMovieStreamHealthy, type TetheredCameraStatus } from './tetheredCamera.js';
import { createBackoff } from './backoff.js';

const DISCONNECTED_BASE_MS = 3_000;
const DISCONNECTED_MAX_MS = 30_000;
const CONNECTED_POLL_MS = 15_000;

const backoff = createBackoff(DISCONNECTED_BASE_MS, DISCONNECTED_MAX_MS);

let timer: ReturnType<typeof setTimeout> | null = null;
/** "Should poll at all" — true only while some role is mapped to the Canon. Set by `setTetheredCameraWanted`. */
let wanted = false;
/** "Should not poll right now" — true while a real capture session is active, to avoid competing with `withCameraLock` for the shared gphoto2 session. Set by `setTetheredCameraWatcherPaused`. */
let pausedForSession = false;
/**
 * 2026-09-24 fix (audit: watcher kept polling — and killing the Setup
 * screen's own live-view movie stream every `CONNECTED_POLL_MS` — while the
 * Camera Setup popup was open) — true while that popup is open. Kept as a
 * SEPARATE reason from `pausedForSession` rather than reusing the same flag:
 * the Setup popup can be opened independent of any capture session (it's
 * bound to a global shortcut), so a naive shared boolean would let closing
 * one accidentally un-pause the watcher while the other reason still holds
 * (e.g. Setup closes while a session is still active, or a session ends
 * while Setup happens to still be open). Set by
 * `setTetheredCameraWatcherPausedForSetup`.
 */
let pausedForSetup = false;
let running = false;
let inFlight = false;
let lastStatus: TetheredCameraStatus | null = null;

type StatusListener = (status: TetheredCameraStatus) => void;
let listener: StatusListener | null = null;

/** Registered once from `index.ts` — receives a call only when the connected/model actually changes, not on every poll tick. */
export function onTetheredCameraWatcherStatus(fn: StatusListener): void {
  listener = fn;
}

function statusChanged(prev: TetheredCameraStatus | null, next: TetheredCameraStatus): boolean {
  return !prev || prev.connected !== next.connected || prev.model !== next.model;
}

function schedule(delayMs: number): void {
  if (!running) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void tick(), delayMs);
}

async function tick(): Promise<void> {
  if (!running || inFlight) return;
  inFlight = true;
  try {
    // 2026-09-25 fix (confirmed real-log root cause of "khung view vẫn lag"
    // + "hay lỗi"): a live-view movie stream that is currently alive and has
    // delivered a fresh frame IS the connection check — running the real
    // `--auto-detect` subprocess on top of that only ever exists to stop
    // that exact stream first (`withCameraLock`), forcing a multi-second
    // cold restart the live-view poller then has to pay for, every single
    // `CONNECTED_POLL_MS` tick. Skipping the subprocess entirely here, and
    // reporting connected from the stream's own health instead, removes
    // that self-inflicted churn without weakening real disconnect
    // detection: once the camera actually disconnects, the stream stops
    // producing fresh frames and this falls through to a real detect again.
    if (isMovieStreamHealthy()) {
      const status: TetheredCameraStatus = { connected: true, model: lastStatus?.model };
      if (statusChanged(lastStatus, status)) {
        lastStatus = status;
        listener?.(status);
      }
      backoff.reset();
      schedule(CONNECTED_POLL_MS);
      return;
    }
    const status = await detectTetheredCamera();
    if (statusChanged(lastStatus, status)) {
      lastStatus = status;
      listener?.(status);
    }
    if (status.connected) {
      backoff.reset();
      schedule(CONNECTED_POLL_MS);
    } else {
      schedule(backoff.next());
    }
  } catch {
    schedule(backoff.next());
  } finally {
    inFlight = false;
  }
}

function applyState(): void {
  const shouldRun = wanted && !pausedForSession && !pausedForSetup;
  if (shouldRun === running) return;
  running = shouldRun;
  if (running) {
    backoff.reset();
    void tick();
  } else if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}

/** Call once at startup after reading the persisted role mapping, and again every time it changes — no-op if the "should run" state doesn't actually flip. */
export function setTetheredCameraWanted(wantedNow: boolean): void {
  wanted = wantedNow;
  applyState();
}

/** Call from the `tetheredCameraWatcher:setSessionActive` IPC handler — CampaignGate reports its own `started` transitions here. */
export function setTetheredCameraWatcherPaused(pausedNow: boolean): void {
  pausedForSession = pausedNow;
  applyState();
}

/** Call from `cameraSetupWindow.ts` when the Camera Setup popup opens/closes — see `pausedForSetup`'s own doc comment for why this needs its own reason rather than reusing `setTetheredCameraWatcherPaused`. */
export function setTetheredCameraWatcherPausedForSetup(pausedNow: boolean): void {
  pausedForSetup = pausedNow;
  applyState();
}

/** App shutdown only — see `index.ts`'s quit lifecycle. */
export function stopTetheredCameraWatcher(): void {
  wanted = false;
  applyState();
}
