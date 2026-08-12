import { contextBridge, ipcRenderer } from 'electron';

export interface ExportResult {
  success: boolean;
  exportPath?: string;
  fileCount?: number;
  error?: string;
}

export interface FaceAPIBridge {
  getAppVersion: () => Promise<string>;
  getSystemStatus: () => Promise<{ status: string; dbConnected: boolean }>;
  recordAttendance: (params: any) => Promise<any>;
  exportSessionImages: (payload: { sessionId?: string; images: { stepId: string; imagePath: string }[] }) => Promise<ExportResult>;
  openExportDir: (dirPath: string) => Promise<boolean>;
  toggleKiosk: () => Promise<boolean>;
  minimizeWindow: () => Promise<void>;
  closeWindow: () => Promise<void>;
}

const faceAPI: FaceAPIBridge = {
  getAppVersion: () => ipcRenderer.invoke('app:getVersion'),
  getSystemStatus: () => ipcRenderer.invoke('app:getStatus'),
  recordAttendance: (params: any) => ipcRenderer.invoke('attendance:record', params),
  exportSessionImages: (payload) => ipcRenderer.invoke('session:exportImages', payload),
  openExportDir: (dirPath) => ipcRenderer.invoke('session:openExportDir', dirPath),
  toggleKiosk: () => ipcRenderer.invoke('window:toggleKiosk'),
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  closeWindow: () => ipcRenderer.invoke('window:close'),
};

contextBridge.exposeInMainWorld('faceAPI', faceAPI);
