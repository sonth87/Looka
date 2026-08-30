import { app, BrowserWindow, dialog, globalShortcut, ipcMain, screen, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import type { Visibility } from '@face/core';
import {
  initDatabase,
  getDatabase,
  getDatabaseError,
  getDatabasePath,
  isDatabaseHealthy,
  closeDatabase,
} from './db.js';
import {
  startUploads,
  stopUploads,
  queueCapture,
  approveSessionUpload,
  uploadStatus,
  retryFailedUpload,
  pingFileService,
  recentUploadEvents,
  listSessionPhotos,
  getPhotoViewSource,
  downloadPhoto,
} from './uploads.js';
import {
  getFileServiceCredentials,
  setFileServiceCredentials,
  clearFileServiceCredentials,
  secretsStatus,
  findAndImportActivationFileIfPresent,
  getCameraRoleMapping,
  setCameraRoleMapping,
  type CameraRoleMapping,
} from './secrets.js';
import { openCameraSetupWindow } from './cameraSetupWindow.js';
import { getDeviceAccessStatus } from './deviceApi.js';
import { startVideoStream, endVideoStream } from './streams.js';
import { recordStatsEvent, startStatsEventPush, stopStatsEventPush } from './statsEvents.js';
import type { StatsEventType } from '@face/database';
import {
  maybeOpenCbHelpWindow,
  cbHelpSessionStarted,
  cbHelpCaptureAdded,
  getCbHelpState,
  type CbHelpStep,
} from './cbHelpWindow.js';
import { initLogger, installCrashHandlers, closeLogger, logFilePath } from './logger.js';

/**
 * Disable Chromium's hardware-accelerated (D3D11/Media Foundation) webcam
 * capture path on Windows.
 *
 * On some GPU/driver combinations that pipeline fails with
 * MF_E_HW_MFT_FAILED_START_STREAMING (0xC00D3704, "lack of hardware
 * resources") — reproduced here after several rapid app restarts in a row,
 * which fragments GPU-process resources across the repeated launches.
 * Chromium then reports this to the page as a bare "Could not start video
 * source", with nothing short of a reboot fixing it while the hardware path
 * stays wedged. Falling back to Chromium's software capture path sidesteps
 * the hardware MFT entirely, at the cost of slightly higher CPU use for
 * decoding — an easy trade for a kiosk that must reliably reopen its camera.
 *
 * Must be set before app.whenReady() / any BrowserWindow — Chromium reads
 * this switch during its own startup, not on demand.
 */
app.commandLine.appendSwitch('disable-features', 'MediaFoundationD3D11VideoCapture');

/**
 * Name the user-data folder explicitly.
 *
 * Electron derives it from the package name, which here is "@face/desktop" and
 * produces a nested "@face/desktop" path with an "@" in it. Worse, renaming the
 * package later would silently point the app at an empty folder and look like
 * total data loss.
 *
 * Must run before anything calls app.getPath('userData'), so it sits at module
 * scope rather than inside whenReady.
 */
app.setName('FacePlatformKiosk');

// Before anything else can fail: a crash during startup is exactly the one that
// leaves no console to read, because nobody launches a kiosk from a terminal.
initLogger();
installCrashHandlers();

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  const iconPath = path.join(__dirname, '../renderer/assets/icon.png');
  const fallbackIconPath = path.join(__dirname, '../../public/icon.png');
  const validIcon = fs.existsSync(iconPath) ? iconPath : fs.existsSync(fallbackIconPath) ? fallbackIconPath : undefined;

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 720,
    title: 'Looka',
    icon: validIcon,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.maximize();
  attachRendererDiagnostics(mainWindow);

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(rendererEntry());
  }
}

/**
 * Surface renderer failures in the main-process log.
 *
 * A blank window is the worst thing to debug because nothing reports it: the
 * process is healthy, the file loaded, and only the page is empty. These hooks
 * turn that silence into a line saying which asset failed and why.
 */
