import { contextBridge, ipcRenderer } from 'electron';

export interface FaceAPIBridge {
  getAppVersion: () => Promise<string>;
  getSystemStatus: () => Promise<{ status: string; dbConnected: boolean }>;
  recordAttendance: (params: any) => Promise<any>;
}

const faceAPI: FaceAPIBridge = {
  getAppVersion: () => ipcRenderer.invoke('app:getVersion'),
  getSystemStatus: () => ipcRenderer.invoke('app:getStatus'),
  recordAttendance: (params: any) => ipcRenderer.invoke('attendance:record', params),
};

contextBridge.exposeInMainWorld('faceAPI', faceAPI);
