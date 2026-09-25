import { contextBridge, ipcRenderer } from 'electron';
import type { AttendanceResult, Person } from '@face/core';
import type { CapturedStudentItem } from '@face/database';

/** `listCampaignRecentCaptures`'s row shape — mirrors `RecentCaptureEntry` in `apps/desktop/src/main/deviceApi.ts` (duplicated rather than imported, same convention every other `faceAPI` payload type here follows). */
export interface CampaignRecentCaptureItem {
  id: string;
  deviceId?: string;
  deviceName?: string;
  subjectCode?: string;
  subjectName?: string;
  capturedAt?: string;
  completedAt?: string;
  photoCount: number;
  isThisDevice: boolean;
}

export interface ExportResult {
  success: boolean;
  exportPath?: string;
  fileCount?: number;
  error?: string;
}

/**
 * Tethered Canon mirroring (2026-09-24 — "lỗi lật khung hình camera
 * Canon"). Real webcam stills are pixel-mirrored at their own source
 * before ever reaching a display/save path (`BrowserCameraService.
 * setMirrorStills(true)`, extended everywhere by the 2026-09-17/18 product
 * decision — see `FrameTile.tsx`'s own doc comment on why the display
 * layer deliberately never re-mirrors via CSS, to avoid double-flipping an
 * already-mirrored still). The tethered Canon's raw gphoto2 bytes never
 * went through an equivalent step, so its preview/captured stills showed
 * true sensor orientation while every other camera in the same UI showed
 * mirrored — visually inconsistent and disorienting for a subject
 * positioning themselves from the preview.
 *
 * Fixed HERE, once, in preload — not in `tetheredCamera.ts` (main process,
 * no DOM/Canvas access, would need a new native image-processing
 * dependency like `sharp` with real Electron-ABI packaging risk this
 * avoids entirely) and not duplicated across the 4+ renderer call sites
 * that poll `getTetheredLiveViewFrame`/call `captureTetheredPhoto`
 * (`TetheredCameraPanel.tsx`, `FaceCaptureApp.tsx`, `CameraSetupScreen.tsx`,
 * `CbHelpFrames.tsx`) — wrapping the two bridge methods here means every
 * caller gets a mirrored `dataUrl` automatically, with zero changes
 * anywhere else. Critically, this also fixes the REAL saved/uploaded
 * photo, not just the live preview: `captureTetheredPhoto()`'s mirrored
 * `dataUrl` is exactly what `FaceCaptureApp.tsx`'s `captureTetheredFrame()`
 * hands to `WorkflowEngine.recordExternalCapture()`, the same value that
 * eventually gets uploaded — there is no separate "raw" path for the real
 * capture that this could miss. (`captureTetheredPhoto()`'s `savedPath` —
 * the main process's own debug copy written straight to Desktop for the
 * "Chụp thử" test button — is written BEFORE this wrapper runs and stays
 * unmirrored. As of the 2026-09-24 fix it is genuinely test-only: it is
 * only written when the caller passes `{ saveDebugCopy: true }`, which only
 * `TetheredCameraPanel.tsx`'s test button does — a real session capture no
 * longer leaves this copy on the Desktop.)
 *
 * Preload scripts run in the page's own DOM/JS realm even when sandboxed
 * (`sandbox: true` only restricts Node.js API access, not standard Web
 * APIs), so `Image`/`document.createElement('canvas')` are available here
 * exactly as they would be in any renderer file. Not verified against real
 * hardware — the Canon was not physically available at the time of this
 * fix (see chat) — verified instead via the SIMULATE-mode fixture image, by
 * eye, using the same code path.
 */
