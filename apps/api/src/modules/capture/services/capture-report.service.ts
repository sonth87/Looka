import { CustomException, ERROR_CODE } from '@app/common/errors';
import { HttpStatus, Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';

interface SessionReportPhotoInput {
  photoId: string;
  stepId: string;
  stepType?: string | null;
  cameraRole?: string | null;
  attempt: number;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  virtualPath: string;
  capturedAt?: string | null;
  localStatus?: string | null;
  fsFileId?: string | null;
  fsStatus?: string | null;
}

interface SessionReportPayload {
  sessionId: string;
  startedAt?: string | null;
  approvedAt: string;
  workflowId?: string | null;
  subjectCode?: string | null;
  subjectName?: string | null;
  photos: SessionReportPhotoInput[];
}

interface PhotoStatusPayload {
  sessionId: string;
  photoId: string;
  stepId: string;
  attempt: number;
  at: string;
  localStatus?: string | null;
  fsFileId?: string | null;
  fsStatus?: string | null;
  error?: string | null;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  virtualPath: string;
  stepType?: string | null;
  cameraRole?: string | null;
}

interface VideoStatusPayload {
  sessionId: string;
  videoId: string;
  at: string;
  localStatus?: string | null;
  fsFileId?: string | null;
  fsStatus?: string | null;
  error?: string | null;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  virtualPath: string;
  cameraRole?: string | null;
  durationMs?: number | null;
}

/**
 * Applies the two self-sufficient kiosk device-events onto the shared
 * `sessions`/`photos` tables - see
 * docs/plans/04-device-management/phase-11-capture-sessions-and-stats/implementation-plan.md
 * §5 for the exact wire contract and §6 (A.3) for these rules. Always called
 * from `DeviceEventService.recordBatch()` with the `EntityManager` of the
 * transaction that also saves the raw `device_events` audit row - both
 * upserts and that audit insert commit or roll back together.
 *
 * Raw SQL throughout, same reasoning as `PhotoService.addPhoto`: an
 * `ON CONFLICT` upsert with a hand-picked column list is not expressible
 * through TypeORM's query builder, and this is what makes re-applying the
 * same event (the transport's "duplicates are harmless" design, D2)
 * genuinely harmless rather than merely intended to be.
 */
@Injectable()
export class CaptureReportService {
  /**
   * Upserts the session and every reported (already-final, per decision 1)
   * photo. Static/identity photo columns are overwritten on every
   * application (idempotent: the kiosk always reports the same values for a
   * given photoId); upload-status columns (`local_status`/`fs_file_id`/
   * `fs_status`) are deliberately set ONLY when the row is first created
   * here — a resent or late-arriving SESSION_REPORT must never regress
   * progress a PHOTO_STATUS has already recorded (see `applyPhotoStatus`).
   */
  async applySessionReport(
    manager: EntityManager,
    deviceId: string,
    campaignId: string,
    rawMetadata: Record<string, unknown> | null | undefined,
  ): Promise<void> {
    const payload = this.assertSessionReportPayload(rawMetadata);

    await manager.query(
      `INSERT INTO sessions (
          id, source, device_id, campaign_id, status,
          captured_at, completed_at, approved_at, workflow_id,
          subject_code, subject_name
        ) VALUES ($1, 'KIOSK', $2, $3, 'COMPLETED', $4, $5, $5, $6, $7, $8)
        ON CONFLICT (id) DO UPDATE SET
          source = 'KIOSK',
          device_id = EXCLUDED.device_id,
          campaign_id = EXCLUDED.campaign_id,
          status = 'COMPLETED',
          captured_at = EXCLUDED.captured_at,
          completed_at = EXCLUDED.completed_at,
          approved_at = EXCLUDED.approved_at,
          workflow_id = EXCLUDED.workflow_id,
          subject_code = COALESCE(EXCLUDED.subject_code, sessions.subject_code),
          subject_name = COALESCE(EXCLUDED.subject_name, sessions.subject_name)`,
      [
        payload.sessionId,
        deviceId,
        campaignId,
        payload.startedAt ? new Date(payload.startedAt) : null,
        new Date(payload.approvedAt),
        payload.workflowId ?? null,
        payload.subjectCode ?? null,
        payload.subjectName ?? null,
      ],
    );

    for (const photo of payload.photos) {
      await manager.query(
        `INSERT INTO photos (
            id, session_id, step_id, attempt, step_type, camera_role,
            mime_type, bytes, sha256, virtual_path, captured_at,
            local_status, fs_file_id, fs_status
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
          ON CONFLICT (session_id, step_id, attempt) DO UPDATE SET
            step_type = EXCLUDED.step_type,
            camera_role = EXCLUDED.camera_role,
            mime_type = EXCLUDED.mime_type,
            bytes = EXCLUDED.bytes,
            sha256 = EXCLUDED.sha256,
            virtual_path = EXCLUDED.virtual_path,
            captured_at = EXCLUDED.captured_at`,
        [
          photo.photoId,
          payload.sessionId,
          photo.stepId,
          photo.attempt,
          photo.stepType ?? null,
          photo.cameraRole ?? null,
          photo.mimeType,
          photo.sizeBytes,
          photo.sha256,
          photo.virtualPath,
          photo.capturedAt ? new Date(photo.capturedAt) : null,
          photo.localStatus ?? null,
          photo.fsFileId ?? null,
          photo.fsStatus ?? null,
        ],
      );
    }
  }

  /**
   * Records one upload-lifecycle outcome for one photo. Creates the photo
   * (and, if this is the very first event the server has ever seen for it, a
   * minimal IN_PROGRESS session) when missing, so an event arriving before
   * its SESSION_REPORT never gets dropped. The status columns are then
   * updated only when `at` is not older than the stored high-water mark
   * (`fs_status_at`) - out-of-order-safe, and what makes a duplicate or
   * stale resend a no-op.
   */
  async applyPhotoStatus(
    manager: EntityManager,
    deviceId: string,
    campaignId: string,
    rawMetadata: Record<string, unknown> | null | undefined,
  ): Promise<void> {
    const payload = this.assertPhotoStatusPayload(rawMetadata);
    const at = new Date(payload.at);
    const uploadedAt = payload.localStatus === 'UPLOADED' ? at : null;
    const readyAt = payload.fsStatus === 'READY' ? at : null;

    await manager.query(
      `INSERT INTO sessions (id, source, device_id, campaign_id, status)
       VALUES ($1, 'KIOSK', $2, $3, 'IN_PROGRESS')
       ON CONFLICT (id) DO NOTHING`,
      [payload.sessionId, deviceId, campaignId],
    );

    await manager.query(
      `INSERT INTO photos (
          id, session_id, step_id, attempt, step_type, camera_role,
          mime_type, bytes, sha256, virtual_path,
          local_status, fs_file_id, fs_status, upload_error,
          fs_status_at, uploaded_at, ready_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
        ON CONFLICT (id) DO NOTHING`,
      [
        payload.photoId,
        payload.sessionId,
        payload.stepId,
        payload.attempt,
        payload.stepType ?? null,
        payload.cameraRole ?? null,
        payload.mimeType,
        payload.sizeBytes,
        payload.sha256,
        payload.virtualPath,
        payload.localStatus ?? null,
        payload.fsFileId ?? null,
        payload.fsStatus ?? null,
        payload.error ?? null,
        at,
        uploadedAt,
        readyAt,
      ],
    );

    await manager.query(
      `UPDATE photos SET
          local_status = $2,
          fs_file_id = COALESCE($3, fs_file_id),
          fs_status = $4,
          upload_error = $5,
          fs_status_at = $6,
          uploaded_at = COALESCE($7, uploaded_at),
          ready_at = COALESCE($8, ready_at)
        WHERE id = $1 AND $6 >= COALESCE(fs_status_at, '-infinity')`,
      [
        payload.photoId,
        payload.localStatus ?? null,
        payload.fsFileId ?? null,
        payload.fsStatus ?? null,
        payload.error ?? null,
        at,
        uploadedAt,
        readyAt,
      ],
    );
  }

  /**
   * Records one upload-lifecycle outcome for one video — mirrors
   * `applyPhotoStatus` exactly, on `session_videos` instead of `photos`. No
   * separate "report" event the way photos have `SESSION_REPORT`: a video is
   * enqueued already-approved (see `apps/desktop/src/main/uploads.ts`'s
   * `enqueueSessionVideos`), so the first VIDEO_STATUS the server ever sees
   * for a given video is also the only creation path it needs — same
   * create-if-missing-session, update-only-if-not-stale logic as photos.
   */
  async applyVideoStatus(
    manager: EntityManager,
    deviceId: string,
    campaignId: string,
    rawMetadata: Record<string, unknown> | null | undefined,
  ): Promise<void> {
    const payload = this.assertVideoStatusPayload(rawMetadata);
    const at = new Date(payload.at);
    const uploadedAt = payload.localStatus === 'UPLOADED' ? at : null;
    const readyAt = payload.fsStatus === 'READY' ? at : null;

    await manager.query(
      `INSERT INTO sessions (id, source, device_id, campaign_id, status)
       VALUES ($1, 'KIOSK', $2, $3, 'IN_PROGRESS')
       ON CONFLICT (id) DO NOTHING`,
      [payload.sessionId, deviceId, campaignId],
    );

    await manager.query(
      `INSERT INTO session_videos (
          id, session_id, camera_role, mime_type, bytes, sha256, duration_ms,
          virtual_path, local_status, fs_file_id, fs_status, upload_error,
          fs_status_at, uploaded_at, ready_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
        ON CONFLICT (id) DO NOTHING`,
      [
        payload.videoId,
        payload.sessionId,
        payload.cameraRole ?? null,
        payload.mimeType,
        payload.sizeBytes,
        payload.sha256,
        payload.durationMs ?? null,
        payload.virtualPath,
        payload.localStatus ?? null,
        payload.fsFileId ?? null,
        payload.fsStatus ?? null,
        payload.error ?? null,
        at,
        uploadedAt,
        readyAt,
      ],
    );

    await manager.query(
      `UPDATE session_videos SET
          local_status = $2,
          fs_file_id = COALESCE($3, fs_file_id),
          fs_status = $4,
          upload_error = $5,
          fs_status_at = $6,
          uploaded_at = COALESCE($7, uploaded_at),
          ready_at = COALESCE($8, ready_at)
        WHERE id = $1 AND $6 >= COALESCE(fs_status_at, '-infinity')`,
      [
        payload.videoId,
        payload.localStatus ?? null,
        payload.fsFileId ?? null,
        payload.fsStatus ?? null,
        payload.error ?? null,
        at,
        uploadedAt,
        readyAt,
      ],
    );
  }

  private assertSessionReportPayload(
    raw: Record<string, unknown> | null | undefined,
  ): SessionReportPayload {
    const invalid = (detail: string): never => {
      throw new CustomException(
        `SESSION_REPORT payload invalid: ${detail}`,
        ERROR_CODE.SESSION_REPORT_INVALID_PAYLOAD,
        HttpStatus.BAD_REQUEST,
      );
    };

    if (!raw || typeof raw !== 'object')
      return invalid('metadata must be an object');
    const m = raw;

    if (typeof m.sessionId !== 'string' || !m.sessionId)
      return invalid('sessionId is required');
    if (
      typeof m.approvedAt !== 'string' ||
      Number.isNaN(Date.parse(m.approvedAt))
    ) {
      return invalid('approvedAt must be an ISO date string');
    }
    if (
      m.startedAt != null &&
      (typeof m.startedAt !== 'string' || Number.isNaN(Date.parse(m.startedAt)))
    ) {
      return invalid('startedAt must be an ISO date string when present');
    }
    if (!Array.isArray(m.photos)) return invalid('photos must be an array');

    const photos = m.photos.map((rawPhoto, index) => {
      if (!rawPhoto || typeof rawPhoto !== 'object')
        return invalid(`photos[${index}] must be an object`);
      const p = rawPhoto as Record<string, unknown>;
      if (typeof p.photoId !== 'string' || !p.photoId)
        return invalid(`photos[${index}].photoId is required`);
      if (typeof p.stepId !== 'string' || !p.stepId)
        return invalid(`photos[${index}].stepId is required`);
      if (typeof p.attempt !== 'number')
        return invalid(`photos[${index}].attempt must be a number`);
      if (typeof p.mimeType !== 'string' || !p.mimeType)
        return invalid(`photos[${index}].mimeType is required`);
      if (typeof p.sizeBytes !== 'number')
        return invalid(`photos[${index}].sizeBytes must be a number`);
      if (typeof p.sha256 !== 'string' || !p.sha256)
        return invalid(`photos[${index}].sha256 is required`);
      if (typeof p.virtualPath !== 'string' || !p.virtualPath)
        return invalid(`photos[${index}].virtualPath is required`);

      return {
        photoId: p.photoId,
        stepId: p.stepId,
        stepType: (p.stepType as string | null | undefined) ?? null,
        cameraRole: (p.cameraRole as string | null | undefined) ?? null,
        attempt: p.attempt,
        mimeType: p.mimeType,
        sizeBytes: p.sizeBytes,
        sha256: p.sha256,
        virtualPath: p.virtualPath,
        capturedAt: (p.capturedAt as string | null | undefined) ?? null,
        localStatus: (p.localStatus as string | null | undefined) ?? null,
        fsFileId: (p.fsFileId as string | null | undefined) ?? null,
        fsStatus: (p.fsStatus as string | null | undefined) ?? null,
      } satisfies SessionReportPhotoInput;
    });

    return {
      sessionId: m.sessionId,
      startedAt: m.startedAt ?? null,
      approvedAt: m.approvedAt,
      workflowId: (m.workflowId as string | null | undefined) ?? null,
      subjectCode: (m.subjectCode as string | null | undefined) ?? null,
      subjectName: (m.subjectName as string | null | undefined) ?? null,
      photos,
    };
  }

  private assertPhotoStatusPayload(
    raw: Record<string, unknown> | null | undefined,
  ): PhotoStatusPayload {
    const invalid = (detail: string): never => {
      throw new CustomException(
        `PHOTO_STATUS payload invalid: ${detail}`,
        ERROR_CODE.PHOTO_STATUS_INVALID_PAYLOAD,
        HttpStatus.BAD_REQUEST,
      );
    };

    if (!raw || typeof raw !== 'object')
      return invalid('metadata must be an object');
    const m = raw;

    if (typeof m.sessionId !== 'string' || !m.sessionId)
      return invalid('sessionId is required');
    if (typeof m.photoId !== 'string' || !m.photoId)
      return invalid('photoId is required');
    if (typeof m.stepId !== 'string' || !m.stepId)
      return invalid('stepId is required');
    if (typeof m.attempt !== 'number')
      return invalid('attempt must be a number');
    if (typeof m.at !== 'string' || Number.isNaN(Date.parse(m.at)))
      return invalid('at must be an ISO date string');
    if (typeof m.mimeType !== 'string' || !m.mimeType)
      return invalid('mimeType is required');
    if (typeof m.sizeBytes !== 'number')
      return invalid('sizeBytes must be a number');
    if (typeof m.sha256 !== 'string' || !m.sha256)
      return invalid('sha256 is required');
    if (typeof m.virtualPath !== 'string' || !m.virtualPath)
      return invalid('virtualPath is required');

    return {
      sessionId: m.sessionId,
      photoId: m.photoId,
      stepId: m.stepId,
      attempt: m.attempt,
      at: m.at,
      localStatus: (m.localStatus as string | null | undefined) ?? null,
      fsFileId: (m.fsFileId as string | null | undefined) ?? null,
      fsStatus: (m.fsStatus as string | null | undefined) ?? null,
      error: (m.error as string | null | undefined) ?? null,
      mimeType: m.mimeType,
      sizeBytes: m.sizeBytes,
      sha256: m.sha256,
      virtualPath: m.virtualPath,
      stepType: (m.stepType as string | null | undefined) ?? null,
      cameraRole: (m.cameraRole as string | null | undefined) ?? null,
    };
  }

  private assertVideoStatusPayload(
    raw: Record<string, unknown> | null | undefined,
  ): VideoStatusPayload {
    const invalid = (detail: string): never => {
      throw new CustomException(
        `VIDEO_STATUS payload invalid: ${detail}`,
        ERROR_CODE.VIDEO_STATUS_INVALID_PAYLOAD,
        HttpStatus.BAD_REQUEST,
      );
    };

    if (!raw || typeof raw !== 'object')
      return invalid('metadata must be an object');
    const m = raw;

    if (typeof m.sessionId !== 'string' || !m.sessionId)
      return invalid('sessionId is required');
    if (typeof m.videoId !== 'string' || !m.videoId)
      return invalid('videoId is required');
    if (typeof m.at !== 'string' || Number.isNaN(Date.parse(m.at)))
      return invalid('at must be an ISO date string');
    if (typeof m.mimeType !== 'string' || !m.mimeType)
      return invalid('mimeType is required');
    if (typeof m.sizeBytes !== 'number')
      return invalid('sizeBytes must be a number');
    if (typeof m.sha256 !== 'string' || !m.sha256)
      return invalid('sha256 is required');
    if (typeof m.virtualPath !== 'string' || !m.virtualPath)
      return invalid('virtualPath is required');

    return {
      sessionId: m.sessionId,
      videoId: m.videoId,
      at: m.at,
      localStatus: (m.localStatus as string | null | undefined) ?? null,
      fsFileId: (m.fsFileId as string | null | undefined) ?? null,
      fsStatus: (m.fsStatus as string | null | undefined) ?? null,
      error: (m.error as string | null | undefined) ?? null,
      mimeType: m.mimeType,
      sizeBytes: m.sizeBytes,
      sha256: m.sha256,
      virtualPath: m.virtualPath,
      cameraRole: (m.cameraRole as string | null | undefined) ?? null,
      durationMs: (m.durationMs as number | null | undefined) ?? null,
    };
  }
}
