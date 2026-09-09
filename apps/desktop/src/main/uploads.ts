import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { Visibility } from '@face/core';
import {
  FsClient,
  FsError,
  FS_ERROR_CODES,
  UploadWorker,
  WorkerEvent,
  deterministicUuid,
  sha256Hex,
} from '@face/fs-client';
import type { FsFileInfo, UploadInput, UploadResult } from '@face/fs-client';
import { UploadOutboxRepository, CaptureStreamRepository, CapturedStudentRepository, nextRetryDelayMs } from '@face/database';
import type { OutboxItem, OutboxStatus, CaptureStreamItem } from '@face/database';
import { getDatabase } from './db.js';
import { recordStatsEvent } from './statsEvents.js';
import { DeviceApiClient } from './deviceApi.js';

/**
 * Recovers `(sessionId, stepId, attempt)` from an idem_key of the shape
 * `<sessionId>:<stepId>:<attempt>:<kind>` — `queueCapture()` below is the
 * only writer of this shape, and `@face/database`'s own
 * `UploadOutboxRepository` already relies on the identical parse (see its
 * `stepIdFromIdemKey`/`attemptFromIdemKey`, whose own doc comment explains
 * why none of the other parts can contain the ':' this splits on). Used by
 * `ApiPhotoUploadClient` below, which only ever sees the `UploadInput` the
 * generic `UploadWorker` builds — not the full outbox row — so this is the
 * one place it can recover the identity fields `POST /v1/devices/photos`
 * needs.
 */
function parsePhotoIdemKey(
  idemKey: string
): { sessionId: string; stepId: string; attempt: number } | null {
  const parts = idemKey.split(':');
  if (parts.length < 4) return null;
  const sessionId = parts[0];
  const stepId = parts.slice(1, parts.length - 2).join(':');
  const attempt = Number(parts[parts.length - 2]);
  if (!sessionId || !stepId || !Number.isFinite(attempt)) return null;
  return { sessionId, stepId, attempt };
}

/** Marks an `FsFileInfo.fileId` as one `ApiPhotoUploadClient` issued itself, never a real fs-core id — see that class's `getFile` override. */
const LOCAL_FILE_ID_PREFIX = 'local:';

/**
 * Drop-in `FsClient` substitute for `UploadWorker` (Part A of the "route
 * kiosk photo uploads through apps/api" work) — routes anything that is NOT
 * a video capture to apps/api's own `POST /v1/devices/photos` instead of
 * fs-core directly, so a kiosk-captured photo is durable and viewable from
 * apps/api's own Postgres the instant it is captured, matching the web
 * path's `PhotoService.addPhoto` guarantee. Video is deliberately untouched
 * — this task is scoped to "kiosk PHOTO uploads" — and keeps going straight
 * to fs-core via the ordinary inherited `FsClient` behaviour.
 *
 * `UploadWorker` only ever calls `uploadRaw`/`upload`/`getFile`
 * (packages/fs-client/src/UploadWorker.ts) — `deleteFile`/`cancelUpload`
 * fire from other call sites in this file, both already best-effort/
 * swallowed-on-error, so they are left un-overridden; a `local:`-prefixed
 * id landing there is a harmless no-op-ish failure, not a correctness
 * issue (see this class's own note in the codebase's task notes for the
 * one narrow, pre-existing edge case this does NOT close: a photo
 * superseded — "chụp lại sau khi đã lưu" — after apps/api's own upload
 * worker has already pushed it to fs-core has no client-side
 * `deleteFile()` call left to clean up the orphaned fs-core copy; a
 * server-side fix in `CaptureReportService.applyAttemptSuperseded` is a
 * follow-up, not done here).
 *
 * Video/photo routing reads `input.virtualPath`'s own `<kind>/...` prefix
 * (`queueCapture()`/`enqueueSessionVideos()` both build it that way) rather
 * than a new field threaded through `UploadInput` — `packages/fs-client`
 * and `packages/database` are untouched by this change entirely; this is
 * purely a routing decision made from data already flowing through the
 * existing local queue.
 */
class ApiPhotoUploadClient extends FsClient {
  constructor(
    fsConfig: { baseUrl: string; apiKey: string },
    private readonly deviceClient: DeviceApiClient
  ) {
    super(fsConfig);
  }

  async uploadRaw(input: UploadInput): Promise<UploadResult> {
    return this.routeUpload(input);
  }

  async upload(input: UploadInput): Promise<UploadResult> {
    return this.routeUpload(input);
  }

