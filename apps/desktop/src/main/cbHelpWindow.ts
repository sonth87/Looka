import { BrowserWindow, screen } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

/**
 * The on-demand "extended display" window for CB Help — see
 * docs/plans/multi-camera-device-management-discussion.md §3.5 and its
 * 2026-09-05 notes there, plus docs/ROADMAP.md §2's updated §3.5 row.
 *
 * Product decision (2026-09-05, product owner, first pass): no longer a
 * read-only progress monitor that opens automatically at startup — opened
 * only on demand via `Ctrl/Cmd+Shift+H` or the kiosk's own "Màn hình mở
 * rộng" button, and closed the same way.
 *
 * Product decision (2026-09-05, product owner, second pass — supersedes an
 * even briefer middle version of this file that made the window an exact
 * live mirror of the whole main window via `getDisplayMedia()`): the window
 * shows only the capture frames themselves — every frame live at once in
 * simultaneous-capture mode, one live/completed/pending tile per step in
 * sequential mode — not a mirror of this app's UI. This module owns the
 * window's lifecycle/placement *and* the frames snapshot every CB Help
 * window reads: `FaceCaptureApp.tsx` calls `publishCbHelpState` (via the
 * `cbhelp:publish` IPC the main process registers in index.ts) whenever
 * that snapshot changes; this module caches the latest one and broadcasts
 * it to the CB Help window via `cbhelp:update`, and answers `cbhelp:getState`
 * for a window that opens (or reloads) mid-session. The renderer itself —
 * `apps/desktop/src/renderer/CbHelpFrames.tsx` — owns turning a frame's
 * `deviceId` into its own live `getUserMedia()` stream; nothing here touches
 * a camera.
 */

let cbHelpWindow: BrowserWindow | null = null;

export type CbHelpFrameStatus = 'PENDING' | 'CURRENT' | 'COMPLETED' | 'FAILED';

export interface CbHelpFrame {
  stepId: string;
  stepType: string;
  role: string;
  label: string;
  deviceId: string | null;
  status: CbHelpFrameStatus;
  capturedDataUrl?: string;
  attempt: number;
}

/**
 * The window's own presentation mode (§3.5, 2026-09-05 second product
 * decision — captured photos stay visible on this window after the shot,
 * instead of the whole window dropping to idle the moment the session's
 * `completed` event fires). See `packages/ui`'s own copy of this type for
 * the full reasoning per value; this module only ever passes the field
 * through unchanged (`sanitizeCbHelpState` below), it never branches on it.
 */
export type CbHelpPhase = 'idle' | 'live' | 'review' | 'done';

/**
 * Pre-session student greeting (2026-09-07) — set only for the brief window
 * between a `lookupStudent()` FOUND result and the capture session actually
 * starting (see `FaceCaptureApp.tsx`'s `handleStudentSubmit`). `null`/absent
 * the rest of the time; the renderer treats its presence as "show the
 * full-screen greeting," not `phase`, since `phase` continues to mean what
 * it already means for the frame grid.
 */
export interface CbHelpGreeting {
  code: string;
  name: string;
  className: string;
  major: string;
  academicYear: string;
}

export interface CbHelpPublishState {
  running: boolean;
  phase: CbHelpPhase;
  simultaneous: boolean;
  currentStepId: string | null;
  frames: CbHelpFrame[];
  greeting: CbHelpGreeting | null;
}

const EMPTY_CBHELP_STATE: CbHelpPublishState = {
  running: false,
  phase: 'idle',
  simultaneous: false,
  currentStepId: null,
  frames: [],
  greeting: null,
};

let cbHelpState: CbHelpPublishState = EMPTY_CBHELP_STATE;

/**
 * Best-effort validation of the renderer-supplied snapshot — the renderer is
 * untrusted input, same reasoning as `safeFileToken` in index.ts, though
 * what lands here only ever gets echoed back to another renderer window (no
 * file path, no shell/SQL use), so this only guards against a malformed
 * shape wedging the CB Help window, not against a hostile payload.
 */
export function sanitizeCbHelpState(raw: unknown): CbHelpPublishState {
  const payload = raw as Partial<CbHelpPublishState> | null | undefined;
  const frames = Array.isArray(payload?.frames) ? payload!.frames : [];
  const validStatuses: CbHelpFrameStatus[] = ['PENDING', 'CURRENT', 'COMPLETED', 'FAILED'];
  const validPhases: CbHelpPhase[] = ['idle', 'live', 'review', 'done'];

  return {
    running: Boolean(payload?.running),
    // Falls back to 'idle' (not 'live') for a payload with no phase at all —
    // the safer default when a malformed/older-shaped snapshot lands here.
    phase: validPhases.includes(payload?.phase as CbHelpPhase) ? (payload!.phase as CbHelpPhase) : 'idle',
    simultaneous: Boolean(payload?.simultaneous),
    currentStepId: typeof payload?.currentStepId === 'string' ? payload.currentStepId : null,
    frames: frames
      .filter((f): f is CbHelpFrame => !!f && typeof f === 'object' && typeof (f as any).stepId === 'string')
      .map((f) => ({
        stepId: String(f.stepId),
        stepType: String((f as any).stepType ?? ''),
        role: String((f as any).role ?? ''),
        label: String((f as any).label ?? ''),
        deviceId: typeof f.deviceId === 'string' ? f.deviceId : null,
        status: validStatuses.includes(f.status as CbHelpFrameStatus) ? (f.status as CbHelpFrameStatus) : 'PENDING',
        capturedDataUrl: typeof f.capturedDataUrl === 'string' ? f.capturedDataUrl : undefined,
        attempt: Number.isFinite(f.attempt) ? Number(f.attempt) : 0,
      })),
    greeting: sanitizeGreeting(payload?.greeting),
  };
}

