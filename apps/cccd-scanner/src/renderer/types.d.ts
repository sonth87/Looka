import type { CccdScannerAPI } from '../preload/index.js';

declare global {
  interface Window {
    cccdScannerAPI: CccdScannerAPI;
  }
}

export {};