  private async routeUpload(input: UploadInput): Promise<UploadResult> {
    if (input.virtualPath.startsWith('video/')) {
      // Untouched — straight to fs-core, exactly as before this change.
      return super.upload(input);
    }

    const parsed = parsePhotoIdemKey(input.idempotencyKey);
    if (!parsed) {
      throw new FsError(
        0,
        FS_ERROR_CODES.HTTP,
        `Cannot route photo upload: idempotencyKey "${input.idempotencyKey}" is not in the expected sessionId:stepId:attempt:kind shape`
      );
    }

    // Deterministic from idemKey — the exact same id queueCapture() already
    // derived for this job (`deterministicUuid(idemKey)`), and the same id
    // SESSION_REPORT/PHOTO_STATUS report this photo under - see
    // PhotoService.addDevicePhoto's own doc comment for why keeping one id
    // across the whole lifecycle matters.
    const photoId = deterministicUuid(input.idempotencyKey);
    const dataUrl = `data:${input.mimeType};base64,${Buffer.from(input.data).toString('base64')}`;

    await this.deviceClient.pushDevicePhoto({
      photoId,
      sessionId: parsed.sessionId,
      stepId: parsed.stepId,
      attempt: parsed.attempt,
      dataUrl,
    });

    // apps/api accepting this POST is the durability guarantee this whole
    // change exists for - bytes are safely in its own Postgres even before
    // fs-core has them (see the class doc comment). `fileId` is prefixed so
    // `getFile()` below can recognise it, statelessly, even after a process
    // restart - see LOCAL_FILE_ID_PREFIX's own comment.
    return {
      fileId: `${LOCAL_FILE_ID_PREFIX}${photoId}`,
      virtualPath: input.virtualPath,
      status: 'READY',
      size: input.data.byteLength,
      etag: '',
      version: 1,
      dedupHit: false,
      visibility: input.visibility ?? 'private',
    };
  }

  async getFile(fileId: string): Promise<FsFileInfo> {
    if (fileId.startsWith(LOCAL_FILE_ID_PREFIX)) {
      // Stateless by design (works across a process restart mid-poll,
      // unlike an in-memory "did I just upload this" set would) - see the
      // class doc comment.
      return { fileId, virtualPath: '', status: 'READY', size: 0 };
    }
    return super.getFile(fileId);
  }
}

/** Reads captures from local disk for the worker. */
const diskReader = {
  read: async (localPath: string): Promise<Uint8Array> => fs.promises.readFile(localPath),
};

/**
 * sha256 of a file already on disk, streamed rather than read whole into
 * memory — used only for video (packages/ui's `sha256Hex` variant works on
 * bytes already in memory, which is how photos are hashed at capture time,
 * but a video's bytes are not held in memory by the time its session is
 * approved).
 */
function sha256HexOfFile(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    fs.createReadStream(filePath)
      .on('error', reject)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')));
  });
}

export interface UploadsConfig {
  baseUrl: string;
  apiKey: string;
  /** Prefix inside the app namespace, e.g. 'kioskA1'. */
  pathPrefix?: string;
}

let worker: UploadWorker | null = null;
let outbox: UploadOutboxRepository | null = null;
let client: FsClient | null = null;
const recentEvents: WorkerEvent[] = [];

/** Where captures live until the server confirms it has them. */
export function capturesDir(): string {
  return path.join(app.getPath('userData'), 'captures');
}

/**
 * Start background uploading.
 *
 * Returns false when no server is configured — the kiosk still captures and
 * queues; nothing about taking photos depends on the network being present.
 */