/**
 * 2026-09-24 fix (confirmed audit finding — Canon still can exceed the
 * server's photo size limit): the full-sensor Canon still (6000x4000 on the
 * R6 Mark II, per `tetheredCamera.ts`'s own doc comment) was re-encoded here
 * at its FULL resolution with no upper bound, while
 * `apps/api/.../capture.constants.ts`'s `MAX_PHOTO_BYTES` (12 MiB, sized for
 * ~1080p webcam stills) rejects anything larger with a permanent (non-
 * retried) upload failure — a detailed or high-ISO frame can plausibly cross
 * that line. Capping the long edge here bounds the re-encoded JPEG's size
 * deterministically regardless of the camera's real sensor resolution,
 * without needing real hardware measurements to pick a safe
 * `MAX_PHOTO_BYTES` value, and without touching that server constant (other
 * consumers of the same limit are out of scope for this fix). Applied ONLY
 * to the still-capture path (`captureTetheredPhoto`, via
 * `STILL_MAX_DIMENSION_PX` below) — the live-view poll
 * (`getTetheredLiveViewFrame`, also used by the tethered recording canvas)
 * is left at full resolution, since that path was not implicated in this
 * finding and downscaling it is unrelated to fixing the upload rejection.
 */
const STILL_MAX_DIMENSION_PX = 3000;

function mirrorDataUrlHorizontally(dataUrl: string, maxDimension?: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        const naturalWidth = img.naturalWidth;
        const naturalHeight = img.naturalHeight;
        const longEdge = Math.max(naturalWidth, naturalHeight);
        const scale = maxDimension && longEdge > maxDimension ? maxDimension / longEdge : 1;
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(naturalWidth * scale);
        canvas.height = Math.round(naturalHeight * scale);
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('mirrorDataUrlHorizontally: no 2d canvas context'));
          return;
        }
        ctx.translate(canvas.width, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const out = canvas.toDataURL('image/jpeg', 0.92);
        // Diagnostic (2026-09-25, "ảnh chụp đã lấy đủ và lưu chưa" field
        // question): only logged for the still-capture path (maxDimension
        // set — see STILL_MAX_DIMENSION_PX's call site), not the live-view
        // poll, so this doesn't spam devtools every ~200ms. Shows exactly
        // what left the kiosk for a real Canon shot: the camera's real
        // sensor dimensions/bytes in, and the resized/re-encoded
        // dimensions/bytes out — open DevTools (Ctrl+Shift+I) on the
        // capture screen and look for this line right after a Canon shot.
        if (maxDimension) {
          const outBytes = Math.ceil((out.length - out.indexOf(',') - 1) * 0.75);
          console.log(
            `[TetheredCapture] ${naturalWidth}x${naturalHeight} (~${Math.ceil((dataUrl.length - dataUrl.indexOf(',') - 1) * 0.75 / 1024)}KB) from camera -> ${canvas.width}x${canvas.height} (~${Math.ceil(outBytes / 1024)}KB) after resize/mirror`
          );
        }
        resolve(out);
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    };
    img.onerror = () => reject(new Error('mirrorDataUrlHorizontally: failed to decode image'));
    img.src = dataUrl;
  });
}

