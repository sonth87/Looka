import { app, BrowserWindow, ipcMain, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs';

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 720,
    title: 'Face Platform Kiosk',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.maximize();

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }
}

app.whenReady().then(() => {
  ipcMain.handle('app:getVersion', () => app.getVersion());
  ipcMain.handle('app:getStatus', () => ({ status: 'ONLINE', dbConnected: true }));

  // Native File Export IPC
  ipcMain.handle('session:exportImages', async (_, payload: { sessionId?: string; images: { stepId: string; imagePath: string }[] }) => {
    try {
      if (!payload || !payload.images || payload.images.length === 0) {
        return { success: false, error: 'Không có tệp ảnh để xuất.' };
      }

      const docsDir = app.getPath('documents');
      const sessionId = payload.sessionId || `session_${Date.now()}`;
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
        const filename = `${i + 1}_${item.stepId}.png`;
        const filePath = path.join(exportDir, filename);

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
  });

  // Open Export Directory in Native File Explorer / Finder
  ipcMain.handle('session:openExportDir', async (_, dirPath: string) => {
    if (dirPath && fs.existsSync(dirPath)) {
      shell.openPath(dirPath);
      return true;
    }
    return false;
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

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