export function startUploads(config: UploadsConfig | null): boolean {
  if (!config?.baseUrl || !config.apiKey) return false;

  outbox = new UploadOutboxRepository(getDatabase());
  // Read-only lookup for emitVideoStatus() below — item.stepId is a
  // capture_streams.id (see enqueueSessionVideos()'s own doc comment), so
  // this is how cameraRole/durationMs get into the VIDEO_STATUS event
  // without duplicating them into the outbox row's own metadata (which is
  // sent to the file-service verbatim — see EnqueueInput.metadata's doc
  // comment — and these two fields have no business being there).
  const streamsForStatus = new CaptureStreamRepository(getDatabase());
  // Part A ("route kiosk photo uploads through apps/api"): anything that
  // isn't a video now goes to apps/api's own POST /v1/devices/photos
  // instead of fs-core directly — see ApiPhotoUploadClient's own doc
  // comment for the routing rule and why video is unaffected.
  client = new ApiPhotoUploadClient(
    { baseUrl: config.baseUrl, apiKey: config.apiKey },
    new DeviceApiClient()
  );

  // PHOTO_STATUS is no longer emitted from here (see the 'uploaded'/'ready'/
  // 'failed'/'quarantined' branches below) — now that a photo's bytes go
  // straight into apps/api's own Postgres via ApiPhotoUploadClient, its
  // `fs_file_id`/`fs_status` are tracked authoritatively by apps/api's own
  // UploadWorkerService (the same cron that already drains the web path's
  // outbox) the instant it uploads to fs-core itself — a kiosk-reported
  // PHOTO_STATUS would at best be redundant with that and at worst carry
  // this class's own placeholder `local:`-prefixed fileId, which must never
  // reach `photos.fs_file_id` (see PhotoService.resolveViewSource, which
  // treats any non-null fs_file_id as a real fs-core file to link to).
  // VIDEO_STATUS (below) is untouched: video still uploads straight to
  // fs-core, so the kiosk is still the only place that observes its real
  // fs_file_id/fs_status.

  // Mirrors the old emitPhotoStatus() on its own DeviceEventType
  // (VIDEO_STATUS) so
  // the API/CMS side can tell video rows from photo rows without inspecting
  // metadata shape — see CaptureReportService.applyVideoStatus(). stepId
  // here is capture_streams.id (see enqueueSessionVideos() below): video has
  // no retake concept, so "the recording" and "the step" are the same thing.
  const emitVideoStatus = (jobId: string, error: string | null = null) => {
    const item = outbox?.getById(jobId);
    if (!item) return;
    const stream = item.stepId ? streamsForStatus.getById(item.stepId) : null;
    recordStatsEvent('VIDEO_STATUS', {
      sessionId: item.sessionId,
      videoId: item.id,
      at: new Date().toISOString(),
      localStatus: item.status,
      fsFileId: item.fsFileId,
      fsStatus: item.fsStatus,
      error: error ?? item.lastError,
      mimeType: item.mimeType,
      sizeBytes: item.sizeBytes,
      sha256: item.sha256,
      virtualPath: item.virtualPath,
      cameraRole: stream?.cameraId ?? null,
      durationMs: stream?.durationMs ?? null,
    });
  };

  // Video-only (plan §3): once the server confirms the file is scanned and
  // READY, the local copy has served its purpose (recover-on-crash before
  // that point). Best-effort — a failed unlink is logged, never thrown; a
  // leftover video file is a disk-space nag, not a correctness problem, and
  // must not stop the VIDEO_STATUS report from going out. Photos are never
  // auto-deleted this way; that behaviour is unchanged.
  const deleteLocalVideo = (jobId: string) => {
    const item = outbox?.getById(jobId);
    if (!item) return;
    try {
      fs.unlinkSync(item.localPath);
    } catch (err) {
      console.warn(`[uploads] failed to remove local video ${item.localPath}:`, (err as Error).message);
    }
  };

  worker = new UploadWorker({
    client,
    outbox,
    files: diskReader,
    backoff: nextRetryDelayMs,
    onEvent: (event) => {
      recentEvents.push(event);
      if (recentEvents.length > 200) recentEvents.shift();
      if (event.type === 'failed' || event.type === 'quarantined') {
        console.warn('[uploads]', event);
      }
      // 'recovered' carries no jobId — nothing below applies to it.
      if (event.type === 'recovered') return;

      // VIDEO_STATUS only — see the comment above emitVideoStatus's
      // definition for why a photo job no longer reports its own status
      // from here at all (Part A: apps/api's own UploadWorkerService is now
      // the authoritative observer of a photo's fs_file_id/fs_status).
      const isVideo = outbox?.getById(event.jobId)?.kind === 'video';

      // Stats events (§3.4) only on a *final* outcome, not every transient
      // retry attempt: 'uploaded' is bytes actually accepted by the upload
      // target (fs-core for video, apps/api for a photo — see
      // ApiPhotoUploadClient); 'quarantined'/'failed' are permanent
      // rejections (D6 in phase-11's plan — 'failed' used to be silent
      // here, undercounting real upload failures such as a quota or a 4xx
      // that is never retried). 'retry' is operational noise the retry loop
      // already handles on its own and would wildly over-count if treated
      // as a stats-facing signal. UPLOAD_SUCCESS/UPLOAD_FAILED counters
      // still fire for both photo and video jobs — unlike PHOTO_STATUS,
      // these carry no fs-core-specific identifier, so they stay accurate
      // regardless of which target actually received the bytes.
      if (event.type === 'uploaded') {
        recordStatsEvent('UPLOAD_SUCCESS', { jobId: event.jobId });
        if (isVideo) emitVideoStatus(event.jobId);
      }
      if (event.type === 'ready') {
        if (isVideo) {
          emitVideoStatus(event.jobId);
          deleteLocalVideo(event.jobId);
        }
      }
      if (event.type === 'failed') {
        recordStatsEvent('UPLOAD_FAILED', { jobId: event.jobId });
        if (isVideo) emitVideoStatus(event.jobId, event.error);
      }
      if (event.type === 'quarantined') {
        recordStatsEvent('UPLOAD_FAILED', { jobId: event.jobId });
        if (isVideo) emitVideoStatus(event.jobId);
      }
    },
  });

  worker.start();
  return true;
}

export function stopUploads(): void {
  worker?.stop();
  worker = null;
}

export interface QueueCaptureInput {
  sessionId: string;
  /** 'raw' for a full-resolution capture, or a derived artefact name. */
  kind: string;
  stepId: string;
  attempt: number;
  /** Raw image bytes, already decoded from whatever the renderer sent. */
  data: Uint8Array;
  mimeType?: string;
  metadata?: Record<string, string>;
  /** Upload this only after the referenced job finishes. */
  dependsOn?: string;
  /**
   * public or private — decided by the caller, which knows what this capture
   * is (a card photo, a face image, or something else). Omitted means the
   * file-service applies its own default; nothing here substitutes one.
   */
  visibility?: Visibility;
}

/**
 * Persist a capture and queue it for upload, atomically.
 *
 * The file lands on disk and the queue row is committed in one transaction, so
 * a power cut costs at most the frame still in memory — never a photo that
 * exists on disk but that nothing will ever send.
 *
 * Returns the queue job id, which is stable for a given capture: calling twice
 * for the same shot is a no-op rather than a duplicate upload.
 */
