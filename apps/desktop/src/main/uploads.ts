import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { FsClient, UploadWorker, WorkerEvent, deterministicUuid, sha256Hex } from '@face/fs-client';
import { UploadOutboxRepository, nextRetryDelayMs } from '@face/database';
import { getDatabase } from './db.js';

/** Reads captures from local disk for the worker. */
const diskReader = {
  read: async (localPath: string): Promise<Uint8Array> => fs.promises.readFile(localPath),
};

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
  client = new FsClient({ baseUrl: config.baseUrl, apiKey: config.apiKey });

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
    });
  });

  return jobId;
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