/** Applies `mirrorDataUrlHorizontally` to a `{ok, dataUrl, ...}` bridge result, falling back to the original (unmirrored) result on any mirroring failure — a display/orientation bug must never turn into "the camera stopped working" for the operator. */
async function withMirroredDataUrl<T extends { ok: true; dataUrl: string }>(
  result: T | { ok: false; error: string },
  maxDimension?: number
): Promise<T | { ok: false; error: string }> {
  if (!result.ok) return result;
  try {
    return { ...result, dataUrl: await mirrorDataUrlHorizontally(result.dataUrl, maxDimension) };
  } catch (err) {
    console.error('[preload] tethered frame mirroring failed, using unmirrored frame:', err);
    return result;
  }
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

// Widened 2026-09-09 (item 2, angle-related settings audit) to match
// `@face/core`'s real `CameraRole` — this used to omit UP/DOWN, which this
// file's callers never noticed only because every `faceAPI` call site casts
// through `(window as any).faceAPI`, but a type this narrow is misleading on
// its own and now backs `CameraPhysicalAngleMap` below, which needs all five.
export type CameraRole = 'CENTER' | 'LEFT' | 'RIGHT' | 'UP' | 'DOWN';
export type CameraRoleMapping = Partial<Record<CameraRole, string>>;
/** One logical camera role's physical mounting yaw/pitch, in degrees — mirrors `secrets.ts`'s `CameraPhysicalAngles`. */
export interface CameraPhysicalAngles {
  yaw: number;
  pitch: number;
}
export type CameraPhysicalAngleMap = Partial<Record<CameraRole, CameraPhysicalAngles>>;
/** One logical camera role's CB Help visibility/order — mirrors `secrets.ts`'s `CbHelpCameraVisibility`. */
export interface CbHelpCameraVisibility {
  visible: boolean;
  order: number;
}
export type CbHelpVisibilityMap = Partial<Record<CameraRole, CbHelpCameraVisibility>>;
/** Audio-calibration volumes (voice-prompt + alert/chime) — mirrors `secrets.ts`'s `AudioVolumeSettings`. Duplicated rather than imported, same convention as every other `faceAPI` payload type here. */
export interface AudioVolumeSettings {
  voicePct: number;
  alertPct: number;
}

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
  /**
   * Item 12b (2026-09-09): a periodic still of the main window's own live
   * CENTER camera, pushed a few times a second, so CbHelpFrames.tsx's CENTER
   * tile can render this instead of opening its own competing `getUserMedia`
   * for the same physical device the main window already has open — see
   * `packages/ui`'s copy of this type for the full field-bug reasoning.
   * `null`/absent outside `phase: 'live'` (or on a build/bridge with no
   * camera to snapshot).
   */
  centerPreviewDataUrl?: string | null;
  /**
   * CCCD-scan capture-identification (2026-09-09): set only for the brief
   * window between a scanned CCCD number failing to match the campaign
   * roster and the operator scanning again — mirrors `greeting`'s own
   * "presence, not `phase`, is what the renderer branches on" convention.
   * `null`/absent the rest of the time. See `packages/ui`'s copy of this
   * type for the full reasoning.
   */
  errorMessage?: string | null;
}

/**
 * CCCD-scan capture-identification (2026-09-09, corrected architecture) —
 * mirrors `apps/desktop/src/main/cccdRoster.ts`'s `RosterRecord`, the same
 * duplicate-the-IPC-payload-shape convention every other `faceAPI` type here
 * already follows. Every field but `identityNumber` is display-only/
 * best-effort — see that module's own doc comment.
 */
export interface CccdRosterRecord {
  identityNumber: string;
  userCode: string;
  studentCode: string | null;
  fullName: string | null;
  className: string | null;
  majorName: string | null;
  courseYear: string | null;
}

/** `cccd:lookupByIdentityNumber`'s result shape — `found: false` is a normal, expected outcome, never an error. */
export type CccdLookupResult = { found: true; record: CccdRosterRecord } | { found: false };

/** `campaign:lookupSubject`'s result shape — mirrors `apps/desktop/src/main/deviceApi.ts`'s `CampaignSubjectLookupResult`, same duplicate-the-IPC-payload-shape convention as `CccdRosterRecord` above. */
export interface CampaignSubjectLookupResult {
  eligible: boolean;
  reason?: string;
  subject?: {
    subjectCode: string;
    fullName: string;
    className?: string | null;
    faculty?: string | null;
    major?: string | null;
  } | null;
  externalRecord?: Record<string, unknown> | null;
}

export interface EmbeddingHealthResult {
  /** False when EMBEDDING_SERVER_BASE_URL is unset — a supported "feature off" state, not an error. */
  configured: boolean;
  ok: boolean;
  modelsLoaded: boolean;
}

export interface EnrolledFaceItem {
  id: number;
  sourceImagePath: string;
  createdAt: string;
}

export interface EmbeddingListFacesResult {
  ok: boolean;
  userCode?: string;
  count?: number;
  images?: EnrolledFaceItem[];
  error?: string;
}

