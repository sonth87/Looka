import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { EmbeddingServerClient, EmbeddingServerError } from '@face/biometric';
import type { EnrollFaceError } from '@face/biometric';
import { EmbeddingEnrollmentRepository, nextRetryDelayMs } from '@face/database';
import type { EmbeddingEnrollmentItem } from '@face/database';
import { getDatabase } from './db.js';

/**
 * Enrollment side of docs/plans/face-embedding-server-integration-plan.md.
 *
 * Mirrors `uploads.ts`'s own shape deliberately: a capture is durable the
 * instant it is written to disk and a queue row exists for it (both in one
 * transaction — see `enrollFaceForStep()`), and a background worker retries
 * whatever could not reach the server yet, on its own timer, independent of
 * whether the renderer that triggered it is even still open. That is the
 * same "durable local write first, background worker retries with backoff"
 * pattern `apps/api/src/modules/capture/services/upload-worker.service.ts`
 * already uses server-side, applied here to the desktop main process the
 * same way `uploads.ts`'s own `UploadWorker` already applies it to photo
 * uploads.
 *
 * What is NOT here: anything from the plan's §5.2 (recognition/attendance
 * `/search` flow) — `attendance.ts` is untouched by this file, and
 * `EmbeddingServerClient.search()` (present on the client for API
 * completeness) is never called from anywhere in this module.
 */

const DEFAULT_TIMEOUT_MS = 8_000;
/** Matches `UploadWorker`'s own default tick — see that class's own doc comment for why a queue an operator is standing in front of needs a tight poll. */
const TICK_MS = 5_000;
/** Rows claimed per tick — kept small so a burst of retries cannot starve other main-process work, same reasoning as `UploadWorker`'s own `batchSize`. */
const BATCH_SIZE = 2;
/** Matches `UploadWorker`'s own default — roughly a day of retries at capped backoff before giving up and surfacing FAILED/GAVE_UP for an operator to notice. */
const MAX_ATTEMPTS = 20;

function embeddingServerBaseUrl(): string | null {
  const v = process.env.EMBEDDING_SERVER_BASE_URL?.trim();
  return v ? v : null;
}

let repo: EmbeddingEnrollmentRepository | null = null;
let client: EmbeddingServerClient | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let ticking = false;

/** Where durable local copies of enrolled images live — independent of `uploads.ts`'s own captures dir, see EmbeddingEnrollmentRepository's own doc comment on `localImagePath` for why. */
function embeddingsDir(): string {
  return path.join(app.getPath('userData'), 'embeddings');
}

/**
 * Bring up the embedding-enrollment subsystem: recover anything a crash left
 * mid-send, then start the retry worker. Returns false when
 * `EMBEDDING_SERVER_BASE_URL` is unset — per the plan's §7, that is a
 * supported "feature off" state, not an error: the kiosk still captures and
 * queues normally, and nothing calls `enrollFace` at all while this is
 * false (see `FaceCaptureApp.tsx`'s own guard).
 */
export function startEmbeddingEnroll(): boolean {
  const baseUrl = embeddingServerBaseUrl();
  if (!baseUrl) return false;

  repo = new EmbeddingEnrollmentRepository(getDatabase());
  client = new EmbeddingServerClient({ baseUrl, timeoutMs: DEFAULT_TIMEOUT_MS });

  const recovered = repo.recoverInterrupted();
  if (recovered > 0) {
    console.warn(`[embeddingEnroll] recovered ${recovered} enrollment(s) interrupted by a crash`);
  }

  if (timer) clearInterval(timer);
  timer = setInterval(() => void tick(), TICK_MS);
  void tick();
  return true;
}