export function queueCapture(input: QueueCaptureInput): string {
  const db = getDatabase();
  const repo = outbox ?? new UploadOutboxRepository(db);

  const idemKey = `${input.sessionId}:${input.stepId}:${input.attempt}:${input.kind}`;
  const jobId = deterministicUuid(idemKey);
  const year = new Date().getFullYear();
  const ext = (input.mimeType ?? 'image/jpeg').includes('png') ? 'png' : 'jpg';

  const dir = path.join(capturesDir(), input.sessionId);
  fs.mkdirSync(dir, { recursive: true });
  const localPath = path.join(dir, `${input.kind}-${input.stepId}-${input.attempt}.${ext}`);

  db.transaction(() => {
    // Written inside the transaction so a rollback cannot leave a file that no
    // queue row refers to.
    fs.writeFileSync(localPath, input.data);

    repo.enqueue({
      id: jobId,
      sessionId: input.sessionId,
      kind: input.kind,
      localPath,
      virtualPath: `${input.kind}/${year}/${input.sessionId}/${input.stepId}-${input.attempt}.${ext}`,
      mimeType: input.mimeType ?? 'image/jpeg',
      sha256: sha256Hex(input.data),
      sizeBytes: input.data.byteLength,
      // Only non-identifying context. Names and codes stay in the local
      // database; file metadata is readable by anyone who can read the file.
      metadata: input.metadata,
      idemKey,
      uploadId: deterministicUuid(idemKey),
      dependsOn: input.dependsOn,
      visibility: input.visibility,
      stepId: input.stepId,
      attempt: input.attempt,
    });
  });

  return jobId;
}

/**
 * Per-step context the renderer sends alongside an approve call — see
 * `packages/ui/src/lib/CaptureSink.ts`'s `ApprovalStepInfo` (same shape,
 * duplicated the same way every other faceAPI payload type is duplicated
 * across the IPC boundary rather than imported). The outbox row already
 * knows `stepId`/`attempt` (migration 008) and everything about the bytes;
 * this fills in the three things it cannot: `stepType`, `cameraRole` (never
 * stored — the workflow, not the outbox, owns that) and a possibly more
 * precise `capturedAt` than the row's own `created_at`.
 */
export interface SessionApprovalStepInfo {
  stepId: string;
  stepType: string;
  cameraRole: string;
  attempt: number;
  capturedAt?: string;
}

export interface ApproveSessionUploadOptions {
  workflowId?: string;
  startedAt?: string;
  /**
   * The workflow engine's own session id — a different id space than
   * `sessionId` (see `CaptureSink.approveUpload`'s doc comment in
   * packages/ui). Local video recording is keyed on this id, not on
   * `sessionId`, so `enqueueSessionVideos()` looks `capture_streams` up by
   * this instead. Falls back to `sessionId` when omitted, which is a
   * harmless no-op for any caller with no video story (it will simply match
   * no `capture_streams` rows) — every real renderer call site (onAccept in
   * FaceCaptureApp.tsx) always sends it.
   */
  videoSessionId?: string;
  /** The student this session belongs to, if the operator's kiosk looked one up — see SessionReportPayload.subjectCode's own doc comment. */
  subjectCode?: string;
  subjectName?: string;
  /** See `SessionReportPayload.operatorUserId`'s own doc comment. */
  operatorUserId?: string;
  /**
   * className/major/academicYear, when a subject was looked up. No
   * dedicated column exists for these anywhere server-side — they ride
   * along as free-form metadata on the SESSION_REPORT payload, merged into
   * the Postgres `sessions.metadata` jsonb column (see
   * `CaptureReportService.applySessionReport()`), the same "whatever the
   * client wants to remember, without a migration" column the web path's
   * `CreateSessionDto.metadata` already writes to.
   */
  metadata?: Record<string, unknown>;
}

/** One photo inside a SESSION_REPORT event — see §5 of phase-11's plan for the exact contract. */
export interface SessionReportPhoto {
  photoId: string;
  stepId: string;
  stepType?: string;
  cameraRole?: string;
  attempt: number;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  virtualPath: string;
  capturedAt: string;
  localStatus: OutboxStatus;
  fsFileId: string | null;
  fsStatus: string | null;
}

/** The SESSION_REPORT event payload — see §5 of phase-11's plan. */
export interface SessionReportPayload {
  sessionId: string;
  startedAt: string;
  approvedAt: string;
  workflowId?: string;
  /**
   * The student the kiosk's "nhập mã sinh viên" screen looked up for this
   * run (2026-09-08 "student gallery" feature) — null for the web path's own
   * subjectCode/subjectName handling (that goes through `startSession()`
   * directly, not through this report) or when no student was ever looked
   * up. `FaceCaptureApp.tsx`'s `handleStudentSubmit()` caches it via
   * `RunScopedCaptureSession.setSubject()`, which `approve()` forwards to
   * `ElectronCaptureSink.approveUpload()` and from there into
   * `ApproveSessionUploadOptions` below.
   */
  subjectCode: string | null;
  subjectName: string | null;
  /** className/major/academicYear, when a subject was looked up — see ApproveSessionUploadOptions.metadata's own doc comment for why these ride along here instead of dedicated fields. */
  metadata: Record<string, unknown> | null;
  /**
   * The SSO `users.id` of whoever was logged in on this kiosk when the
   * session was captured (2026-09-09, "thống kê phần giảng viên chụp" —
   * `apps/api`'s `DeviceEventService.campaignOperatorStats()` groups
   * `sessions` by this column for the campaign detail's own Thống kê tab).
   * `null` for a session run before this was threaded through, or on any
   * build that never had the operator's identity available at capture time
   * — grouped under one "Không rõ" row server-side rather than dropped.
   */
  operatorUserId: string | null;
  photos: SessionReportPhoto[];
}

/**
 * Narrow view of UploadOutboxRepository that approveSessionUpload() needs —
 * injectable so sessionReport.test.ts can exercise the report-building logic
 * with a fake repo and no Electron, the same pattern streams.ts's
 * EndVideoStreamRepo uses for endVideoStream().
 */