export interface EmbeddingDeleteResult {
  ok: boolean;
  userCode?: string;
  deleted?: number;
  error?: string;
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
  /**
   * The specific 401 cause (secret rotated, revoked, campaign expired,
   * device gone) — see deviceApi.ts's DeviceAccessStatus.rejectReason for
   * why this exists (2026-09-08 "kiosk 3" incident). Duplicated here rather
   * than imported, on purpose, per this file's own existing pattern for
   * every other type it mirrors.
   */
  rejectReason?: 'INVALID_SECRET' | 'NOT_FOUND' | 'EXPIRED' | 'REVOKED' | 'UNKNOWN';
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
   * Health/admin side of the external "Attendance — Face Enrollment API"
   * (`EMBEDDING_SERVER_BASE_URL`), unrelated to the `attendance*` MOCK-model
   * methods above. `embeddingHealth` is a preflight (call before starting a
   * capture session, same idea as `getSystemStatus().aiServiceReachable` for
   * the Python sidecar). The remaining three are admin/audit operations
   * against the server's own registered-image list.
   *
   * 2026-09-16 — per-photo enrollment itself (`enrollFace`) moved to the
   * backend (`apps/api`'s `EmbeddingWorkerService`, enqueued the instant a
   * photo is saved server-side) and no longer has an IPC entry point here —
   * see `apps/desktop/src/main/embeddingEnroll.ts`'s own doc comment.
   */
  embeddingHealth: () => Promise<EmbeddingHealthResult>;
  listEnrolledFaces: (userCode: string) => Promise<EmbeddingListFacesResult>;
  deleteEnrolledFace: (payload: { userCode: string; embeddingId: number }) => Promise<EmbeddingDeleteResult>;
  deleteAllEnrolledFaces: (userCode: string) => Promise<EmbeddingDeleteResult>;

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
    /** The student this session belongs to, if the kiosk's ID-entry screen looked one up — see uploads.ts's SessionReportPayload.subjectCode doc comment. */
    subjectCode?: string;
    subjectName?: string;
    /** className/major/academicYear, when a subject was looked up — no dedicated column exists for these, they ride along as free-form metadata. */
    metadata?: Record<string, unknown>;
    /** See uploads.ts's SessionReportPayload.operatorUserId doc comment. */
    operatorUserId?: string;
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
   * This kiosk's stable fingerprint + hostname, for the renderer's own
   * `POST /v1/devices/self-enroll` call (needs the operator's SSO token,
   * which only the renderer holds).
   */
  getDeviceFingerprintInfo: () => Promise<{ fingerprint: string; hostname: string }>;

