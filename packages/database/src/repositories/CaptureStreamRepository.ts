import { SqlExecutor } from '../sql/SqlDriver.js';

export interface CaptureStreamItem {
  id: string;
  sessionId: string;
  cameraId: string;
  localPath: string;
  mimeType: string;
  sizeBytes: number;
  durationMs: number;
  startedAt: number;
  endedAt: number | null;
  createdAt: number;
}

export interface StartStreamInput {
  id: string;
  sessionId: string;
  cameraId: string;
  localPath: string;
  mimeType?: string;
  startedAt: number;
}

export interface EndStreamInput {
  id: string;
  sizeBytes: number;
  durationMs: number;
  endedAt: number;
}

function toItem(r: Record<string, unknown>): CaptureStreamItem {
  return {
    id: String(r.id),
    sessionId: String(r.session_id),
    cameraId: String(r.camera_id),
    localPath: String(r.local_path),
    mimeType: String(r.mime_type),
    sizeBytes: Number(r.size_bytes ?? 0),
    durationMs: Number(r.duration_ms ?? 0),
    startedAt: Number(r.started_at),
    endedAt: r.ended_at === null || r.ended_at === undefined ? null : Number(r.ended_at),
    createdAt: Number(r.created_at),
  };
}

/**
 * Local video recorded during a capture session — see
 * docs/plans/multi-camera-device-management-discussion.md §3.1. Deliberately
 * has no upload/status/retry columns and no `enqueue`-style gate the way
 * `UploadOutboxRepository` does: whether video ever leaves the kiosk is still
 * an open question (that doc's §4 #3), so this repository only ever records
 * what was captured and where it lives on disk, nothing about sending it
 * anywhere. See migration 006's own doc comment for the full reasoning.
 */
export class CaptureStreamRepository {
  constructor(private db: SqlExecutor) {}

  /**
   * Call when a `MediaRecorder` starts — before any bytes are known, since
   * duration/size are only knowable once it stops. `endStream` fills those in
   * later; a row that never gets an `endStream` call (the app crashed mid
   * recording) simply keeps `ended_at NULL` forever, which is itself useful
   * information rather than a state that needs cleaning up.
   */
  public startStream(input: StartStreamInput): void {
    this.db.run(
      `INSERT INTO capture_streams (
         id, session_id, camera_id, local_path, mime_type, size_bytes, duration_ms, started_at, created_at
       ) VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?)`,
      [
        input.id,
        input.sessionId,
        input.cameraId,
        input.localPath,
        input.mimeType ?? 'video/webm',
        input.startedAt,
        Date.now(),
      ]
    );
  }

  /** Call once the recorder has actually stopped and the file is fully flushed to disk. */
  public endStream(input: EndStreamInput): void {
    this.db.run(
      `UPDATE capture_streams SET size_bytes = ?, duration_ms = ?, ended_at = ? WHERE id = ?`,
      [input.sizeBytes, input.durationMs, input.endedAt, input.id]
    );
  }

  public listBySession(sessionId: string): CaptureStreamItem[] {
    return this.db
      .exec<Record<string, unknown>>(`SELECT * FROM capture_streams WHERE session_id = ? ORDER BY started_at`, [
        sessionId,
      ])
      .map(toItem);
  }

  public getById(id: string): CaptureStreamItem | null {
    const rows = this.db.exec<Record<string, unknown>>(`SELECT * FROM capture_streams WHERE id = ?`, [id]);
    return rows[0] ? toItem(rows[0]) : null;
  }
}
