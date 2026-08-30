import { BrowserWindow, screen } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

/**
 * The secondary, read-only display for CB Help — see
 * docs/plans/multi-camera-device-management-discussion.md §3.5. A second
 * `BrowserWindow` placed on whichever display is not the kiosk's own,
 * showing the same run a bystander could otherwise only take on faith: which
 * step is next, what was just captured. No controls live here — see that
 * doc's own reasoning (also public/visible-to-others, not just CB Help, so
 * there is nothing to gate behind a login).
 *
 * Camera-alive/dead status (also called for in that doc section) is not
 * relayed here yet — it lives in `BrowserCameraService` inside the main
 * kiosk renderer, and wiring it out would mean touching that renderer's
 * camera/engine lifecycle code again, which this pass deliberately avoids
 * (see FaceCaptureApp.tsx's own capture-trigger comments for why that code
 * is treated carefully). Step progress and the latest capture are enough to
 * ship on their own.
 */

export interface CbHelpStep {
  id: string;
  type: string;
  instruction: string;
}

export interface CbHelpCapture {
  stepId: string;
  attempt: number;
  dataUrl: string;
  capturedAt: number;
}

interface CbHelpState {
  steps: CbHelpStep[];
  captures: Record<string, CbHelpCapture>;
}

let cbHelpWindow: BrowserWindow | null = null;
let state: CbHelpState = { steps: [], captures: {} };

function rendererEntryDir(): string {
  // Mirrors createWindow's own rendererEntry() in index.ts — same two
  // possible layouts (packaged vs. this dist/main-relative one), duplicated
  // rather than imported to avoid a circular import between this module and
  // index.ts (which imports from here to open this window).
  const candidates = [path.join(__dirname, '../index.html'), path.join(__dirname, '../renderer/index.html')];
  return candidates.find((p) => fs.existsSync(p)) ?? candidates[0];
}

/**
 * Opens the CB Help window on whichever display is not `excludeDisplayId`
 * (the kiosk's own main window), if more than one display is connected. A
 * single-display machine has nothing to open this on — silently does
 * nothing, rather than placing a second window on top of the first.
 */
export function maybeOpenCbHelpWindow(excludeDisplayId: number): void {
  if (cbHelpWindow) return;

  const displays = screen.getAllDisplays();
  const secondary = displays.find((d) => d.id !== excludeDisplayId);
  if (!secondary) return;

  cbHelpWindow = new BrowserWindow({
    x: secondary.bounds.x,
    y: secondary.bounds.y,
    width: secondary.bounds.width,
    height: secondary.bounds.height,
    title: 'Looka — Theo dõi',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  cbHelpWindow.setMenuBarVisibility(false);

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

/** A new session started: reset what the CB Help window shows for the previous run. */
export function cbHelpSessionStarted(steps: CbHelpStep[]): void {
  state = { steps, captures: {} };
  cbHelpWindow?.webContents.send('cbhelp:state', state);
}

/** One capture landed — the same event `capture:queue`'s handler reports for every step. */
export function cbHelpCaptureAdded(capture: CbHelpCapture): void {
  state = { ...state, captures: { ...state.captures, [capture.stepId]: capture } };
  cbHelpWindow?.webContents.send('cbhelp:state', state);
}

/** Hydration for a CB Help window that opens (or reloads) mid-session. */
export function getCbHelpState(): CbHelpState {
  return state;
}