export interface ApproveSessionUploadRepo {
  approveSession: UploadOutboxRepository['approveSession'];
  listBySession: UploadOutboxRepository['listBySession'];
  /** Used by enqueueSessionVideos() below — kept on the same injected repo rather than a second lookup of the module's own `outbox` singleton, so a test-supplied fake is exercised for video the same as it already is for photos. */
  enqueue: UploadOutboxRepository['enqueue'];
  /** Post-save retake (2026-09-08) — see supersedeStaleAttempt()'s own doc comment. */
  supersedeOlderApprovedAttempts: UploadOutboxRepository['supersedeOlderApprovedAttempts'];
}

/** The subset of CaptureStreamRepository approveSessionUpload() needs — same injectable-for-tests reasoning as ApproveSessionUploadRepo. */
export interface ApproveSessionUploadStreamRepo {
  listBySession: CaptureStreamRepository['listBySession'];
  /** Post-save retake (2026-09-08) — see supersedeStaleAttempt()'s own doc comment. */
  listOlderFinishedRecordings: CaptureStreamRepository['listOlderFinishedRecordings'];
  deleteById: CaptureStreamRepository['deleteById'];
}

/** The subset of CapturedStudentRepository approveSessionUpload() needs — same injectable-for-tests reasoning as ApproveSessionUploadRepo. */
export interface ApproveSessionUploadStudentRepo {
  recordApproval: CapturedStudentRepository['recordApproval'];
}

/**
 * Assemble the SESSION_REPORT payload from the rows approveSession() left
 * behind, merged with whatever step context the renderer sent.
 *
 * Pure and Electron-free on purpose: `rows` is expected to be exactly
 * `repo.listBySession(sessionId)` taken right after a successful approval, at
 * which point every remaining row already IS final (the superseded ones were
 * just deleted in the same transaction) — see listBySession's own doc
 * comment. Exported and tested directly (sessionReport.test.ts) rather than
 * only indirectly through approveSessionUpload(), which needs a real or
 * Electron-backed database to call at all.
 */
export function buildSessionReportPayload(
  rows: OutboxItem[],
  steps: SessionApprovalStepInfo[] | undefined,
  meta: {
    sessionId: string;
    workflowId?: string;
    startedAt?: string;
    approvedAt: string;
    subjectCode?: string | null;
    subjectName?: string | null;
    metadata?: Record<string, unknown> | null;
    operatorUserId?: string | null;
  }
): SessionReportPayload {
  const stepById = new Map((steps ?? []).map((s) => [s.stepId, s] as const));
  const startedAt =
    meta.startedAt ??
    (rows.length > 0 ? new Date(Math.min(...rows.map((r) => r.createdAt))).toISOString() : meta.approvedAt);

  return {
    sessionId: meta.sessionId,
    startedAt,
    approvedAt: meta.approvedAt,
    workflowId: meta.workflowId,
    subjectCode: meta.subjectCode ?? null,
    subjectName: meta.subjectName ?? null,
    metadata: meta.metadata ?? null,
    operatorUserId: meta.operatorUserId ?? null,
    photos: rows.map((row) => {
      const step = row.stepId ? stepById.get(row.stepId) : undefined;
      return {
        photoId: row.id,
        stepId: row.stepId ?? '',
        stepType: step?.stepType,
        cameraRole: step?.cameraRole,
        attempt: row.attempt ?? 0,
        mimeType: row.mimeType,
        sizeBytes: row.sizeBytes,
        sha256: row.sha256,
        virtualPath: row.virtualPath,
        capturedAt: step?.capturedAt ?? new Date(row.createdAt).toISOString(),
        localStatus: row.status,
        fsFileId: row.fsFileId,
        fsStatus: row.fsStatus,
      };
    }),
  };
}

/**
 * Release a reviewed session's staged captures for upload.
 *
 * Delegates the actual query to the repository — see
 * UploadOutboxRepository.approveSession() for what "eligible" means, why a
 * session nobody ever approves is left staged rather than uploaded or
 * deleted, and why superseded (earlier-attempt) rows are deleted outright.
 * From here, the existing UploadWorker drains the surviving released rows on
 * its next tick exactly as it always has; nothing here talks to it directly.
 *
 * Two things happen only when a row was actually superseded or actually
 * approved, both best-effort / fire-and-forget from this function's point of
 * view: superseded rows' local files are unlinked (a failure there is logged,
 * never thrown — see the loop below), and a fresh approval enqueues a
 * SESSION_REPORT stats event built from `steps` (per-step context the
 * renderer sends — see SessionApprovalStepInfo) merged with whatever the
 * repository knows about the surviving rows (see buildSessionReportPayload).
 *
 * This is also the one moment a session's recorded video is allowed to leave
 * the kiosk (see enqueueSessionVideos() below): "Xác nhận & Lưu hồ sơ" IS the
 * approval this function performs, so video is enqueued here rather than at
 * recording end. A session that is cancelled or retaken instead never calls
 * this function, so its video is never enqueued — see
 * streams.ts's discardSessionVideos() for how that video gets cleaned up.
 *
 * Returns how many rows this call actually approved and how many it deleted
 * as superseded (0/0 for an already-approved or nonexistent session — never
 * an error, since "nothing to do" is a perfectly valid outcome for a
 * duplicate approve call), plus how many videos it enqueued.
 */