function attachRendererDiagnostics(win: BrowserWindow): void {
  win.webContents.on('did-fail-load', (_e, errorCode, errorDescription, validatedURL) => {
    console.error(`[renderer] failed to load ${validatedURL}: ${errorDescription} (${errorCode})`);
  });

  win.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    // Only errors and warnings; ordinary logs would drown the operator log.
    if (level >= 2) {
      console.error(`[renderer] ${message} (${sourceId}:${line})`);
    }
  });

  win.webContents.on('render-process-gone', (_e, details) => {
    console.error(`[renderer] process gone: ${details.reason} (exit ${details.exitCode})`);
  });

  // The three ways a kiosk "closes by itself": the renderer wedges and Windows
  // offers to kill it, the window is closed by something other than the
  // operator, or the GPU process dies and takes the window with it.
  win.webContents.on('unresponsive', () => {
    console.error('[renderer] unresponsive — the page stopped answering');
  });
  win.webContents.on('responsive', () => console.log('[renderer] responsive again'));
  win.on('close', () => console.log('[window] close requested'));
  win.on('closed', () => {
    console.log('[window] closed');
    mainWindow = null;
  });

  // A page that loads but paints nothing is exactly the blank-window symptom,
  // so check that the app actually mounted rather than trusting did-finish-load.
  win.webContents.on('did-finish-load', () => {
    win.webContents
      .executeJavaScript('document.getElementById("root")?.childElementCount ?? -1')
      .then((count: number) => {
        if (count === -1) console.error('[renderer] #root element is missing from the page');
        else if (count === 0) {
          console.error(
            '[renderer] page loaded but #root is empty — the app bundle did not run. ' +
              'Check that asset paths are relative (vite base: "./") for file:// loading.'
          );
        }
      })
      .catch(() => {
        /* window may already be closing */
      });
  });
}

/**
 * Path to the built renderer.
 *
 * Vite emits index.html at the root of dist/, while the main process is
 * compiled into dist/main/ — so the entry sits one level up, not in a
 * dist/renderer/ folder. Getting this wrong produces a blank window that only
 * appears in a packaged build, never under `pnpm dev`, because the dev server
 * serves the page over HTTP instead.
 *
 * Checked at runtime so a layout change fails with a clear message rather than
 * an empty screen.
 */
function rendererEntry(): string {
  const candidates = [
    path.join(__dirname, '../index.html'),
    path.join(__dirname, '../renderer/index.html'),
  ];
  const found = candidates.find((p) => fs.existsSync(p));
  if (!found) {
    throw new Error(
      `Renderer entry not found. Looked in:\n  ${candidates.join('\n  ')}\n` +
        'Run the renderer build before packaging.'
    );
  }
  return found;
}

/**
 * Sanitise a renderer-supplied string before it becomes part of a file name.
 *
 * The renderer is untrusted input: a stepId of '../../../evil' would otherwise
 * place the written file outside the export directory.
 */
function safeFileToken(raw: unknown, fallback: string): string {
  const cleaned = String(raw ?? '')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 40);
  return cleaned.length > 0 ? cleaned : fallback;
}

