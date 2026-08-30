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

export interface ApproveSessionUploadResult {
  ok: boolean;
  /** Rows this call actually released; 0 for an already-approved session. */
  approved?: number;
  error?: string;
}

export type CameraRole = 'CENTER' | 'LEFT' | 'RIGHT';
export type CameraRoleMapping = Partial<Record<CameraRole, string>>;

export interface CbHelpStep {
  id: string;
  type: string;
  instruction: string;
}

export interface CbHelpCapture {
  stepId: string;
  attempt: number;
  dataUrl: string;
  capturedAt: number;
}

export interface CbHelpState {
  steps: CbHelpStep[];
  captures: Record<string, CbHelpCapture>;
}

export interface CampaignConfig {
  id: string;
  name: string;
  purpose: 'STUDENT_CARD' | 'KYC_ENROLLMENT';
  expiresAt: string | null;
  consentContent: string | null;
  consentVersion: number;
  captureAngles: unknown[] | null;
  captureMode: 'AUTO' | 'MANUAL' | 'OFF' | null;
  autoHoldMs: number | null;
}

/**
 * §3.3's fail-closed verdict alongside the config itself — see
 * deviceApi.ts's DeviceAccessStatus (this is its IPC-facing mirror).
 */
export interface DeviceAccessStatus {
  blocked: boolean;
  reason?: 'unauthorized' | 'unreachable-too-long';
  config: CampaignConfig | null;
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

  /**
   * Release a reviewed session's staged captures for upload.
   *
   * Until this is called, that session's rows sit on disk and in the local
   * queue but are invisible to the background uploader — see queueCapture's
   * own doc comment and `session:approveUpload`'s handler in the main
   * process. Safe to call more than once for the same session; a repeat call
   * finds nothing left to approve and reports `approved: 0`.
   */
  approveSessionUpload: (payload: { sessionId: string }) => Promise<ApproveSessionUploadResult>;

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

  /**
   * This kiosk's own campaign config (§3.6/§3.8/§2.4) plus the §3.3
   * fail-closed verdict. `config` is `null` when this kiosk has no device
   * identity yet, or none has ever been confirmed by the admin portal —
   * callers fall back to `defaultWorkflow`/local settings in that case.
   * `blocked: true` means capture must actually be refused, not just
   * defaulted around — see DeviceAccessStatus's own doc comment.
   */
  getDeviceAccessStatus: () => Promise<DeviceAccessStatus>;

  /**
   * Report the workflow this session just started with, so the CB Help
   * display (§3.5) — if a second one is open — resets to show this run.
   * A harmless no-op call when no such window exists.
   */
  notifyCbHelpSessionStarted: (steps: CbHelpStep[]) => Promise<boolean>;

  /**
   * Only meaningful from inside the CB Help window itself: hydrates on open
   * (or after a reload) with whatever the main kiosk window has reported so
   * far, before the next push arrives.
   */
  getCbHelpState: () => Promise<CbHelpState>;

  /**
   * Only meaningful from inside the CB Help window: subscribes to every
   * state push from the main process (a new session, or one more capture).
   * Returns an unsubscribe function.
   */
  onCbHelpUpdate: (callback: (state: CbHelpState) => void) => () => void;

  /**
   * Local video recording (§3.1) — registers a row before any bytes exist.
   * See `streams.ts`'s own doc comment for the two-call start/end shape.
   */
  startVideoStream: (payload: {
    sessionId: string;
    cameraId: string;
    mimeType?: string;
  }) => Promise<{ streamId: string; localPath: string }>;

  /** Writes the recorded bytes and closes out the row `startVideoStream` opened. */
  endVideoStream: (payload: {
    streamId: string;
    data: Uint8Array;
    durationMs: number;
  }) => Promise<{ ok: boolean; error?: string }>;

  /** Runtime camera role mapping (§2.1) — set from the camera setup screen. */
  getCameraRoleMapping: () => Promise<CameraRoleMapping>;
  setCameraRoleMapping: (mapping: CameraRoleMapping) => Promise<boolean>;

  /**
   * Reports a stats-worthy moment (§3.4) — queued locally and pushed to the
   * admin portal on its own schedule. Never rejects; a failed/impossible
   * report must not interrupt the capture flow that triggered it.
   */
  recordStatsEvent: (payload: {
    type: 'SESSION_COMPLETED' | 'UPLOAD_SUCCESS' | 'UPLOAD_FAILED' | 'RETAKE' | 'CB_HELP_INTERVENTION';
    metadata?: Record<string, unknown>;
  }) => Promise<boolean>;

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
  approveSessionUpload: (payload) => ipcRenderer.invoke('session:approveUpload', payload),
  getUploadStatus: () => ipcRenderer.invoke('uploads:status'),
  pingFileService: () => ipcRenderer.invoke('uploads:ping'),
  retryUpload: (jobId) => ipcRenderer.invoke('uploads:retry', jobId),
  getUploadEvents: () => ipcRenderer.invoke('uploads:recentEvents'),

  listSessionPhotos: (sessionId) => ipcRenderer.invoke('photos:list', sessionId),
  viewPhoto: (payload) => ipcRenderer.invoke('photos:view', payload),
  downloadPhoto: (payload) => ipcRenderer.invoke('photos:download', payload),

  getSecretsStatus: () => ipcRenderer.invoke('secrets:status'),
  getDeviceAccessStatus: () => ipcRenderer.invoke('device:getAccessStatus'),

  notifyCbHelpSessionStarted: (steps) => ipcRenderer.invoke('cbhelp:sessionStarted', steps),
  getCbHelpState: () => ipcRenderer.invoke('cbhelp:getState'),
  onCbHelpUpdate: (callback) => {
    const listener = (_: unknown, state: CbHelpState) => callback(state);
    ipcRenderer.on('cbhelp:state', listener);
    return () => ipcRenderer.removeListener('cbhelp:state', listener);
  },

  startVideoStream: (payload) => ipcRenderer.invoke('stream:start', payload),
  endVideoStream: (payload) => ipcRenderer.invoke('stream:end', payload),

  getCameraRoleMapping: () => ipcRenderer.invoke('camera:getRoleMapping'),
  setCameraRoleMapping: (mapping) => ipcRenderer.invoke('camera:setRoleMapping', mapping),

  recordStatsEvent: (payload) => ipcRenderer.invoke('stats:recordEvent', payload),
  setFileServiceCredentials: (payload) => ipcRenderer.invoke('secrets:setFileService', payload),
  clearFileServiceCredentials: () => ipcRenderer.invoke('secrets:clearFileService'),

  exportSessionImages: (payload) => ipcRenderer.invoke('session:exportImages', payload),
  openExportDir: (dirPath) => ipcRenderer.invoke('session:openExportDir', dirPath),
  toggleKiosk: () => ipcRenderer.invoke('window:toggleKiosk'),
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  closeWindow: () => ipcRenderer.invoke('window:close'),
};

contextBridge.exposeInMainWorld('faceAPI', faceAPI);
