import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { CaptureStreamRepository } from '@face/database';
import { getDatabase } from './db.js';

/**
 * Local video recorded alongside a capture session — see
 * docs/plans/multi-camera-device-management-discussion.md §3.1. No upload
 * path here on purpose: whether video ever leaves the kiosk is still an open
 * question in that doc (§4 #3); this only ever writes to local disk and
 * records what it wrote, the same scope `CaptureStreamRepository` itself
 * covers — see that class's own doc comment.
 */

let repo: CaptureStreamRepository | null = null;

function getRepo(): CaptureStreamRepository {
  if (!repo) repo = new CaptureStreamRepository(getDatabase());
  return repo;
}

/** Where recordings live — a sibling of capturesDir() in uploads.ts, same reasoning. */
export function streamsDir(): string {
  return path.join(app.getPath('userData'), 'streams');
}

export interface StartVideoStreamInput {
  sessionId: string;
  cameraId: string;
  mimeType?: string;
}

/**
 * Registers a row the instant recording starts, before any bytes exist —
 * see CaptureStreamRepository.startStream's own doc comment for why: a
 * recording that never reaches `endVideoStream` (the app crashed, the kiosk
 * lost power) still leaves a row with `ended_at NULL`, rather than
 * disappearing as if it never happened.
 */
export function startVideoStream(input: StartVideoStreamInput): { streamId: string; localPath: string } {
  const dir = streamsDir();
  fs.mkdirSync(dir, { recursive: true });

  const streamId = crypto.randomUUID();
  const ext = (input.mimeType ?? 'video/webm').includes('mp4') ? 'mp4' : 'webm';
  const localPath = path.join(dir, `${streamId}.${ext}`);

  getRepo().startStream({
    id: streamId,
    sessionId: input.sessionId,
    cameraId: input.cameraId,
    localPath,
    mimeType: input.mimeType,
    startedAt: Date.now(),
  });

  return { streamId, localPath };
}

export interface EndVideoStreamInput {
  streamId: string;
  data: Uint8Array;
  durationMs: number;
}

/** The subset of `CaptureStreamRepository` `endVideoStream` actually needs — lets a test inject a fake without a real Electron `app`/database (see the test's own doc comment). */
export interface EndVideoStreamRepo {
  getById: CaptureStreamRepository['getById'];
  endStream: CaptureStreamRepository['endStream'];
}

/**
 * Writes the recorded bytes to the path decided at `startVideoStream` time
 * and closes out that row. The renderer holds the whole recording in memory
 * as `MediaRecorder` chunks and sends it complete, once, rather than
 * streaming partial writes to this process — simplest correct thing for a
 * first version, at the cost of the full recording living in the
 * renderer's memory until the step (or session) ends.
 *
 * `repo` defaults to the module's real, Electron-backed singleton — every
 * production call site (`stream:end` in index.ts) calls this with one
 * argument, unchanged. The parameter exists so a test can pass a fake
 * `{ getById, endStream }` instead: `getRepo()` needs both a real `app`
 * (for `getDatabase()`'s callers) and an initialized database, neither of
 * which exists under plain `node --test` (see streams.test.ts).
 */
export function endVideoStream(
  input: EndVideoStreamInput,
  repo: EndVideoStreamRepo = getRepo()
): { ok: true } | { ok: false; error: string } {
  const item = repo.getById(input.streamId);
  if (!item) return { ok: false, error: `Unknown stream id ${input.streamId}` };

  try {
    fs.writeFileSync(item.localPath, input.data);
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }

  repo.endStream({
    id: input.streamId,
    sizeBytes: input.data.byteLength,
    durationMs: input.durationMs,
    endedAt: Date.now(),
  });

  return { ok: true };
}

/** The subset of `CaptureStreamRepository` `discardSessionVideos` needs — same injectable-for-tests reasoning as `EndVideoStreamRepo`. */
export interface DiscardSessionVideosRepo {
  listBySession: CaptureStreamRepository['listBySession'];
  deleteBySession: CaptureStreamRepository['deleteBySession'];
}

/**
 * Delete a session's recorded video, on disk and from `capture_streams`,
 * when the operator abandons the session instead of approving it —
 * `FaceCaptureApp.tsx`'s `handleRestart`/`handleCancelWorkflow` call this.
 *
 * Safe to reach for any session here: `approveSessionUpload` is the only
 * thing that ever moves a video into `upload_outbox` (see that function's
 * own doc comment in uploads.ts), and a cancelled/retaken session never
 * calls it — so a row this function finds still in `capture_streams` was
 * never queued for upload and is safe to remove outright.
 *
 * Video is heavier than a photo and a kiosk otherwise has no way to reclaim
 * this disk space at all (there is no equivalent cleanup for an abandoned
 * photo attempt today — see `queueCapture`'s own doc comment), so unlike
 * that path this actively deletes rather than leaving an orphan. Best-effort
 * per file: a failed unlink is logged, never thrown, and the row is deleted
 * from `capture_streams` regardless — a missing file on disk is not a
 * reason to keep a bookkeeping row for it.
 */
export function discardSessionVideos(
  sessionId: string,
  repo: DiscardSessionVideosRepo = getRepo()
): { removed: number } {
  const streams = repo.listBySession(sessionId);

  for (const stream of streams) {
    try {
      fs.unlinkSync(stream.localPath);
    } catch (err) {
      console.warn(`[discardSessionVideos] failed to remove ${stream.localPath}:`, (err as Error).message);
    }
  }

  const removed = repo.deleteBySession(sessionId);
  return { removed };
}
