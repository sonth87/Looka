import { contextBridge, ipcRenderer } from 'electron';

export interface ExportResult {
  success: boolean;
  exportPath?: string;
  fileCount?: number;
  error?: string;
}

export interface UploadStatus {
  /** False when no file-service is configured; captures still queue locally. */
  configured: boolean;
  pending: number;
  sending: number;
  /** Uploaded, waiting for the server to finish scanning. */
  awaitingScan: number;
  failedPermanent: number;
  oldestPendingAt: number | null;
  /** Held in a scanning state longer than expected — needs an operator. */
  stuckAwaitingScan: number;
}

export interface SecretsStatus {
  /** False when the OS keychain is unavailable, so credentials cannot be saved. */
  encryptionAvailable: boolean;
  fileServiceConfigured: boolean;
  /** Host only — enough to confirm the target, never the key itself. */
  fileServiceHost: string | null;
}

export interface SystemStatus {
  status: 'ONLINE' | 'DEGRADED';
  dbConnected: boolean;
  /** Reason the database is unavailable, when it is. */
  dbError: string | null;
  dbPath: string;
  dbSizeBytes: number | null;
  pendingSync: number | null;
  uploads: UploadStatus;
  secrets: SecretsStatus;
  appVersion: string;
  checkedAt: number;
}

export interface PhotoRef {
  jobId: string;
  sessionId: string;
  kind: string;
  /** Server-side id, null until the bytes have been accepted. */
  fsFileId: string | null;
  fsStatus: string | null;
  /** True while the local copy still exists on this machine. */
  localAvailable: boolean;
}

export interface QueueCaptureResult {
  ok: boolean;
  jobId?: string;
  error?: string;
}

export interface FaceAPIBridge {
  getAppVersion: () => Promise<string>;
  getSystemStatus: () => Promise<SystemStatus>;
  recordAttendance: (params: any) => Promise<any>;

  /**
   * Store a capture and queue it for upload.
   *
   * Resolves once the image is on disk and queued — not once it reaches the
   * server. Nothing in the capture flow waits on the network.
   */
  queueCapture: (payload: {
    sessionId: string;
    kind: string;
    stepId: string;
    attempt: number;
    dataUrl: string;
    metadata?: Record<string, string>;
    dependsOn?: string;
  }) => Promise<QueueCaptureResult>;

  getUploadStatus: () => Promise<UploadStatus>;
  pingFileService: () => Promise<boolean>;
  retryUpload: (jobId: string) => Promise<boolean>;
  getUploadEvents: () => Promise<unknown[]>;

  /** Photos of a session and where each one currently lives. */
  listSessionPhotos: (sessionId: string) => Promise<PhotoRef[]>;

  /**
   * Get something displayable for a photo.
   *
   * Returns the local copy when it is still on this machine, otherwise a
   * short-lived server link. Remote links expire, so fetch one when the image
   * is about to be shown rather than holding it.
   */
  viewPhoto: (payload: {
    jobId: string;
    viewerId?: string;
  }) => Promise<{ ok: boolean; source?: 'local' | 'remote'; url?: string; expiresAt?: string; error?: string }>;

  /** Save a photo to disk. Opens a native save dialog. */
  downloadPhoto: (payload: {
    jobId: string;
    viewerId?: string;
  }) => Promise<{ ok: boolean; savedPath?: string; source?: string; bytes?: number; cancelled?: boolean; error?: string }>;

  /**
   * Credential management for the setup screen.
   *
   * There is deliberately no getter for the values: a secret readable from the
   * renderer is a secret the renderer can leak. Only whether one is configured.
   */
  getSecretsStatus: () => Promise<SecretsStatus>;
  setFileServiceCredentials: (payload: {
    baseUrl: string;
    apiKey: string;
  }) => Promise<{ ok: boolean; uploading?: boolean; error?: string }>;
  clearFileServiceCredentials: () => Promise<{ ok: boolean }>;

  exportSessionImages: (payload: { sessionId?: string; images: { stepId: string; imagePath: string }[] }) => Promise<ExportResult>;
  openExportDir: (dirPath: string) => Promise<boolean>;
  toggleKiosk: () => Promise<boolean>;
  minimizeWindow: () => Promise<void>;
  closeWindow: () => Promise<void>;
}

// Each channel is named explicitly. No generic invoke(channel, args) escape
// hatch: the renderer is untrusted, and a pass-through would hand it the whole
// main-process surface.
const faceAPI: FaceAPIBridge = {
  getAppVersion: () => ipcRenderer.invoke('app:getVersion'),
  getSystemStatus: () => ipcRenderer.invoke('app:getStatus'),
  recordAttendance: (params: any) => ipcRenderer.invoke('attendance:record', params),

  queueCapture: (payload) => ipcRenderer.invoke('capture:queue', payload),
  getUploadStatus: () => ipcRenderer.invoke('uploads:status'),
  pingFileService: () => ipcRenderer.invoke('uploads:ping'),
  retryUpload: (jobId) => ipcRenderer.invoke('uploads:retry', jobId),
  getUploadEvents: () => ipcRenderer.invoke('uploads:recentEvents'),

  listSessionPhotos: (sessionId) => ipcRenderer.invoke('photos:list', sessionId),
  viewPhoto: (payload) => ipcRenderer.invoke('photos:view', payload),
  downloadPhoto: (payload) => ipcRenderer.invoke('photos:download', payload),

  getSecretsStatus: () => ipcRenderer.invoke('secrets:status'),
  setFileServiceCredentials: (payload) => ipcRenderer.invoke('secrets:setFileService', payload),
  clearFileServiceCredentials: () => ipcRenderer.invoke('secrets:clearFileService'),

  exportSessionImages: (payload) => ipcRenderer.invoke('session:exportImages', payload),
  openExportDir: (dirPath) => ipcRenderer.invoke('session:openExportDir', dirPath),
  toggleKiosk: () => ipcRenderer.invoke('window:toggleKiosk'),
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  closeWindow: () => ipcRenderer.invoke('window:close'),
};

contextBridge.exposeInMainWorld('faceAPI', faceAPI);
