import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { Visibility } from '@face/core';
import { FsClient, UploadWorker, WorkerEvent, deterministicUuid, sha256Hex } from '@face/fs-client';
import { UploadOutboxRepository, CaptureStreamRepository, nextRetryDelayMs } from '@face/database';
import type { OutboxItem, OutboxStatus } from '@face/database';
import { getDatabase } from './db.js';
import { recordStatsEvent } from './statsEvents.js';

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
  client = new FsClient({ baseUrl: config.baseUrl, apiKey: config.apiKey });

  // Looks the job up in the outbox so the PHOTO_STATUS event stands on its
  // own (§5 of phase-11's plan) rather than depending on whatever narrow
  // fields a given WorkerEvent variant happens to carry. `stepType`/
  // `cameraRole` are omitted rather than guessed: the outbox has never stored
  // them (queueCapture() is never given them today — see
  // SessionApprovalStepInfo's own doc comment for where they DO live), so
  // there is nothing here to derive them from.
  const emitPhotoStatus = (jobId: string, error: string | null = null) => {
    const item = outbox?.getById(jobId);
    if (!item) return;
    recordStatsEvent('PHOTO_STATUS', {
      sessionId: item.sessionId,
      photoId: item.id,
      stepId: item.stepId,
      attempt: item.attempt,
      at: new Date().toISOString(),
      localStatus: item.status,
      fsFileId: item.fsFileId,
      fsStatus: item.fsStatus,
      error: error ?? item.lastError,
      mimeType: item.mimeType,
      sizeBytes: item.sizeBytes,
      sha256: item.sha256,
      virtualPath: item.virtualPath,
    });
  };

  // Mirrors emitPhotoStatus() on its own DeviceEventType (VIDEO_STATUS) so
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

      const isVideo = outbox?.getById(event.jobId)?.kind === 'video';
      const emitStatus = isVideo ? emitVideoStatus : emitPhotoStatus;

      // Stats events (§3.4) only on a *final* outcome, not every transient
      // retry attempt: 'uploaded' is bytes actually accepted by fs-core;
      // 'quarantined'/'failed' are permanent rejections (D6 in phase-11's
      // plan — 'failed' used to be silent here, undercounting real upload
      // failures such as a quota or a 4xx that is never retried). 'retry' is
      // operational noise the retry loop already handles on its own and
      // would wildly over-count if treated as a stats-facing signal.
      if (event.type === 'uploaded') {
        recordStatsEvent('UPLOAD_SUCCESS', { jobId: event.jobId });
        emitStatus(event.jobId);
      }
      if (event.type === 'ready') {
        emitStatus(event.jobId);
        if (isVideo) deleteLocalVideo(event.jobId);
      }
      if (event.type === 'failed') {
        recordStatsEvent('UPLOAD_FAILED', { jobId: event.jobId });
        emitStatus(event.jobId, event.error);
      }
      if (event.type === 'quarantined') {
        recordStatsEvent('UPLOAD_FAILED', { jobId: event.jobId });
        emitStatus(event.jobId);
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
   * Always null today — kept because §5 of phase-11's plan fixes these field
   * names as part of the contract. Nothing in the current kiosk flow collects
   * a subject identity for a face-capture session (`RunScopedCaptureSession`
   * always opens with `startSession({})`, and `CaptureSession` — @face/core —
   * has no such field), so there is nothing to plumb through yet; a future
   * caller that does have one can pass it via `meta`.
   */
  subjectCode: string | null;
  subjectName: string | null;
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
}

/** The subset of CaptureStreamRepository approveSessionUpload() needs — same injectable-for-tests reasoning as ApproveSessionUploadRepo. */
export interface ApproveSessionUploadStreamRepo {
  listBySession: CaptureStreamRepository['listBySession'];
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
  streamRepo: ApproveSessionUploadStreamRepo = new CaptureStreamRepository(getDatabase())
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
    });
    // Spread into a fresh object literal: recordStatsEvent takes
    // Record<string, unknown>, and passing a named interface value (rather
    // than a literal) for that would fail TS's index-signature check.
    recordStatsEvent('SESSION_REPORT', { ...payload });
  }

  const videosEnqueued = await enqueueSessionVideos(sessionId, options?.videoSessionId ?? sessionId, repo, streamRepo);

  return { approved: result.approved, superseded: result.superseded.length, videosEnqueued };
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
): Promise<number> {
  const streams = streamRepo.listBySession(videoSessionId).filter((s) => s.endedAt !== null);
  const year = new Date().getFullYear();
  const approvedAt = Date.now();

  let enqueued = 0;
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
      enqueued++;
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
 */
export async function downloadPhoto(
  jobId: string,
  destPath: string,
  viewerId: string
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
