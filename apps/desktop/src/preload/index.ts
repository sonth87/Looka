import { contextBridge, ipcRenderer } from 'electron';
import type { AttendanceResult, Person } from '@face/core';

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
  /** null until this process has performed its first successful write. */
  lastWriteAt: number | null;
  /** Live-pinged on every call (`GET /api/v1/health`, 5s timeout) — see aiService.ts. */
  aiServiceReachable: boolean;
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
  /** Rows this call deleted because a later attempt at the same step superseded them. */
  superseded?: number;
  /** Recordings of this session this call enqueued for upload to file-service. */
  videosEnqueued?: number;
  error?: string;
}

/**
 * Per-step context sent alongside approveSessionUpload so the main process
 * can enrich the SESSION_REPORT stats event (§5 of phase-11's plan) with
 * facts the local outbox row alone does not have. Mirrors
 * `packages/ui/src/lib/CaptureSink.ts`'s `ApprovalStepInfo` — duplicated
 * rather than imported, the same pattern every other faceAPI payload shape
 * here already follows (see CbHelpFrame's own doc comment).
 */
export interface ApprovalStepInfo {
  stepId: string;
  stepType: string;
  cameraRole: string;
  attempt: number;
  capturedAt?: string;
}

export type CameraRole = 'CENTER' | 'LEFT' | 'RIGHT';
export type CameraRoleMapping = Partial<Record<CameraRole, string>>;

/**
 * The CB Help extended-display window's capture-frames snapshot (§3.5,
 * 2026-09-05 product decision — the window shows only the capture frames,
 * not a mirror of the app; see cbHelpWindow.ts's own doc comment). Mirrors
 * `packages/ui/src/components/screens/FaceCaptureApp.tsx`'s own copy of this
 * same shape — duplicated rather than imported, same as every other
 * `faceAPI` payload type here (this file never imports from `@face/ui`).
 */
export type CbHelpFrameStatus = 'PENDING' | 'CURRENT' | 'COMPLETED' | 'FAILED';

export interface CbHelpFrame {
  stepId: string;
  stepType: string;
  role: string;
  label: string;
  deviceId: string | null;
  status: CbHelpFrameStatus;
  capturedDataUrl?: string;
  attempt: number;
}

/**
 * Pre-session student greeting (2026-09-07) — mirrors
 * `apps/desktop/src/main/cbHelpWindow.ts`'s own copy; see that file's doc
 * comment on `CbHelpGreeting`.
 */
export interface CbHelpGreeting {
  code: string;
  name: string;
  className: string;
  major: string;
  academicYear: string;
}

export interface CbHelpPublishState {
  running: boolean;
  /**
   * The window's own presentation mode (§3.5, 2026-09-05 second product
   * decision — captured photos stay visible after the shot); see
   * `packages/ui`'s copy of this type for what each value means.
   */
  phase: 'idle' | 'live' | 'review' | 'done';
  simultaneous: boolean;
  currentStepId: string | null;
  frames: CbHelpFrame[];
  greeting: CbHelpGreeting | null;
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
  /** Whether this campaign expects every frame captured with every mapped camera at once, rather than one at a time. */
  simultaneousCapture: boolean;
  /** Campaign-level switch for local video "stream" recording (§3.1) — off by default. */
  recordVideo: boolean;
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

  /**
   * Pillar B (recognition + attendance) wired for real — see
   * apps/desktop/src/main/attendance.ts's own doc comment for why this is
   * demo mode: `processAttendanceFrame` compares against a gallery that's
   * always empty while the embedding model is still the mock one.
   */
  attendanceEnroll: (payload: { displayName: string }) => Promise<{
    personId: string;
    profileId: string;
    profileStatus: string;
    modelFamily: string;
  }>;
  attendanceListPersons: () => Promise<Person[]>;
  attendanceProcessFrame: () => Promise<AttendanceResult>;
  attendanceResetSession: () => Promise<boolean>;

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
   * process. Only the highest-attempt row per step survives approval; the
   * rest are deleted as superseded (an earlier, retaken shot), not uploaded.
   * `steps` — stepType/cameraRole/capturedAt per stepId — lets the main
   * process enrich the SESSION_REPORT stats event this triggers; omit it and
   * the report still goes out with whatever the outbox itself knows. Safe to
   * call more than once for the same session; a repeat call finds nothing
   * left to approve and reports `approved: 0`.
   */
  approveSessionUpload: (payload: {
    sessionId: string;
    steps?: ApprovalStepInfo[];
    workflowId?: string;
    startedAt?: string;
    /**
     * The workflow engine's own session id (`CaptureSession.id`), which is
     * what local video recording is keyed on — a different id space than
     * `sessionId` above. Falls back to `sessionId` on the main-process side
     * when omitted; see `CaptureSink.approveUpload`'s own doc comment for
     * why the two ids exist at all.
     */
    videoSessionId?: string;
  }) => Promise<ApproveSessionUploadResult>;

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
   * Opens the CB Help window if closed, closes it if open — the same
   * action `Ctrl/Cmd+Shift+H` triggers. Used by the kiosk UI's "Màn hình mở
   * rộng" button; see cbHelpWindow.ts's own doc comment for what that
   * window now shows (only the capture frames, live + captured — not a
   * mirror of this main window).
   */
  toggleCbHelpWindow: () => Promise<{ open: boolean }>;