export async function approveSessionUpload(
  sessionId: string,
  steps?: SessionApprovalStepInfo[],
  options?: ApproveSessionUploadOptions,
  repo: ApproveSessionUploadRepo = outbox ?? new UploadOutboxRepository(getDatabase()),
  streamRepo: ApproveSessionUploadStreamRepo = new CaptureStreamRepository(getDatabase()),
  studentRepo: ApproveSessionUploadStudentRepo = new CapturedStudentRepository(getDatabase())
): Promise<{ approved: number; superseded: number; videosEnqueued: number }> {
  const result = repo.approveSession(sessionId);

  // Best-effort: an unlink failure must not undo the approval that already
  // committed, nor stop the report below from going out. A leftover file for
  // a photo the outbox no longer tracks is a disk-space nag — see finding #1
  // in docs/photo-upload-storage-flow.md, nothing has ever cleaned these up
  // even for normal DONE rows — not a correctness problem.
  for (const row of result.superseded) {
    try {
      fs.unlinkSync(row.localPath);
    } catch (err) {
      console.warn(
        `[approveSessionUpload] failed to remove superseded file ${row.localPath}:`,
        (err as Error).message
      );
    }
  }

  if (result.approved > 0) {
    // listBySession() right after the commit above sees only what survived:
    // the superseded rows are already gone, so this is exactly the "final
    // photos only" set §5 of phase-11's plan calls for, without a second
    // filter here.
    const rows = repo.listBySession(sessionId);
    const payload = buildSessionReportPayload(rows, steps, {
      sessionId,
      workflowId: options?.workflowId,
      startedAt: options?.startedAt,
      approvedAt: new Date().toISOString(),
      subjectCode: options?.subjectCode,
      subjectName: options?.subjectName,
      metadata: options?.metadata,
      operatorUserId: options?.operatorUserId,
    });
    // Spread into a fresh object literal: recordStatsEvent takes
    // Record<string, unknown>, and passing a named interface value (rather
    // than a literal) for that would fail TS's index-signature check.
    recordStatsEvent('SESSION_REPORT', { ...payload });

    // Local "student gallery" index (2026-09-08 feature) — best-effort,
    // kiosk-local only, independent of whether SESSION_REPORT itself ever
    // reaches the API. Only when a real student was actually looked up:
    // most sessions before this feature (and any run started without the
    // ID-entry screen, e.g. a dev/simulation build) have no subjectCode at
    // all, and there is nothing useful to index for those.
    if (payload.subjectCode) {
      try {
        studentRepo.recordApproval({
          sessionId,
          subjectCode: payload.subjectCode,
          subjectName: payload.subjectName,
          className: (payload.metadata?.className as string | undefined) ?? null,
          major: (payload.metadata?.major as string | undefined) ?? null,
          academicYear: (payload.metadata?.academicYear as string | undefined) ?? null,
          workflowId: payload.workflowId ?? null,
          photoCount: payload.photos.length,
          approvedAt: Date.now(),
        });
      } catch (err) {
        console.warn('[approveSessionUpload] failed to record local student index:', (err as Error).message);
      }
    }

    // Post-save retake (2026-09-08): a row just approved here might be
    // replacing one this same session already had approved from an EARLIER
    // call — see supersedeStaleAttempt()'s own doc comment for why that is
    // a different case than the superseded-rows loop above (which only ever
    // sees rows staged together in *this* call).
    for (const row of result.approvedRows) {
      if (!row.stepId) continue;
      supersedeStaleAttempt(repo, sessionId, row.kind, row.stepId, row.id);
    }
  }

  const videoSessionId = options?.videoSessionId ?? sessionId;
  const enqueuedStreams = await enqueueSessionVideos(sessionId, videoSessionId, repo, streamRepo);
  for (const stream of enqueuedStreams) {
    const older = streamRepo.listOlderFinishedRecordings(videoSessionId, stream.cameraId, stream.id);
    for (const oldStream of older) {
      // Video has no "keep the highest attempt at this stepId" concept the
      // way a photo does — each recording's stepId (its own capture_streams
      // id) is unique to it, so there is nothing else at that (kind, stepId)
      // to keep. An empty keepId can never match a real id, so this deletes
      // the old recording's outbox row outright, exactly as intended.
      supersedeStaleAttempt(repo, sessionId, 'video', oldStream.id, '');
      streamRepo.deleteById(oldStream.id);
    }
  }

  return { approved: result.approved, superseded: result.superseded.length, videosEnqueued: enqueuedStreams.length };
}

/**
 * Post-save retake (2026-09-08 "chụp lại sau khi đã lưu" feature): a fresh
 * attempt/recording just got approved/enqueued, replacing an OLDER one at
 * the same `(kind, stepId)` that was approved in a PREVIOUS call to
 * `approveSessionUpload()` — possibly long enough ago that it already
 * finished uploading to READY. `UploadOutboxRepository.approveSession()`'s
 * own supersede logic can never find this on its own: it only ever compares
 * rows staged together in one call (see its own doc comment), and by
 * definition the stale row here was approved in an earlier one.
 *
 * Best-effort throughout, matching every other cleanup path in this file: a
 * failed local unlink or a failed file-service delete is logged, never
 * thrown — the approval that already committed must stand regardless.
 * `ATTEMPT_SUPERSEDED` tells the API to delete its own now-stale
 * `photos`/`session_videos` row — see `CaptureReportService.applyAttemptSuperseded()`
 * and, same as `VIDEO_STATUS` before it, the API must know this enum value
 * before any kiosk build emits it (`statsEvents.ts` batches every pending
 * event type together; one unrecognised value 400s the whole batch).
 */
