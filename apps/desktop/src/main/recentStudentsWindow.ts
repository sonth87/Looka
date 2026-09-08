import { BrowserWindow } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

/**
 * The kiosk's own "sinh viên đã chụp" screen (2026-09-08 "student gallery"
 * feature) — a separate window, same pattern as `cameraSetupWindow.ts`
 * (own doc comment explains why a dedicated window rather than a panel
 * bolted onto the main capture screen). Opened only via `Ctrl/Cmd+Shift+S`
 * — not for the student being photographed, for a teacher/operator standing
 * at the kiosk who wants to check recent captures without a second device.
 *
 * Reads local SQLite only (`CapturedStudentRepository`) — see that
 * repository's own doc comment — so this works fully offline, unlike the
 * CMS/apps/web equivalents of this feature.
 */

let recentStudentsWindow: BrowserWindow | null = null;

function rendererEntryDir(): string {
  // Duplicated from cameraSetupWindow.ts's identical helper rather than
  // imported, for the same reason that one gives: avoids a circular import
  // between this module and index.ts.
  const candidates = [path.join(__dirname, '../index.html'), path.join(__dirname, '../renderer/index.html')];
  return candidates.find((p) => fs.existsSync(p)) ?? candidates[0];
}

/** Opens the recent-students screen, or focuses it if already open. */
export function openRecentStudentsWindow(): void {
  if (recentStudentsWindow) {
    recentStudentsWindow.focus();
    return;
  }

  recentStudentsWindow = new BrowserWindow({
    width: 1000,
    height: 720,
    title: 'Looka — Sinh viên đã chụp',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    recentStudentsWindow.loadURL(`${process.env.VITE_DEV_SERVER_URL}#recent-students`);
  } else {
    recentStudentsWindow.loadFile(rendererEntryDir(), { hash: 'recent-students' });
  }

  recentStudentsWindow.on('closed', () => {
    recentStudentsWindow = null;
  });
}