  /** Persists a self-enroll result — see `secrets.ts`'s `storeSelfEnrolledDevice` doc comment. */
  storeSelfEnrolledDevice: (payload: {
    deviceId: string;
    deviceSecret: string;
    campaignId: string | null;
    apiBaseUrl: string;
  }) => Promise<{ ok: boolean }>;

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
   * The kiosk's own embedded CCCD-scan corner (`CccdScanWaitingScreen.tsx`'s
   * `ScanMonitorCorner`) asking whether a freshly, stably OCR'd citizen id
   * matches anyone in the external student roster — see
   * `cccd:lookupByIdentityNumber`'s own doc comment in `index.ts`. Only ever
   * called after the corner's own stability gate has confirmed the same
   * 12-digit read several times in a row (see that component's doc
   * comment) — never a single-frame guess. Replaces the earlier same-day
   * `writeCccdScanResult`, which wrote the OCR result to `response.json` on
   * the wrong assumption that file was a per-scan write target — this app
   * never writes to that path.
   */
  lookupCccdByIdentityNumber: (payload: { identityNumber: string }) => Promise<CccdLookupResult>;

  /**
   * The kiosk's real, campaign-scoped eligibility check for a student code —
   * see `campaign:lookupSubject`'s own doc comment in `index.ts` and
   * `lookupCampaignSubject`'s in `deviceApi.ts`. Called from both
   * `StudentIdEntryScreen`'s manual "nhập mã sinh viên" field (via
   * `packages/ui`'s `lookupStudent()`) and, as of 2026-09-18, a bare
   * (non-CCCD) QR scan through the same `onManualSubmit` path — see
   * `CccdScanWaitingScreen.tsx`'s `ScanMonitorCorner`'s own
   * `onStudentCodeScan` doc comment. Rejects on failure (network, no device
   * identity, non-2xx) — unlike `lookupCccdByIdentityNumber`, there is no
   * `{found: false}` success shape here; `eligible: false` on the resolved
   * value is the "not eligible" outcome instead.
   */
  lookupCampaignSubject: (payload: { campaignId: string; key: string }) => Promise<CampaignSubjectLookupResult>;

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

  // No push-based `onCccdScan` subscription anymore — the earlier same-day
  // version assumed the external file was a per-scan write target and
  // pushed each "new scan" main -> renderer. The corrected model is
  // request/response only (`lookupCccdByIdentityNumber` above), called
  // directly by `ScanMonitorCorner` once its own OCR stability gate fires.

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
   * Fires whenever the camera setup screen saves a new role mapping (D3,
   * plan item 9, 2026-09-21) — same "live-update the already-open main
   * window" shape as `onCbHelpVisibilityChanged` above.
   * `FaceCaptureApp.tsx`'s `cameraRoleMapping` state used to be fetched
   * ONCE at mount with no way to hear about a later change short of
   * restarting the whole app: an operator who opened Camera Setup, swapped
   * a camera, saved, and went straight back to the capture screen (no
   * restart) kept shooting on the stale mapping — confirmed live as the
   * root cause of item 9's "displays wrong after swap" in sequential mode,
   * and a contributing cause of item 8 (a freshly-assigned side camera not
   * appearing until restart). Returns an unsubscribe function, same shape
   * as `onCbHelpVisibilityChanged`.
   */
  onCameraRoleMappingChanged: (callback: (mapping: CameraRoleMapping) => void) => () => void;

  /**
   * 2026-09-23 real-hardware feedback ("camera được kết nối đang không
   * hiển thị") — root cause found in the renderer console log: the Camera
   * Setup popup's own preview `getUserMedia` call was failing with
   * `NotReadableError: Device in use`, because the MAIN window's own
   * `CampaignGate` device-init preview was ALREADY holding that exact
   * physical camera open (most UVC webcam drivers allow only one reader at
   * a time — the same limitation `CampaignGate.tsx`'s own per-device-not-
   * per-role dedup comment documents). Fired by `cameraSetupWindow.ts`
   * right before/after that popup opens/closes, so the main window can
   * release its own preview streams while the popup needs exclusive access,
   * then reopen them afterward.
   */
  onCameraPauseForSetup: (callback: () => void) => () => void;
  onCameraResumeAfterSetup: (callback: () => void) => () => void;

  /** Per-role physical camera mounting angle (§3.9) — set from the camera setup screen, read by round planning. */
  getCameraPhysicalAngles: () => Promise<CameraPhysicalAngleMap>;
  setCameraPhysicalAngles: (angles: CameraPhysicalAngleMap) => Promise<boolean>;

  /**
   * Opens the CB-Help camera setup window on demand — the same window
   * `Ctrl/Cmd+Shift+K` opens. Used by the capture UI when a
   * simultaneous-capture campaign (`CampaignConfig.simultaneousCapture`) has
   * frames without a mapped camera, so an operator can assign one without
   * knowing the shortcut.
   */
  openCameraSetup: () => Promise<boolean>;

  /**
   * Tethered Canon (gphoto2) — docs/plans/canon-tethered-capture-plan-2026-09-21.md
   * Bước 1/4. `getTetheredCameraStatus` detects whether a camera is
   * connected/reachable; `captureTetheredPhoto`/`getTetheredLiveViewFrame`
   * return a `data:image/jpeg;base64,...` URL on success (usable directly
   * as an `<img src>`), matching how a webcam snapshot already crosses this
   * same boundary elsewhere in this app.
   */
  getTetheredCameraStatus: () => Promise<{ connected: boolean; model?: string; error?: string }>;
  /**
   * `saveDebugCopy` (2026-09-24 fix, confirmed audit finding): this same
   * bridge method is called both by the Camera Setup "Chụp thử" test button
   * (`TetheredCameraPanel.tsx`) AND by every REAL session capture
   * (`FaceCaptureApp.tsx`'s `captureTetheredFrame()`) — the main process used
   * to write Bước 0's "chụp và lưu lại" Desktop debug copy unconditionally,
   * so every real student's Canon photo was ALSO left, full-resolution and
   * unencrypted, in `~/Desktop/Looka-tethered-test-captures/`, forever (never
   * cleaned up), despite being commented "test-only scope". Only the test
   * panel now opts into that debug copy; `savedPath` is only present when it
   * did.
   */
  captureTetheredPhoto: (
    opts?: { saveDebugCopy?: boolean }
  ) => Promise<{ ok: true; dataUrl: string; savedPath?: string } | { ok: false; error: string }>;
  getTetheredLiveViewFrame: () => Promise<{ ok: true; dataUrl: string } | { ok: false; error: string }>;
  /** Opens the bundled Zadig for the one-time WinUSB driver step — no scriptable Zadig interface exists, this can only open it (2026-09-22). */
  openTetheredCameraZadig: () => Promise<{ ok: boolean; error?: string }>;

  /**
   * Config discovery + thermal-warning polling (2026-09-23 — "có thể lấy
   * được nhiệt độ cam để cảnh báo lên màn hình khi cam quá tải không?").
   * `listTetheredCameraConfig`/`getTetheredCameraConfigValue` are generic
   * `gphoto2 --list-config`/`--get-config` wrappers for finding whatever
   * this camera actually exposes; `getTetheredThermalWarning` is a no-op
   * (`enabled: false`) until `TETHERED_TEMP_CONFIG_PATH` is set to a real
   * discovered path — see `tetheredCamera.ts`'s own doc comments.
   */
  listTetheredCameraConfig: () => Promise<{ ok: true; paths: string[] } | { ok: false; error: string }>;
  getTetheredCameraConfigValue: (configPath: string) => Promise<{ ok: true; value: string } | { ok: false; error: string }>;
  setTetheredCameraConfigValue: (configPath: string, value: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  getTetheredThermalWarning: () => Promise<{ enabled: boolean; warning: boolean; raw?: string; error?: string }>;
  getTetheredBatteryLevel: () => Promise<{ enabled: boolean; percent?: number; raw?: string; error?: string }>;

  /**
   * Auto-detect watcher (docs/plans/canon-auto-detect-polling-plan-2026-09-24.md)
   * — `onTetheredConnectionChanged` fires only when the connected/model
   * state actually changes (not on every background poll tick), same shape
   * as `onCameraRoleMappingChanged` below. `setTetheredCameraSessionActive`
   * lets the renderer tell the watcher to pause while a real capture
   * session is running, so its background `detectTetheredCamera()` polling
   * doesn't compete with `withCameraLock` for the shared gphoto2 session.
   */
  onTetheredConnectionChanged: (
    callback: (status: { connected: boolean; model?: string; error?: string }) => void
  ) => () => void;
  setTetheredCameraSessionActive: (active: boolean) => Promise<boolean>;

  /** "Cách chụp" — Tuần tự/Đồng thời, a kiosk-local setting (§3.9). */
  getCaptureSequencing: () => Promise<'sequential' | 'simultaneous'>;
  setCaptureSequencing: (value: 'sequential' | 'simultaneous') => Promise<boolean>;

  /** Which camera roles show on CB Help and in what order (2026-09-10) — unset roles default to CENTER-only, see `secrets.ts`'s `resolveCbHelpVisibility`. */
  getCbHelpVisibility: () => Promise<CbHelpVisibilityMap>;
  setCbHelpVisibility: (map: CbHelpVisibilityMap) => Promise<boolean>;

  /**
   * Only meaningful from inside the MAIN kiosk window: fires whenever
   * `setCbHelpVisibility` is called from anywhere (in practice, the separate
   * Camera Setup popup window, `Ctrl/Cmd+Shift+K`) — 2026-09-15 field
   * report: an operator changing "Hiện camera này"/"Thứ tự hiển thị" while
   * the kiosk's own window was already running had no way to find out, so
   * `FaceCaptureApp.tsx`'s `cbHelpVisibilityRef` (loaded once, on mount)
   * kept using the stale value until the whole app was restarted. Returns
   * an unsubscribe function, same shape as `onCbHelpUpdate`.
   */
  onCbHelpVisibilityChanged: (callback: (map: CbHelpVisibilityMap) => void) => () => void;

  /** "Lưới 3x3" — always 3 tiles/row in the multi-camera capture grid, a kiosk-local setting (2026-09-10). */
  getGrid3x3Enabled: () => Promise<boolean>;
  setGrid3x3Enabled: (value: boolean) => Promise<boolean>;

  /** Audio-calibration volumes ("Hệ thống âm thanh & loa thông báo", camera setup screen) — voice-prompt volume + alert/chime volume, kiosk-local. */
  getAudioVolume: () => Promise<AudioVolumeSettings>;
  setAudioVolume: (value: AudioVolumeSettings) => Promise<boolean>;

  /**
   * Real Microsoft 365 SSO login — opens `ssoLogin.ts`'s `BrowserWindow` and
   * resolves with the tokens LOGIN.md §3.3 hands back, or `null` if the
   * operator closed the window without finishing. See
   * `apps/desktop/src/renderer/ssoAuthClient.ts` for the `AuthClient` this
   * backs.
   */
  ssoLogin: () => Promise<{ accessToken: string; refreshToken: string; email: string; userCode: string } | null>;

  /**
   * Local "sinh viên đã chụp" index (2026-09-08) — only meaningful from
   * inside the kiosk's own hidden `#recent-students` window (`Ctrl/Cmd+Shift+S`,
   * see `recentStudentsWindow.ts`). Reads local SQLite only, so these work
   * fully offline; see `CapturedStudentRepository`'s own doc comment.
   */
  listRecentStudents: (limit?: number) => Promise<CapturedStudentItem[]>;
  listStudentSessions: (subjectCode: string) => Promise<CapturedStudentItem[]>;
  searchStudents: (query: string) => Promise<CapturedStudentItem[]>;
  /**
   * Item 11 ("chụp lại ghi đè ảnh cũ", 2026-09-21) — `null` when this
   * subject has no prior local approval; otherwise the most recent prior
   * session id to `RunScopedCaptureSession.resume()` into, plus the
   * per-step attempt high-water mark that resume must add as an offset so
   * the new run's captures never collide with the old ones' idempotency
   * keys. See `capture:getRetakeContext`'s own doc comment in
   * `main/index.ts` for the full reasoning.
   */
  getRetakeContext: (
    subjectCode: string,
  ) => Promise<{ sessionId: string; attemptOffsets: Record<string, number> } | null>;
  /**
   * "Cả campaign khi online" (plan item 13, 2026-09-17) — recent completed
   * sessions across every kiosk in this device's campaign, from the server
   * (`GET /v1/devices/recent-captures`). Resolves `null` on any failure (no
   * device identity, offline, rejected) so the caller can fall back to
   * `listRecentStudents` above (this device's own local SQLite index).
   */
  listCampaignRecentCaptures: (limit?: number) => Promise<CampaignRecentCaptureItem[] | null>;

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
      | 'VIDEO_STATUS'
      | 'ATTEMPT_SUPERSEDED';
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

  embeddingHealth: () => ipcRenderer.invoke('embedding:health'),
  listEnrolledFaces: (userCode) => ipcRenderer.invoke('embedding:listFaces', userCode),
  deleteEnrolledFace: (payload) => ipcRenderer.invoke('embedding:deleteFace', payload),
  deleteAllEnrolledFaces: (userCode) => ipcRenderer.invoke('embedding:deleteAllFaces', userCode),

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
  getDeviceFingerprintInfo: () => ipcRenderer.invoke('device:getFingerprintInfo'),
  storeSelfEnrolledDevice: (payload) => ipcRenderer.invoke('device:storeSelfEnrolled', payload),

  toggleCbHelpWindow: () => ipcRenderer.invoke('cbhelp:toggle'),
  lookupCccdByIdentityNumber: (payload) => ipcRenderer.invoke('cccd:lookupByIdentityNumber', payload),
  lookupCampaignSubject: (payload) => ipcRenderer.invoke('campaign:lookupSubject', payload),
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
  onCameraRoleMappingChanged: (callback) => {
    const listener = (_: unknown, mapping: CameraRoleMapping) => callback(mapping);
    ipcRenderer.on('camera:roleMappingChanged', listener);
    return () => ipcRenderer.removeListener('camera:roleMappingChanged', listener);
  },
  onCameraPauseForSetup: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('camera:pauseForSetup', listener);
    return () => ipcRenderer.removeListener('camera:pauseForSetup', listener);
  },
  onCameraResumeAfterSetup: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('camera:resumeAfterSetup', listener);
    return () => ipcRenderer.removeListener('camera:resumeAfterSetup', listener);
  },
  getCameraPhysicalAngles: () => ipcRenderer.invoke('camera:getPhysicalAngles'),
  setCameraPhysicalAngles: (angles) => ipcRenderer.invoke('camera:setPhysicalAngles', angles),
  openCameraSetup: () => ipcRenderer.invoke('camera:openSetup'),
  getTetheredCameraStatus: () => ipcRenderer.invoke('tetheredCamera:status'),
  captureTetheredPhoto: async (opts) =>
    withMirroredDataUrl(await ipcRenderer.invoke('tetheredCamera:capture', opts), STILL_MAX_DIMENSION_PX),
  getTetheredLiveViewFrame: async () => withMirroredDataUrl(await ipcRenderer.invoke('tetheredCamera:getLiveViewFrame')),
  openTetheredCameraZadig: () => ipcRenderer.invoke('tetheredCamera:openZadig'),
  listTetheredCameraConfig: () => ipcRenderer.invoke('tetheredCamera:listConfig'),
  getTetheredCameraConfigValue: (configPath: string) => ipcRenderer.invoke('tetheredCamera:getConfigValue', configPath),
  setTetheredCameraConfigValue: (configPath: string, value: string) =>
    ipcRenderer.invoke('tetheredCamera:setConfigValue', configPath, value),
  getTetheredThermalWarning: () => ipcRenderer.invoke('tetheredCamera:getThermalWarning'),
  getTetheredBatteryLevel: () => ipcRenderer.invoke('tetheredCamera:getBatteryLevel'),
  onTetheredConnectionChanged: (callback) => {
    const listener = (_: unknown, status: { connected: boolean; model?: string; error?: string }) => callback(status);
    ipcRenderer.on('tetheredCamera:connectionChanged', listener);
    return () => ipcRenderer.removeListener('tetheredCamera:connectionChanged', listener);
  },
  setTetheredCameraSessionActive: (active) => ipcRenderer.invoke('tetheredCameraWatcher:setSessionActive', active),
  getCaptureSequencing: () => ipcRenderer.invoke('capture:getSequencing'),
  setCaptureSequencing: (value) => ipcRenderer.invoke('capture:setSequencing', value),
  getCbHelpVisibility: () => ipcRenderer.invoke('camera:getCbHelpVisibility'),
  setCbHelpVisibility: (map) => ipcRenderer.invoke('camera:setCbHelpVisibility', map),
  onCbHelpVisibilityChanged: (callback) => {
    const listener = (_: unknown, map: CbHelpVisibilityMap) => callback(map);
    ipcRenderer.on('camera:cbHelpVisibilityChanged', listener);
    return () => ipcRenderer.removeListener('camera:cbHelpVisibilityChanged', listener);
  },
  getGrid3x3Enabled: () => ipcRenderer.invoke('display:getGrid3x3Enabled'),
  setGrid3x3Enabled: (value) => ipcRenderer.invoke('display:setGrid3x3Enabled', value),

  getAudioVolume: () => ipcRenderer.invoke('audio:getVolume'),
  setAudioVolume: (value) => ipcRenderer.invoke('audio:setVolume', value),

  ssoLogin: () => ipcRenderer.invoke('auth:ssoLogin'),

  listRecentStudents: (limit) => ipcRenderer.invoke('students:listRecent', limit),
  listCampaignRecentCaptures: (limit) => ipcRenderer.invoke('students:listCampaignRecent', limit),
  listStudentSessions: (subjectCode) => ipcRenderer.invoke('students:listSessions', subjectCode),
  searchStudents: (query) => ipcRenderer.invoke('students:search', query),
  getRetakeContext: (subjectCode) => ipcRenderer.invoke('capture:getRetakeContext', subjectCode),

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
