import { app, BrowserWindow, ipcMain, session } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { writeCccdResponseFile, responseFilePath } from './responseWriter.js';

/**
 * Same Windows hardware-capture workaround as apps/desktop/src/main/index.ts
 * — see that file's doc comment on this exact switch for the full
 * MF_E_HW_MFT_FAILED_START_STREAMING reasoning. This app opens its own
 * getUserMedia camera stream (the phone's bridged webcam device), so it can
 * hit the same GPU/driver pitfall independently of the kiosk process.
 */
app.commandLine.appendSwitch('disable-features', 'MediaFoundationD3D11VideoCapture');

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 760,
    minWidth: 700,
    minHeight: 600,
    title: 'CCCD Scanner',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(rendererEntry());
  }
}

/**
 * Same "vite emits index.html at dist/ root, main process compiles into
 * dist/main/" layout apps/desktop/src/main/index.ts's rendererEntry()
 * documents — see that file for the full reasoning.
 */
function rendererEntry(): string {
  const candidates = [path.join(__dirname, '../index.html'), path.join(__dirname, '../renderer/index.html')];
  const found = candidates.find((p) => fs.existsSync(p));
  if (!found) {
    throw new Error(
      `Renderer entry not found. Looked in:\n  ${candidates.join('\n  ')}\nRun the renderer build before packaging.`
    );
  }
  return found;
}

app
  .whenReady()
  .then(() => {
    /**
     * This tool's whole job is opening a getUserMedia camera stream for the
     * operator to pick from — Electron's own default with no handler
     * installed already grants every permission request, so this exists
     * purely so a denial (or the request itself) is visible in the console
     * rather than failing silently inside the renderer. See
     * apps/desktop/src/main/index.ts's identical handler for the same
     * reasoning.
     */
    session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
      console.log(`[permission] request: ${permission}`);
      callback(true);
    });

    ipcMain.handle('app:getVersion', () => app.getVersion());

    ipcMain.handle(
      'cccd:writeResponseFile',
      (_event, payload: { citizenId: string; fullName: string }) => {
        if (!/^\d{12}$/.test(payload.citizenId)) {
          // Defense in depth: the renderer already gates on
          // extractCitizenId's regex before ever offering the confirm
          // button, but the main process is the actual disk-writer and
          // should never trust a renderer-supplied string blindly.
          return { ok: false, error: 'citizenId must be exactly 12 digits' };
        }
        try {
          writeCccdResponseFile({ citizenId: payload.citizenId, fullName: payload.fullName ?? '' });
          return { ok: true, path: responseFilePath() };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error('[cccd-scanner] failed to write response.json:', message);
          return { ok: false, error: message };
        }
      }
    );

    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  })
  .catch((err) => {
    console.error('[fatal] startup failed inside app.whenReady():', err);
  });

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