export function stopEmbeddingEnroll(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

/** Reachability preflight before a capture session — see aiService.ts's `pingAiService` for the same idea applied to the Python sidecar. Never throws. */
export async function embeddingHealth(): Promise<{ configured: boolean; ok: boolean; modelsLoaded: boolean }> {
  if (!client) return { configured: false, ok: false, modelsLoaded: false };
  const result = await client.health();
  return { configured: true, ...result };
}

export interface EnrollFaceInput {
  sessionId: string;
  stepId: string;
  attempt: number;
  userCode: string;
  dataUrl: string;
}

/**
 * Discriminated the same way the plan's §6 table is: a caller can branch on
 * `kind` to pick the right Vietnamese copy without re-deriving it. `queued:
 * true` on `NETWORK_ERROR` distinguishes "will retry in the background" from
 * every other kind, which never will (see `EmbeddingServerError.retryable`'s
 * own doc comment in `@face/biometric`).
 */
export type EnrollFaceOutcome =
  | { ok: true; embeddingId: number | null; sourceImagePath: string }
  | { ok: false; kind: 'NOT_CONFIGURED' }
  | { ok: false; kind: 'NETWORK_ERROR'; queued: true; cause: unknown }
  | { ok: false; kind: 'EMPTY_OR_UNREADABLE' }
  | { ok: false; kind: 'FILE_TOO_LARGE' }
  | { ok: false; kind: 'DUPLICATE_IDENTITY'; conflictUserCode: string; conflictSimilarity: number }
  | { ok: false; kind: 'IMAGE_REJECTED'; detail: string };

function decodeDataUrl(dataUrl: string): Buffer {
  if (!dataUrl.startsWith('data:image')) {
    throw new Error('Expected an image data URL');
  }
  return Buffer.from(dataUrl.replace(/^data:image\/\w+;base64,/, ''), 'base64');
}

/**
 * Durably record one capture as needing enrollment, then attempt it
 * immediately. Called from the `embedding:enrollFace` IPC handler once per
 * CENTER-step capture (see the integration task's own scope note on why
 * only CENTER, and `FaceCaptureApp.tsx`'s call site for where that decision
 * lives — the data model itself, `id`/`stepId` here, stays generic).
 *
 * The durable write (image to disk + a PENDING row, both inside one
 * transaction) happens unconditionally before any network call — even a
 * process crash between here and the network response leaves a recoverable
 * PENDING row, never a lost enrollment. This is deliberately synchronous
 * with the caller (unlike `queueCapture`, which never blocks on the
 * network): the plan's §5.1 diagram has the operator see 409/422 immediately
 * so they can react (retake, or flag for CB Help) rather than discovering it
 * only once the background worker gets to it.
 */
export async function enrollFaceForStep(input: EnrollFaceInput): Promise<EnrollFaceOutcome> {
  if (!repo || !client) return { ok: false, kind: 'NOT_CONFIGURED' };

  const id = `${input.sessionId}:${input.stepId}:${input.attempt}`;
  const data = decodeDataUrl(input.dataUrl);
  const dir = path.join(embeddingsDir(), input.sessionId);
  fs.mkdirSync(dir, { recursive: true });
  const localImagePath = path.join(dir, `${input.stepId}-${input.attempt}.jpg`);

  getDatabase().transaction(() => {
    // Written inside the transaction so a rollback can never leave a file
    // on disk with no row pointing at it — same reasoning as queueCapture()
    // in uploads.ts.
    fs.writeFileSync(localImagePath, data);
    repo!.enqueue({
      id,
      sessionId: input.sessionId,
      stepId: input.stepId,
      attempt: input.attempt,
      userCode: input.userCode,
      localImagePath,
    });
  });

  return sendOne(id);
}

/**
 * Sends one row to the server and applies the outcome to its DB row.
 *
 * Shared between the immediate call from `enrollFaceForStep()` and the
 * background worker's own retry loop — both need exactly the same
 * success/retry/fail classification, just triggered at different times.
 */
async function sendOne(id: string): Promise<EnrollFaceOutcome> {
  const row = repo!.getById(id);
  if (!row) {
    // Should be unreachable: `enrollFaceForStep()` always enqueues before
    // calling this, and rows are never deleted. Guarded rather than
    // asserted so a future caller mistake fails loudly instead of crashing
    // the background tick loop.
    throw new Error(`enrollment row ${id} not found — enqueue() must run before sendOne()`);
  }

  repo!.markSending(id);
  try {
    const data = fs.readFileSync(row.localImagePath);
    const blob = new Blob([data], { type: 'image/jpeg' });
    const fileName = `${row.stepId}-${row.attempt}.jpg`;

    const result = await client!.enrollFace(row.userCode, blob, fileName);
    repo!.markDone(id, { embeddingId: result.embeddingId, sourceImagePath: result.sourceImagePath });
    return { ok: true, embeddingId: result.embeddingId, sourceImagePath: result.sourceImagePath };
  } catch (err) {
    return applyFailure(row, err);
  }
}

function applyFailure(row: EmbeddingEnrollmentItem, err: unknown): EnrollFaceOutcome {
  if (!(err instanceof EmbeddingServerError)) {
    // Should not happen — every failure path in EmbeddingServerClient wraps
    // into this type — but a raw throw must still leave the row retryable
    // rather than stuck SENDING forever.
    const message = (err as Error)?.message ?? String(err);
    repo!.markRetry(row.id, message, nextRetryDelayMs(row.attempts));
    return { ok: false, queued: true, kind: 'NETWORK_ERROR', cause: err };
  }

  const detail: EnrollFaceError = err.detail as EnrollFaceError;

  if (detail.kind === 'NETWORK_ERROR') {
    // Transport failure or an unexpected/5xx status — see
    // EmbeddingServerError.retryable's own doc comment for why this is the
    // only kind worth a background retry.
    if (row.attempts + 1 >= MAX_ATTEMPTS) {
      repo!.markGaveUp(row.id, err.message);
    } else {
      repo!.markRetry(row.id, err.message, nextRetryDelayMs(row.attempts));
    }
    return { ok: false, queued: true, kind: 'NETWORK_ERROR', cause: detail.cause };
  }

  // A real rejection (400/409/413/422) — the server looked at these exact
  // bytes and said no; retrying automatically would only repeat it.
  repo!.markFailed(row.id, {
    kind: detail.kind,
    error: err.message,
    conflictUserCode: detail.kind === 'DUPLICATE_IDENTITY' ? detail.conflictUserCode : undefined,
    conflictSimilarity: detail.kind === 'DUPLICATE_IDENTITY' ? detail.conflictSimilarity : undefined,
  });

  if (detail.kind === 'DUPLICATE_IDENTITY') {
    return {
      ok: false,
      kind: 'DUPLICATE_IDENTITY',
      conflictUserCode: detail.conflictUserCode,
      conflictSimilarity: detail.conflictSimilarity,
    };
  }
  if (detail.kind === 'IMAGE_REJECTED') {
    return { ok: false, kind: 'IMAGE_REJECTED', detail: detail.detail };
  }
  return { ok: false, kind: detail.kind };
}

/** One background pass: retry whatever is due. Exposed for tests. */
export async function tick(): Promise<void> {
  if (!repo || !client) return;
  if (ticking) return;
  ticking = true;
  try {
    const due = repo.claimDue(Date.now(), BATCH_SIZE);
    for (const row of due) {
      await sendOne(row.id);
    }
  } catch (err) {
    // A background tick must never take the process down — whatever failed
    // is retried on the next one, same reasoning as UploadWorker.tick().
    console.error('[embeddingEnroll] tick failed:', (err as Error).message);
  } finally {
    ticking = false;
  }
}

// ── Admin operations (§7 — listFaces/deleteFace/deleteAllFaces IPC) ────────

function requireClient(): EmbeddingServerClient {
  if (!client) {
    throw new Error('Chưa cấu hình máy chủ nhận diện khuôn mặt (EMBEDDING_SERVER_BASE_URL).');
  }
  return client;
}

export async function listEnrolledFaces(userCode: string): ReturnType<EmbeddingServerClient['listFaces']> {
  return requireClient().listFaces(userCode);
}

export async function deleteEnrolledFace(userCode: string, embeddingId: number): ReturnType<EmbeddingServerClient['deleteFace']> {
  return requireClient().deleteFace(userCode, embeddingId);
}

export async function deleteAllEnrolledFaces(userCode: string): ReturnType<EmbeddingServerClient['deleteAllFaces']> {
  return requireClient().deleteAllFaces(userCode);
}