function supersedeStaleAttempt(
  repo: ApproveSessionUploadRepo,
  sessionId: string,
  kind: string,
  stepId: string,
  keepId: string
): void {
  const stale = repo.supersedeOlderApprovedAttempts(sessionId, kind, stepId, keepId);
  for (const item of stale) {
    try {
      fs.unlinkSync(item.localPath);
    } catch (err) {
      console.warn(
        `[approveSessionUpload] failed to remove superseded file ${item.localPath}:`,
        (err as Error).message
      );
    }
    if (item.fsFileId) {
      client?.deleteFile(item.fsFileId).catch((err) => {
        console.warn(
          `[approveSessionUpload] failed to delete superseded file ${item.fsFileId} from file-service:`,
          (err as Error).message
        );
      });
    }
    recordStatsEvent('ATTEMPT_SUPERSEDED', { kind: kind === 'video' ? 'video' : 'photo', id: item.id });
  }
}

/**
 * Enqueue every finished recording of a session for upload — see
 * approveSessionUpload()'s own doc comment for why this runs there and not
 * at recording end.
 *
 * Two different session ids are in play here, deliberately: `videoSessionId`
 * (the workflow engine's `CaptureSession.id`) is what `capture_streams` rows
 * were actually written under (see `FaceCaptureApp.tsx`'s recording effects),
 * so it is what `listBySession` below must query by — but the row this
 * writes into `upload_outbox` is stamped with `outboxSessionId` (the id
 * `SESSION_REPORT`/`PHOTO_STATUS` already report under, i.e. the id the
 * central Postgres `sessions` row actually has), so `emitVideoStatus()` and
 * `session_videos` group correctly with that session's photos instead of
 * under an id the API has never heard of. See `CaptureSink.approveUpload`'s
 * own doc comment (packages/ui) for why these two ids exist at all.
 *
 * `stepId` is the recording's own id (`capture_streams.id`), never
 * `cameraId`: `UploadOutboxRepository.approveSession()` groups rows by
 * `(kind, stepId)` and deletes every row but the highest attempt in a
 * group — grouping by camera would put a session's up-to-3 simultaneous-mode
 * videos in overlapping groups and delete two of them. One recording, one
 * stepId, attempt always 1 — each video is alone in its own group, so none
 * is ever deleted. Enqueued already-approved (`approvedAt` set): this call
 * already IS the approval moment (see the caller), so there is no separate
 * staged-then-approved window the way a photo has.
 *
 * A stream missing `endedAt` (the recorder never stopped — a crash, or a
 * step somehow still mid-recording) is skipped: there is no complete file to
 * send. `enqueue()`'s own `ON CONFLICT(idem_key) DO NOTHING` makes a repeat
 * call for an already-enqueued video a harmless no-op, so this needs no
 * approved-check of its own the way the photo branch above does.
 */
async function enqueueSessionVideos(
  outboxSessionId: string,
  videoSessionId: string,
  repo: ApproveSessionUploadRepo,
  streamRepo: ApproveSessionUploadStreamRepo
): Promise<CaptureStreamItem[]> {
  const streams = streamRepo.listBySession(videoSessionId).filter((s) => s.endedAt !== null);
  const year = new Date().getFullYear();
  const approvedAt = Date.now();

  // Returns the streams actually enqueued (2026-09-08, widened from a plain
  // count) so the caller can check each one for an older recording of the
  // same camera it replaces — see approveSessionUpload()'s post-save-retake
  // supersede loop right after this function's call site.
  const enqueued: CaptureStreamItem[] = [];
  for (const stream of streams) {
    const idemKey = `${outboxSessionId}:${stream.id}:1:video`;
    const ext = stream.mimeType.includes('mp4') ? 'mp4' : 'webm';
    try {
      const sha256 = await sha256HexOfFile(stream.localPath);
      repo.enqueue({
        id: deterministicUuid(idemKey),
        sessionId: outboxSessionId,
        kind: 'video',
        localPath: stream.localPath,
        virtualPath: `video/${year}/${outboxSessionId}/${stream.id}.${ext}`,
        mimeType: stream.mimeType,
        sha256,
        sizeBytes: stream.sizeBytes,
        idemKey,
        uploadId: deterministicUuid(idemKey),
        // Recorded evidence, not shareable content — same reasoning as
        // capture:queue's handler in index.ts uses for photos.
        visibility: 'private',
        stepId: stream.id,
        attempt: 1,
        approvedAt,
      });
      enqueued.push(stream);
    } catch (err) {
      console.warn(`[approveSessionUpload] failed to enqueue video ${stream.id}:`, (err as Error).message);
    }
  }
  return enqueued;
}

export interface UploadStatus {
  configured: boolean;
  pending: number;
  sending: number;
  awaitingScan: number;
  failedPermanent: number;
  oldestPendingAt: number | null;
  /** Files the server has held in a scanning state longer than expected. */
  stuckAwaitingScan: number;
}

export function uploadStatus(): UploadStatus {
  if (!outbox) {
    return {
      configured: false,
      pending: 0,
      sending: 0,
      awaitingScan: 0,
      failedPermanent: 0,
      oldestPendingAt: null,
      stuckAwaitingScan: 0,
    };
  }
  const stats = outbox.stats();
  return {
    configured: true,
    ...stats,
    stuckAwaitingScan: outbox.listStuckAwaitingScan(10 * 60_000).length,
  };
}