  /** Whether the CB Help window is currently open — used to sync the toggle button's state on mount. */
  isCbHelpWindowOpen: () => Promise<boolean>;

  /**
   * Publishes a fresh capture-frames snapshot for the CB Help window (§3.5)
   * — called from `FaceCaptureApp.tsx`'s `publishCbHelpState` on session
   * start, step change, every capture/retake, and on complete/cancel/
   * restart. A no-op-safe fire-and-forget from the caller's point of view;
   * the main process caches the latest snapshot regardless of whether a CB
   * Help window is currently open to receive it.
   */
  publishCbHelpState: (state: CbHelpPublishState) => Promise<boolean>;

  /**
   * Only meaningful from inside the CB Help window itself: hydrates on open
   * (or after a reload) with whatever the main kiosk window last published,
   * before the next `onCbHelpUpdate` push arrives.
   */
  getCbHelpState: () => Promise<CbHelpPublishState>;

  /**
   * Only meaningful from inside the CB Help window: subscribes to every
   * snapshot the main kiosk window publishes. Returns an unsubscribe
   * function.
   */
  onCbHelpUpdate: (callback: (state: CbHelpPublishState) => void) => () => void;

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

  /**
   * Deletes a session's recorded video, on disk and from `capture_streams`,
   * when the operator abandons the session instead of approving it — call
   * from `handleRestart`/`handleCancelWorkflow`. A video that already
   * reached `upload_outbox` (the session was approved) is untouched by this;
   * see `discardSessionVideos`'s own doc comment in `streams.ts`.
   */
  discardSessionVideos: (sessionId: string) => Promise<{ removed: number }>;

  /** Runtime camera role mapping (§2.1) — set from the camera setup screen. */
  getCameraRoleMapping: () => Promise<CameraRoleMapping>;
  setCameraRoleMapping: (mapping: CameraRoleMapping) => Promise<boolean>;

  /**
   * Opens the CB-Help camera setup window on demand — the same window
   * `Ctrl/Cmd+Shift+K` opens. Used by the capture UI when a
   * simultaneous-capture campaign (`CampaignConfig.simultaneousCapture`) has
   * frames without a mapped camera, so an operator can assign one without
   * knowing the shortcut.
   */
  openCameraSetup: () => Promise<boolean>;

  /**
   * Reports a stats-worthy moment (§3.4) — queued locally and pushed to the
   * admin portal on its own schedule. Never rejects; a failed/impossible
   * report must not interrupt the capture flow that triggered it.
   */
  recordStatsEvent: (payload: {
    type:
      | 'SESSION_COMPLETED'
      | 'UPLOAD_SUCCESS'
      | 'UPLOAD_FAILED'
      | 'RETAKE'
      | 'CB_HELP_INTERVENTION'
      | 'SESSION_REPORT'
      | 'PHOTO_STATUS'
      | 'VIDEO_STATUS';
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

  attendanceEnroll: (payload) => ipcRenderer.invoke('attendance:enroll', payload),
  attendanceListPersons: () => ipcRenderer.invoke('attendance:listPersons'),
  attendanceProcessFrame: () => ipcRenderer.invoke('attendance:processFrame'),
  attendanceResetSession: () => ipcRenderer.invoke('attendance:resetSession'),

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

  toggleCbHelpWindow: () => ipcRenderer.invoke('cbhelp:toggle'),
  isCbHelpWindowOpen: () => ipcRenderer.invoke('cbhelp:isOpen'),
  publishCbHelpState: (state) => ipcRenderer.invoke('cbhelp:publish', state),
  getCbHelpState: () => ipcRenderer.invoke('cbhelp:getState'),
  onCbHelpUpdate: (callback) => {
    const listener = (_: unknown, state: CbHelpPublishState) => callback(state);
    ipcRenderer.on('cbhelp:update', listener);
    return () => ipcRenderer.removeListener('cbhelp:update', listener);
  },

  startVideoStream: (payload) => ipcRenderer.invoke('stream:start', payload),
  endVideoStream: (payload) => ipcRenderer.invoke('stream:end', payload),
  discardSessionVideos: (sessionId) => ipcRenderer.invoke('stream:discardSession', sessionId),

  getCameraRoleMapping: () => ipcRenderer.invoke('camera:getRoleMapping'),
  setCameraRoleMapping: (mapping) => ipcRenderer.invoke('camera:setRoleMapping', mapping),
  openCameraSetup: () => ipcRenderer.invoke('camera:openSetup'),

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