/** Every field is a plain string coming straight from `lookupStudent()`'s test data — reject the whole object if any is missing rather than showing a half-blank greeting. */
function sanitizeGreeting(raw: unknown): CbHelpGreeting | null {
  const g = raw as Partial<CbHelpGreeting> | null | undefined;
  if (
    g &&
    typeof g === 'object' &&
    typeof g.code === 'string' &&
    typeof g.name === 'string' &&
    typeof g.className === 'string' &&
    typeof g.major === 'string' &&
    typeof g.academicYear === 'string'
  ) {
    return { code: g.code, name: g.name, className: g.className, major: g.major, academicYear: g.academicYear };
  }
  return null;
}

/** The kiosk publishing a fresh snapshot — cached here and broadcast to the CB Help window if one is open. */
export function publishCbHelpState(next: CbHelpPublishState): void {
  cbHelpState = next;
  cbHelpWindow?.webContents.send('cbhelp:update', cbHelpState);
}

/** Hydration for a CB Help window that opens (or reloads) mid-session. */
export function getCbHelpState(): CbHelpPublishState {
  return cbHelpState;
}

/** A single-display fallback window's size when there is no second monitor to place it on. */
const SINGLE_DISPLAY_WIDTH = 1024;
const SINGLE_DISPLAY_HEIGHT = 640;

function rendererEntryDir(): string {
  // Mirrors createWindow's own rendererEntry() in index.ts — same two
  // possible layouts (packaged vs. this dist/main-relative one), duplicated
  // rather than imported to avoid a circular import between this module and
  // index.ts (which imports from here to open this window).
  const candidates = [path.join(__dirname, '../index.html'), path.join(__dirname, '../renderer/index.html')];
  return candidates.find((p) => fs.existsSync(p)) ?? candidates[0];
}

/**
 * Opens the CB Help extended-display window, or focuses it if already open.
 *
 * Placed on whichever display is not `excludeDisplayId` (the kiosk's own
 * main window) when a second display is connected, sized to that display's
 * full bounds — same placement as before this window became on-demand. A
 * single-display machine gets a normal, movable, non-fullscreen window
 * instead of silently doing nothing, since there is no longer an automatic
 * open to fall back on.
 */
export function openCbHelpWindow(excludeDisplayId?: number): void {
  if (cbHelpWindow) {
    cbHelpWindow.focus();
    return;
  }

  const displays = screen.getAllDisplays();
  const secondary = displays.find((d) => d.id !== excludeDisplayId);

  const bounds = secondary
    ? {
        x: secondary.bounds.x,
        y: secondary.bounds.y,
        width: secondary.bounds.width,
        height: secondary.bounds.height,
      }
    : { width: SINGLE_DISPLAY_WIDTH, height: SINGLE_DISPLAY_HEIGHT };

  cbHelpWindow = new BrowserWindow({
    ...bounds,
    title: 'Looka — Màn hình mở rộng',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  cbHelpWindow.setMenuBarVisibility(false);

  // This window's own renderer (CbHelpFrames.tsx) opens its own independent
  // getUserMedia streams — including one for CENTER, alongside the main
  // kiosk window's already-open CENTER stream — and only ever logs a
  // failure to open one (`[cb-help] failed to open camera ...`) to this
  // window's own DevTools console, which nobody has open on a kiosk.
  // Forwarded to main.log the same way `attachRendererDiagnostics` already
  // does for the main window, so a blank tile here (2026-09-08 field
  // report — every tile showing black, including the currently-capturing
  // one) is diagnosable from the log instead of invisible.
  cbHelpWindow.webContents.on('console-message', (details) => {
    const level = details.level;
    if (level === 'warning' || level === 'error') {
      console.error(`[cb-help renderer] ${details.message} (${details.sourceId}:${details.lineNumber})`);
    }
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    cbHelpWindow.loadURL(`${process.env.VITE_DEV_SERVER_URL}#cb-help`);
  } else {
    cbHelpWindow.loadFile(rendererEntryDir(), { hash: 'cb-help' });
  }

  cbHelpWindow.on('closed', () => {
    cbHelpWindow = null;
  });
}

export function closeCbHelpWindow(): void {
  cbHelpWindow?.close();
}

/** Opens the window if closed, closes it if open — what both the shortcut and the kiosk UI button do. */
export function toggleCbHelpWindow(excludeDisplayId?: number): { open: boolean } {
  if (cbHelpWindow) {
    closeCbHelpWindow();
    return { open: false };
  }
  openCbHelpWindow(excludeDisplayId);
  return { open: true };
}

export function isCbHelpWindowOpen(): boolean {
  return cbHelpWindow !== null;
}