export function retryFailedUpload(jobId: string): void {
  outbox?.retryFailed(jobId);
}

/** Ask the server whether it is reachable right now. */
export async function pingFileService(): Promise<boolean> {
  return client ? client.ping() : false;
}

// ── Viewing and downloading ─────────────────────────────────────────────────

export interface PhotoRef {
  jobId: string;
  sessionId: string;
  kind: string;
  /** Server-side id, null until the bytes have been accepted. */
  fsFileId: string | null;
  /** Server-side state as last observed. */
  fsStatus: string | null;
  /** True while the local copy still exists. */
  localAvailable: boolean;
}

/** Photos belonging to a session, with where each one currently lives. */
export function listSessionPhotos(sessionId: string): PhotoRef[] {
  const repo = outbox ?? new UploadOutboxRepository(getDatabase());
  const rows = getDatabase().exec<Record<string, unknown>>(
    'SELECT id FROM upload_outbox WHERE session_id = ? ORDER BY created_at ASC',
    [sessionId]
  );

  return rows
    .map((r) => repo.getById(String(r.id)))
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .map((item) => ({
      jobId: item.id,
      sessionId: item.sessionId,
      kind: item.kind,
      fsFileId: item.fsFileId,
      fsStatus: item.fsStatus,
      localAvailable: item.localPath ? fs.existsSync(item.localPath) : false,
    }));
}

export interface ViewSource {
  /** 'local' while the capture is still on this machine, 'remote' once it is not. */
  source: 'local' | 'remote';
  /** Data URL for a local file, or a time-limited server URL. */
  url: string;
  /** When a remote link stops working. */
  expiresAt?: string;
}

/**
 * Something the UI can display for a photo.
 *
 * Prefers the local copy: it is instant, works offline, and avoids asking the
 * server for a link that will be thrown away a second later. Falls back to a
 * short-lived server link once the local copy has been cleaned up.
 */
export async function getPhotoViewSource(
  jobId: string,
  viewerId: string,
  ttlSeconds = 300
): Promise<ViewSource> {
  const repo = outbox ?? new UploadOutboxRepository(getDatabase());
  const item = repo.getById(jobId);
  if (!item) throw new Error(`No such photo: ${jobId}`);

  if (item.localPath && fs.existsSync(item.localPath)) {
    const bytes = fs.readFileSync(item.localPath);
    return {
      source: 'local',
      url: `data:${item.mimeType};base64,${bytes.toString('base64')}`,
    };
  }

  if (!item.fsFileId) {
    throw new Error('This photo has not reached the server yet and is no longer stored locally.');
  }
  if (!client) {
    throw new Error('No file-service is configured, so the photo cannot be fetched.');
  }

  // A freshly uploaded file is not readable until the server has scanned it;
  // asking for a link before then produces errors that come and go with timing.
  await client.waitUntilReady(item.fsFileId, { timeoutMs: 30_000, pollMs: 2_000 });

  const link = await client.issueDownloadLink(item.fsFileId, viewerId, ttlSeconds);
  return { source: 'remote', url: link.url, expiresAt: link.expiresAt };
}

export interface DownloadResult {
  savedPath: string;
  source: 'local' | 'remote';
  bytes: number;
}

/**
 * Write a photo to a chosen location, fetching it back from the server when the
 * local copy is gone.
 *
 * `_viewerId` kept in the signature to match the IPC call site (index.ts's
 * `photo:download` handler already forwards it) and `getPhotoViewSource`'s
 * sibling signature, but genuinely unused here: the remote-fetch fallback
 * uses `client.downloadWhenWarm()`, which authenticates with this process's
 * own file-service key rather than a viewer-scoped share link (unlike
 * `issueDownloadLink`, which `getPhotoViewSource` calls instead) — see that
 * method's own doc comment for why a share link is not used for this path.
 */
export async function downloadPhoto(
  jobId: string,
  destPath: string,
  _viewerId: string
): Promise<DownloadResult> {
  const repo = outbox ?? new UploadOutboxRepository(getDatabase());
  const item = repo.getById(jobId);
  if (!item) throw new Error(`No such photo: ${jobId}`);

  if (item.localPath && fs.existsSync(item.localPath)) {
    fs.copyFileSync(item.localPath, destPath);
    return { savedPath: destPath, source: 'local', bytes: fs.statSync(destPath).size };
  }

  if (!item.fsFileId) throw new Error('This photo is neither stored locally nor on the server.');
  if (!client) throw new Error('No file-service is configured, so the photo cannot be fetched.');

  await client.waitUntilReady(item.fsFileId, { timeoutMs: 30_000, pollMs: 2_000 });

  // Fetched with the service's own key rather than through a share link. A link
  // exists so a browser can load a file without the key; spending one here
  // would burn a token and take the public route for a call this process is
  // already entitled to make.
  // Waits out a cold-storage thaw: a photo nobody has opened in months
  // answers the first read with a restore notice rather than bytes.
  const bytes = await client.downloadWhenWarm(item.fsFileId);
  fs.writeFileSync(destPath, Buffer.from(bytes));
  return { savedPath: destPath, source: 'remote', bytes: bytes.byteLength };
}

export function recentUploadEvents(limit = 50): WorkerEvent[] {
  return recentEvents.slice(-limit);
}
