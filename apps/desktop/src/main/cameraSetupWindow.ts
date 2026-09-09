import { BrowserWindow } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

/**
 * The camera role-assignment screen for CB Help — see
 * docs/plans/multi-camera-device-management-discussion.md §2.1. A separate
 * window rather than a panel bolted onto the main kiosk screen: this doc
 * section explicitly calls for a screen "riêng cho CB Help (không phải SV)",
 * and where exactly a CB-Help-only surface belongs in the main kiosk window
 * is still an open question (§4 #16) this pass does not resolve. A
 * dedicated window sidesteps that question entirely rather than guessing at
 * it, and is opened on demand — see `openCameraSetupWindow` — not
 * automatically like the CB Help display in cbHelpWindow.ts.
 */

let cameraSetupWindow: BrowserWindow | null = null;

function rendererEntryDir(): string {
  // Mirrors createWindow's own rendererEntry() in index.ts — duplicated
  // rather than imported to avoid a circular import between this module and
  // index.ts (which imports from here to open this window).
  const candidates = [path.join(__dirname, '../index.html'), path.join(__dirname, '../renderer/index.html')];
  return candidates.find((p) => fs.existsSync(p)) ?? candidates[0];
}

/** Opens the camera setup screen, or focuses it if already open. */
export function openCameraSetupWindow(): void {
  if (cameraSetupWindow) {
    cameraSetupWindow.focus();
    return;
  }

  cameraSetupWindow = new BrowserWindow({
    width: 1000,
    height: 720,
    title: 'Looka — Gán vai trò camera',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Same "this window's own console errors are otherwise invisible" fix
  // cbHelpWindow.ts already has (2026-09-09 diagnostic gap found while
  // investigating a live "blank white screen" field report on this exact
  // window) — forwarded to main.log the same way `attachRendererDiagnostics`
  // does for the main window.
  cameraSetupWindow.webContents.on('console-message', (details) => {
    const level = details.level;
    if (level === 'warning' || level === 'error') {
      console.error(`[camera-setup renderer] ${details.message} (${details.sourceId}:${details.lineNumber})`);
    }
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    cameraSetupWindow.loadURL(`${process.env.VITE_DEV_SERVER_URL}#camera-setup`);
  } else {
    cameraSetupWindow.loadFile(rendererEntryDir(), { hash: 'camera-setup' });
  }

  cameraSetupWindow.on('closed', () => {
    cameraSetupWindow = null;
  });
}
