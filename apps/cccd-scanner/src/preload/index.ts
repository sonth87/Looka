import { contextBridge, ipcRenderer } from 'electron';

/**
 * The renderer's only privileged surface: writing the confirmed scan result
 * to disk. Everything else this tool needs (camera enumeration, live
 * preview, OCR) runs entirely through standard browser APIs
 * (`navigator.mediaDevices`, `<canvas>`, Tesseract.js's browser build)
 * available directly in the renderer — no main-process bridging needed for
 * any of it, per the product brief.
 */
export interface WriteCccdScanResult {
  ok: boolean;
  path?: string;
  error?: string;
}

export interface CccdScannerAPI {
  /** Writes `{ soCCCD, hoTen }` to the fixed response.json path — see main/responseWriter.ts. Only ever called after the operator has explicitly confirmed the OCR'd id number on screen. */
  writeScan: (payload: { citizenId: string; fullName: string }) => Promise<WriteCccdScanResult>;
  getAppVersion: () => Promise<string>;
}

const cccdScannerAPI: CccdScannerAPI = {
  writeScan: (payload) => ipcRenderer.invoke('cccd:writeResponseFile', payload),
  getAppVersion: () => ipcRenderer.invoke('app:getVersion'),
};

contextBridge.exposeInMainWorld('cccdScannerAPI', cccdScannerAPI);