app.whenReady().then(async () => {
  if (process.platform === 'darwin' && app.dock) {
    const dockIconPath = path.join(__dirname, '../../public/icon.png');
    if (fs.existsSync(dockIconPath)) {
      app.dock.setIcon(dockIconPath);
    }
  }

  // One-time: pick up activation.json left next to the install, if this
  // kiosk has not already loaded one — see secrets.ts's own doc comment.
  await findAndImportActivationFileIfPresent();

  const dbResult = await initDatabase();
  if (!dbResult.ok) {
    // Deliberately not fatal here — the window still opens so an operator sees
    // an explanation. What must not happen is the kiosk behaving normally while
    // nothing is being stored; every write path throws until this is fixed.
    console.error('[main] database unavailable:', dbResult.error);
  }

  // Background uploading is optional: without a configured server the kiosk
  // still captures and queues, and the backlog drains once one is set up.
  if (dbResult.ok) {
    const uploadsRunning = startUploads(await getFileServiceCredentials());
    if (!uploadsRunning) {
      console.warn('[main] file-service not configured; captures will queue locally only');
    }
    // Independent of fs-core being configured — a kiosk with no device
    // identity yet just never has anything to push (DeviceApiClient.pushEvents
    // returns false with no baseUrl/creds), same offline-first shape as
    // uploads. See statsEvents.ts's own doc comment.
    startStatsEventPush();
  }

  ipcMain.handle('app:getVersion', () => app.getVersion());

  /** Where the log lives, and a way to open it — for diagnosing an app that quit. */
  ipcMain.handle('app:getLogPath', () => logFilePath());
  ipcMain.handle('app:openLogFolder', () => {
    shell.showItemInFolder(logFilePath());
    return true;
  });

  /**
   * Real health, not a constant.
   *
   * The previous version returned `{ status: 'ONLINE', dbConnected: true }`
   * unconditionally, so an operator saw "database connected" on a machine where
   * nothing was being persisted.
   */
  ipcMain.handle('app:getStatus', () => {
    const dbConnected = isDatabaseHealthy();
    let pendingSync: number | null = null;
    let dbSizeBytes: number | null = null;

    if (dbConnected) {
      try {
        const rows = getDatabase().exec<{ n: number }>(
          "SELECT COUNT(*) AS n FROM sync_queue WHERE status = 'PENDING'"
        );
        pendingSync = Number(rows[0]?.n ?? 0);
      } catch {
        pendingSync = null;
      }
      try {
        dbSizeBytes = fs.statSync(getDatabasePath()).size;
      } catch {
        dbSizeBytes = null;
      }
    }

    return {
      status: dbConnected ? 'ONLINE' : 'DEGRADED',
      dbConnected,
      dbError: getDatabaseError(),
      dbPath: getDatabasePath(),
      dbSizeBytes,
      pendingSync,
      uploads: uploadStatus(),
      secrets: secretsStatus(),
      appVersion: app.getVersion(),
      checkedAt: Date.now(),
    };
  });

  /** Reachability of the file-service, measured on demand rather than cached. */
  ipcMain.handle('uploads:ping', () => pingFileService());

  /**
   * Whether credentials exist — never their values.
   *
   * A secret that can be read back over IPC is a secret the renderer can leak.
   */
  ipcMain.handle('secrets:status', () => secretsStatus());

  /**
   * This kiosk's own campaign config — capture angles (§3.6), capture
   * mode/autoHoldMs (§3.8), consent text/version (§2.4) — plus whether §3.3's
   * fail-closed policy says capture must be blocked outright (a confirmed
   * `401`, or unreachable for more than 24h since the last confirmed-good
   * contact). A kiosk with no device identity at all is left alone (`blocked:
   * false, config: null`) — it predates device management, or was never
   * registered through the CMS; see getDeviceAccessStatus's own doc comment.
   */
  ipcMain.handle('device:getAccessStatus', () => getDeviceAccessStatus());

  /**
   * The renderer reporting a stats-worthy moment it just observed (a
   * session completed, a retake) — see docs/plans/multi-camera-device-management-discussion.md
   * §3.4. Queued locally and pushed on `statsEvents.ts`'s own schedule;
   * never blocks or throws back to the caller.
   */
  ipcMain.handle('stats:recordEvent', (_, payload: { type?: unknown; metadata?: unknown }) => {
    const type = payload?.type as StatsEventType | undefined;
    if (!type) return false;
    recordStatsEvent(type, (payload?.metadata as Record<string, unknown>) ?? undefined);
    return true;
  });

  /**
   * The main kiosk window reports the workflow it just started; the CB Help
   * window (if one is open) resets to show that run instead of whatever
   * came before. See cbHelpWindow.ts's own doc comment.
   */
  ipcMain.handle('cbhelp:sessionStarted', (_, steps: unknown) => {
    const list = Array.isArray(steps) ? (steps as CbHelpStep[]) : [];
    cbHelpSessionStarted(list);
    return true;
  });

  /** Hydration for a CB Help window that just opened or reloaded mid-session. */
  ipcMain.handle('cbhelp:getState', () => getCbHelpState());

  /**
   * Runtime camera role mapping (§2.1) — which physical camera plays
   * CENTER/LEFT/RIGHT. Set from the camera setup screen
   * (`Ctrl/Cmd+Shift+K`), read by the main kiosk window to know which
   * `enumerateDevices()` id corresponds to which logical role.
   */
  ipcMain.handle('camera:getRoleMapping', () => getCameraRoleMapping());
  ipcMain.handle('camera:setRoleMapping', (_, mapping: unknown) => {
    setCameraRoleMapping((mapping ?? {}) as CameraRoleMapping);
    return true;
  });

  /**
   * Local video recording — see streams.ts's own doc comment. `stream:start`
   * registers the row before any bytes exist; `stream:end` writes the
   * recorded bytes once `MediaRecorder` actually stops.
   */
  ipcMain.handle('stream:start', (_, payload: { sessionId?: unknown; cameraId?: unknown; mimeType?: unknown }) => {
    return startVideoStream({
      sessionId: safeFileToken(payload?.sessionId, 'session'),
      cameraId: safeFileToken(payload?.cameraId, 'camera'),
      mimeType: typeof payload?.mimeType === 'string' ? payload.mimeType : undefined,
    });
  });

  ipcMain.handle(
    'stream:end',
    (_, payload: { streamId?: unknown; data?: unknown; durationMs?: unknown }) => {
      const streamId = String(payload?.streamId ?? '');
      if (!streamId) return { ok: false, error: 'streamId is required' };
      if (!(payload?.data instanceof Uint8Array)) {
        return { ok: false, error: 'data must be a Uint8Array' };
      }
      return endVideoStream({
        streamId,
        data: payload.data,
        durationMs: Number(payload?.durationMs ?? 0) || 0,
      });
    }
  );

  /** Save credentials from the setup screen and (re)start uploading with them. */
  ipcMain.handle('secrets:setFileService', async (_, payload: { baseUrl?: unknown; apiKey?: unknown }) => {
    const baseUrl = String(payload?.baseUrl ?? '').trim();
    const apiKey = String(payload?.apiKey ?? '').trim();

    if (!baseUrl || !apiKey) {
      return { ok: false, error: 'Both a server address and an API key are required.' };
    }
    try {
      // Reject a malformed address here rather than on every upload attempt.
      new URL(baseUrl);
    } catch {
      return { ok: false, error: 'The server address is not a valid URL.' };
    }

    try {
      setFileServiceCredentials({ baseUrl, apiKey });
    } catch (err) {
      // Encryption unavailable — say so instead of storing the key in the clear.
      return { ok: false, error: (err as Error).message };
    }

    stopUploads();
    const started = startUploads(await getFileServiceCredentials());
    return { ok: true, uploading: started };
  });

  ipcMain.handle('secrets:clearFileService', () => {
    stopUploads();
    clearFileServiceCredentials();
    return { ok: true };
  });

  ipcMain.handle('uploads:status', () => uploadStatus());

  ipcMain.handle('uploads:retry', (_, jobId: unknown) => {
    if (typeof jobId !== 'string' || jobId.length === 0) return false;
    retryFailedUpload(jobId);
    return true;
  });

  ipcMain.handle('uploads:recentEvents', () => recentUploadEvents());

  /** Photos of a session and where each one currently lives. */
  ipcMain.handle('photos:list', (_, sessionId: unknown) => {
    if (typeof sessionId !== 'string' || !sessionId) return [];
    return listSessionPhotos(sessionId);
  });

  /**
   * Something displayable for a photo: the local copy if it is still here,
   * otherwise a short-lived server link.
   *
   * viewerId is who is looking — the server records it, and access is checked
   * when the link is opened rather than when it is issued.
   */
  ipcMain.handle('photos:view', async (_, payload: { jobId?: unknown; viewerId?: unknown }) => {
    const jobId = String(payload?.jobId ?? '');
    if (!jobId) return { ok: false, error: 'A photo id is required.' };
    try {
      const view = await getPhotoViewSource(jobId, String(payload?.viewerId ?? 'operator'));
      return { ok: true, ...view };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  });

  /** Save a photo to disk, asking the operator where to put it. */
  ipcMain.handle('photos:download', async (_, payload: { jobId?: unknown; viewerId?: unknown }) => {
    const jobId = String(payload?.jobId ?? '');
    if (!jobId) return { ok: false, error: 'A photo id is required.' };

    const suggested = path.join(app.getPath('downloads'), `${safeFileToken(jobId, 'photo')}.jpg`);
    const chosen = await dialog.showSaveDialog({
      defaultPath: suggested,
      filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png'] }],
    });
    if (chosen.canceled || !chosen.filePath) return { ok: false, cancelled: true };

    try {
      const result = await downloadPhoto(jobId, chosen.filePath, String(payload?.viewerId ?? 'operator'));
      return { ok: true, ...result };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  });

  /**
   * Persist a capture and queue it for upload.
   *
   * The renderer sends a data URL; bytes are decoded here so the image never
   * crosses the boundary as a string that something might log.
   */
  ipcMain.handle(
    'capture:queue',
    (
      _,
      payload: {
        sessionId?: unknown;
        kind?: unknown;
        stepId?: unknown;
        attempt?: unknown;
        dataUrl?: unknown;
        metadata?: unknown;
        dependsOn?: unknown;
      }
    ) => {
      try {
        const dataUrl = String(payload?.dataUrl ?? '');
        if (!dataUrl.startsWith('data:image')) {
          return { ok: false, error: 'Expected an image data URL' };
        }
        const mimeType = dataUrl.slice(5, dataUrl.indexOf(';'));
        const data = Buffer.from(dataUrl.replace(/^data:image\/\w+;base64,/, ''), 'base64');

        // Every capture this kiosk takes is a face/attendance image — never
        // public — decided here, at the one place that knows that, rather
        // than assumed by the generic queue/upload machinery downstream.
        const visibility: Visibility = 'private';

        const jobId = queueCapture({
          sessionId: safeFileToken(payload?.sessionId, 'session'),
          kind: safeFileToken(payload?.kind, 'raw'),
          stepId: safeFileToken(payload?.stepId, 'step'),
          attempt: Number(payload?.attempt ?? 1) || 1,
          data,
          mimeType,
          metadata:
            payload?.metadata && typeof payload.metadata === 'object'
              ? (payload.metadata as Record<string, string>)
              : undefined,
          dependsOn: typeof payload?.dependsOn === 'string' ? payload.dependsOn : undefined,
          visibility,
        });

        // View-only feed for whoever is watching the CB Help display, if one
        // is open — see cbHelpWindow.ts's own doc comment. A no-op when no
        // such window exists.
        cbHelpCaptureAdded({
          stepId: safeFileToken(payload?.stepId, 'step'),
          attempt: Number(payload?.attempt ?? 1) || 1,
          dataUrl,
          capturedAt: Date.now(),
        });

        return { ok: true, jobId };
      } catch (err) {
        // Storage failed: say so. A capture that was not stored must never be
        // reported as accepted.
        return { ok: false, error: (err as Error).message };
      }
    }
  );

  /**
   * Release a reviewed session's staged captures for upload.
   *
   * The renderer calls this from SessionReviewModal's "Xác nhận & Lưu hồ sơ"
   * button, after the operator has reviewed every step. Every row queueCapture
   * wrote for this session so far — and only this session — becomes eligible
   * for the existing background UploadWorker from here; nothing here talks to
   * the file-service directly. A session with nothing left to approve
   * (already approved, or unknown) is not an error: `approved: 0` reports
   * that plainly so the caller can tell a genuine approval from a no-op.
   */
  ipcMain.handle('session:approveUpload', (_, payload: { sessionId?: unknown }) => {
    const sessionId = String(payload?.sessionId ?? '');
    if (!sessionId) return { ok: false, error: 'A session id is required.' };
    try {
      const approved = approveSessionUpload(sessionId);
      return { ok: true, approved };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  });

  // Native File Export IPC
  ipcMain.handle(
    'session:exportImages',
    async (_, payload: { sessionId?: string; images: { stepId: string; imagePath: string }[] }) => {
      try {
        if (!payload || !payload.images || payload.images.length === 0) {
          return { success: false, error: 'Không có tệp ảnh để xuất.' };
        }

        const docsDir = app.getPath('documents');
        const sessionId = safeFileToken(payload.sessionId, `session_${Date.now()}`);
        const exportDir = path.join(docsDir, 'FaceCapture', 'Exports', sessionId);

        if (!fs.existsSync(exportDir)) {
          fs.mkdirSync(exportDir, { recursive: true });
        }

        const savedFiles: string[] = [];

        for (let i = 0; i < payload.images.length; i++) {
          const item = payload.images[i];
          if (!item.imagePath || !item.imagePath.startsWith('data:image')) continue;

          const base64Data = item.imagePath.replace(/^data:image\/\w+;base64,/, '');
          const buffer = Buffer.from(base64Data, 'base64');
          const filename = `${i + 1}_${safeFileToken(item.stepId, 'step')}.png`;
          const filePath = path.join(exportDir, filename);

          // Second line of defence: even if the token rules change, refuse to
          // write outside the intended directory.
          if (!path.resolve(filePath).startsWith(path.resolve(exportDir) + path.sep)) {
            continue;
          }

          fs.writeFileSync(filePath, buffer);
          savedFiles.push(filePath);
        }

        return {
          success: true,
          exportPath: exportDir,
          fileCount: savedFiles.length,
        };
      } catch (err: any) {
        return { success: false, error: err.message || 'Lỗi khi ghi tệp ra máy tính.' };
      }
    }
  );

  // Open Export Directory in Native File Explorer / Finder
  ipcMain.handle('session:openExportDir', async (_, dirPath: string) => {
    // Only ever open inside our own export root.
    const root = path.resolve(path.join(app.getPath('documents'), 'FaceCapture', 'Exports'));
    const target = path.resolve(String(dirPath ?? ''));
    if (!target.startsWith(root) || !fs.existsSync(target)) return false;
    shell.openPath(target);
    return true;
  });

  // Window Controls IPC
  ipcMain.handle('window:toggleKiosk', () => {
    if (mainWindow) {
      const nextKiosk = !mainWindow.isKiosk();
      mainWindow.setKiosk(nextKiosk);
      return nextKiosk;
    }
    return false;
  });

  ipcMain.handle('window:minimize', () => {
    if (mainWindow) mainWindow.minimize();
  });

  ipcMain.handle('window:close', () => {
    if (mainWindow) mainWindow.close();
  });

  createWindow();

  // Only opens something when a second display is actually connected — see
  // maybeOpenCbHelpWindow's own doc comment. Deferred one tick past
  // createWindow() so mainWindow's bounds are settled before asking which
  // display it is on.
  if (mainWindow) {
    const mainDisplay = screen.getDisplayMatching(mainWindow.getBounds());
    maybeOpenCbHelpWindow(mainDisplay.id);
  }

  // CB Help's entry point into the camera role-assignment screen (§2.1) —
  // see cameraSetupWindow.ts's own doc comment for why this is a separate
  // window rather than something bolted onto the kiosk UI. A global shortcut
  // rather than an on-screen button: this app has no resolved "CB Help mode"
  // surface yet (open question §4 #16) to put a button on.
  globalShortcut.register('CommandOrControl+Shift+K', () => openCameraSetupWindow());

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  stopUploads();
  stopStatsEventPush();
  closeDatabase();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  stopUploads();
  stopStatsEventPush();
  closeDatabase();
  closeLogger();
  globalShortcut.unregisterAll();
});
