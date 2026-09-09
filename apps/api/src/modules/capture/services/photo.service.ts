import { CustomException, ERROR_CODE } from '@app/common/errors';
import { toDao } from '@app/common/helpers';
import { CommonService } from '@app/modules/shared/common/common.service';
import type { Visibility } from '@face/core';
import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { DataSource, Repository } from 'typeorm';
import {
  ALLOWED_PHOTO_MIME_TYPES,
  MAX_PHOTO_BYTES,
  SessionSource,
} from '../capture.constants';
import { PhotoDao } from '../dao';
import { AddDevicePhotoDto, AddPhotoDto } from '../dto';
import { Photo } from '../entities/photo.entity';
import { SessionService } from './session.service';

const DATA_URL_PATTERN = /^data:(image\/[a-z+]+);base64,(.+)$/i;

/** How long a signed `local-content` link stays valid — see `issueLocalViewLink`'s own doc comment. */
const LOCAL_VIEW_TTL_SECONDS = 600;

@Injectable()
export class PhotoService extends CommonService<Photo> {
  constructor(
    @InjectRepository(Photo)
    repository: Repository<Photo>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly sessionService: SessionService,
    private readonly configService: ConfigService,
  ) {
    super(repository);
  }

  /**
   * Shared by `addPhoto` (web) and `addDevicePhoto` (kiosk, A.1 of the
   * capture-routing work) — both accept the exact same base64 data-URL
   * shape and must reject the exact same way.
   */
  private decodeDataUrl(dataUrl: string): { mimeType: string; data: Buffer } {
    const match = DATA_URL_PATTERN.exec(dataUrl);
    if (!match) {
      throw new CustomException(
        'Expected dataUrl to be a base64 image data URL',
        ERROR_CODE.PHOTO_INVALID_DATA_URL,
        HttpStatus.BAD_REQUEST,
      );
    }

    const mimeType = match[1].toLowerCase();
    if (!ALLOWED_PHOTO_MIME_TYPES.includes(mimeType)) {
      throw new CustomException(
        `Unsupported image type "${mimeType}"`,
        ERROR_CODE.PHOTO_UNSUPPORTED_MIME_TYPE,
        HttpStatus.BAD_REQUEST,
      );
    }

    const data = Buffer.from(match[2], 'base64');
    if (data.byteLength === 0) {
      throw new CustomException(
        'Image payload decoded to zero bytes',
        ERROR_CODE.PHOTO_INVALID_DATA_URL,
        HttpStatus.BAD_REQUEST,
      );
    }
    if (data.byteLength > MAX_PHOTO_BYTES) {
      throw new CustomException(
        `Image is ${data.byteLength} bytes, above the ${MAX_PHOTO_BYTES} limit`,
        ERROR_CODE.PHOTO_TOO_LARGE,
        HttpStatus.BAD_REQUEST,
      );
    }

    return { mimeType, data };
  }

  /**
   * Record a capture and queue it for the file-service.
   *
   * The photo row and its outbox entry are written together, in one
   * transaction. Accepting bytes, telling the client they are saved, and then
   * failing to record the intent to upload them is the one outcome worth
   * engineering against - the browser has already discarded its copy by then.
   */
  async addPhoto(
    sessionId: string,
    dto: AddPhotoDto,
  ): Promise<{ photoId: string }> {
    await this.sessionService.findByIdOrFail(sessionId);

    const { mimeType, data } = this.decodeDataUrl(dto.dataUrl);
    const sha256 = createHash('sha256').update(data).digest('hex');
    // Deterministic, so every retry of this exact capture carries the same
    // key and the file-service recognises a repeat instead of storing a
    // second file (see the integration guide, section 4.5).
    const idemKey = `${sessionId}:${dto.stepId}:${dto.attempt}`;
    const ext = mimeType === 'image/png' ? 'png' : 'jpg';
    const virtualPath = `sessions/${sessionId}/${dto.stepId}-${dto.attempt}.${ext}`;

    const photoId = await this.dataSource.transaction(async (manager) => {
      // Raw SQL here rather than `Repository.upsert()`: TypeORM's upsert
      // rewrites every property present on the entity-like on conflict, and
      // this needs to touch ONLY mime_type on a resend - overwriting
      // `fs_file_id`/`fs_status` on a legitimate retry would erase progress a
      // background upload may have already made between the original insert
      // and the retry.
      const rows: Array<{ id: string }> = await manager.query(
        // Column-list form, not `ON CONFLICT ON CONSTRAINT`: the unique index
        // below is a plain `CREATE UNIQUE INDEX` (via the entity's `@Index`),
        // which Postgres does not register in `pg_constraint` - naming it in
        // `ON CONFLICT ON CONSTRAINT` fails at runtime ("constraint ... does
        // not exist"). The column-list form resolves against any applicable
        // unique index regardless of how it was created.
        `INSERT INTO photos (session_id, step_id, attempt, mime_type, bytes, sha256, virtual_path, trigger_source, capture_mode)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (session_id, step_id, attempt) DO UPDATE
           SET mime_type = EXCLUDED.mime_type,
               trigger_source = EXCLUDED.trigger_source,
               capture_mode = EXCLUDED.capture_mode
         RETURNING id`,
        [
          sessionId,
          dto.stepId,
          dto.attempt,
          mimeType,
          data.byteLength,
          sha256,
          virtualPath,
          dto.triggerSource ?? null,
          dto.captureMode ?? null,
        ],
      );
      const id = rows[0].id;

      // Every capture through this endpoint is a card photo - biometric data
      // - decided here because this is the one place that actually knows
      // that; the outbox/upload worker downstream just carries the value
      // through as a plain column rather than choosing it themselves.
      const visibility: Visibility = 'private';

      await manager.query(
        `INSERT INTO upload_outbox (photo_id, idem_key, virtual_path, mime_type, content, visibility)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (idem_key) DO NOTHING`,
        [id, idemKey, virtualPath, mimeType, data, visibility],
      );

      return id;
    });

    return { photoId };
  }

  /**
   * The kiosk-path twin of `addPhoto` above (Part A of the "route kiosk
   * photo uploads through apps/api" work) — a device pushes one captured
   * photo's actual bytes here, authenticated via `DeviceCredentialsGuard`
   * instead of the web path's session-scoped call. Writes into the exact
   * same `photos`/`upload_outbox` tables, through the exact same
   * `UploadWorkerService` cron, so a kiosk-sourced photo is viewable from
   * this API's own Postgres the instant it is captured — never only after
   * fs-core has it — the same guarantee the web path already had.
   *
   * Two differences from `addPhoto`, both because the caller is a kiosk
   * reporting an ALREADY-LOCALLY-APPROVED capture (see this module's own
   * task brief — this is called at the same moment
   * `apps/desktop/src/main/uploads.ts`'s `approveSessionUpload()` already
   * builds SESSION_REPORT from, not at raw capture time):
   *
   *  1. `id` is the CALLER's id, not one this method generates — the kiosk's
   *     own local outbox job id, the same id `SESSION_REPORT`/`PHOTO_STATUS`
   *     already report under (see `CaptureReportService.applySessionReport`).
   *     Keeping one id across the whole lifecycle is what lets a
   *     SESSION_REPORT that still arrives after this call (some kiosk builds
   *     may keep sending it) upsert the very same row instead of fighting
   *     this one for a second id — its own `ON CONFLICT (session_id,
   *     step_id, attempt) DO UPDATE` only ever touches the static identity
   *     columns (see that method's own doc comment), never
   *     `local_status`/`fs_file_id`/`fs_status`, so re-applying it after this
   *     method already created the row is a harmless no-op, not a race.
   *  2. The outbox row is written already `approved_at = now()` — this
   *     endpoint's caller reports only after the kiosk's own local approval,
   *     so there is no separate staged-then-approved window the way the web
   *     path's `PhotoService.addPhoto` → `SessionService.completeSession`
   *     two-step has.
   *
   * A minimal `sessions` row is upserted first (IN_PROGRESS, `ON CONFLICT
   * DO NOTHING`) so `photos.session_id`'s FK is satisfied even if this call
   * lands before (or interleaved with) that session's own SESSION_REPORT —
   * identical reasoning to `CaptureReportService.applyPhotoStatus`'s own
   * create-if-missing-session step.
   */
  async addDevicePhoto(
    deviceId: string,
    campaignId: string,
    dto: AddDevicePhotoDto,
  ): Promise<{ photoId: string }> {
    const { mimeType, data } = this.decodeDataUrl(dto.dataUrl);
    const sha256 = createHash('sha256').update(data).digest('hex');
    const idemKey = `${dto.sessionId}:${dto.stepId}:${dto.attempt}`;
    const ext = mimeType === 'image/png' ? 'png' : 'jpg';
    const virtualPath = `sessions/${dto.sessionId}/${dto.stepId}-${dto.attempt}.${ext}`;

    await this.dataSource.transaction(async (manager) => {
      await manager.query(
        `INSERT INTO sessions (id, source, device_id, campaign_id, status)
         VALUES ($1, 'KIOSK', $2, $3, 'IN_PROGRESS')
         ON CONFLICT (id) DO NOTHING`,
        [dto.sessionId, deviceId, campaignId],
      );

      await manager.query(
        `INSERT INTO photos (id, session_id, step_id, attempt, step_type, camera_role, mime_type, bytes, sha256, virtual_path, trigger_source, capture_mode)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         ON CONFLICT (session_id, step_id, attempt) DO UPDATE
           SET step_type = EXCLUDED.step_type,
               camera_role = EXCLUDED.camera_role,
               mime_type = EXCLUDED.mime_type,
               bytes = EXCLUDED.bytes,
               sha256 = EXCLUDED.sha256,
               virtual_path = EXCLUDED.virtual_path,
               trigger_source = EXCLUDED.trigger_source,
               capture_mode = EXCLUDED.capture_mode`,
        [
          dto.photoId,
          dto.sessionId,
          dto.stepId,
          dto.attempt,
          dto.stepType ?? null,
          dto.cameraRole ?? null,
          mimeType,
          data.byteLength,
          sha256,
          virtualPath,
          dto.triggerSource ?? null,
          dto.captureMode ?? null,
        ],
      );

      // Same "this is biometric data" reasoning as addPhoto() above.
      const visibility: Visibility = 'private';

      await manager.query(
        `INSERT INTO upload_outbox (photo_id, idem_key, virtual_path, mime_type, content, visibility, approved_at)
         VALUES ($1, $2, $3, $4, $5, $6, now())
         ON CONFLICT (idem_key) DO NOTHING`,
        [dto.photoId, idemKey, virtualPath, mimeType, data, visibility],
      );
    });

    return { photoId: dto.photoId };
  }

  async listBySession(sessionId: string): Promise<PhotoDao[]> {
    const rows = await this.dataSource.query<
      Array<{
        id: string;
        step_id: string;
        attempt: number;
        bytes: number;
        mime_type: string;
        created_at: Date;
        fs_file_id: string | null;
        fs_status: string | null;
        trigger_source: string | null;
        capture_mode: string | null;
        upload_status: string;
      }>
    >(
      `SELECT p.id,
              p.step_id,
              p.attempt,
              p.bytes,
              p.mime_type,
              p.created_at,
              p.fs_file_id,
              p.fs_status,
              p.trigger_source,
              p.capture_mode,
              COALESCE(o.status, 'UPLOADED') AS upload_status
         FROM photos p
         LEFT JOIN upload_outbox o ON o.photo_id = p.id
        WHERE p.session_id = $1
        ORDER BY p.created_at`,
      [sessionId],
    );

    return toDao(
      PhotoDao,
      rows.map((r) => ({
        id: r.id,
        stepId: r.step_id,
        attempt: r.attempt,
        bytes: r.bytes,
        mimeType: r.mime_type,
        capturedAt: r.created_at,
        fsFileId: r.fs_file_id ?? undefined,
        fsStatus: r.fs_status ?? undefined,
        triggerSource: r.trigger_source ?? undefined,
        captureMode: r.capture_mode ?? undefined,
        uploadStatus: r.upload_status,
      })),
    );
  }

  async findFsFileIdOrFail(photoId: string): Promise<string> {
    const photo = await this.findById(photoId);
    if (!photo) {
      throw new CustomException(
        'Photo not found',
        ERROR_CODE.PHOTO_NOT_FOUND,
        HttpStatus.NOT_FOUND,
      );
    }
    if (!photo.fsFileId) {
      throw new CustomException(
        'This photo has not reached the file-service yet',
        ERROR_CODE.FILE_STORAGE_NOT_READY,
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return photo.fsFileId;
  }

  /**
   * Which file-service client should serve this photo's view-link (A.7).
   * A kiosk photo lives under its device's own tenant namespace (see
   * `FileStorageService.clientForTenant` - the tenant name is the device
   * id, the same self-service provisioning the kiosk itself used); a web
   * photo stays on this API's own default tenant, so `tenantName` is
   * `undefined` for it.
   *
   * Superseded by `resolveViewSource` below (Part A of the
   * capture-routing work) for `PhotoController.viewLink`'s own use — kept
   * as a separate, still-throws-if-not-on-fs-core method since nothing else
   * in this codebase needs the "no local fallback" variant, but removing it
   * outright was not worth the risk this pass.
   */
  async resolveViewContext(
    photoId: string,
  ): Promise<{ fsFileId: string; tenantName?: string }> {
    const photo = await this.findById(photoId);
    if (!photo) {
      throw new CustomException(
        'Photo not found',
        ERROR_CODE.PHOTO_NOT_FOUND,
        HttpStatus.NOT_FOUND,
      );
    }
    if (!photo.fsFileId) {
      throw new CustomException(
        'This photo has not reached the file-service yet',
        ERROR_CODE.FILE_STORAGE_NOT_READY,
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    const session = await this.sessionService.findById(photo.sessionId);
    const tenantName =
      session?.source === SessionSource.KIOSK && session.deviceId
        ? session.deviceId
        : undefined;

    return { fsFileId: photo.fsFileId, tenantName };
  }

  /**
   * Where to load this photo from for viewing (`PhotoController`'s `POST
   * :id/view-link`, A.3 of the capture-routing work): the real fs-core link
   * once `fs_file_id` is set, or a signal to fall back to this API's own
   * locally held bytes (`upload_outbox.content`) when it is not — "a
   * captured photo that hasn't reached the file server yet must still be
   * shown to the user" (the user's own framing of this requirement, see
   * that work's task brief). Throws only when NEITHER is available — a
   * photo whose row exists (e.g. from SESSION_REPORT metadata alone, an
   * older kiosk build, or a row this API created before its bytes ever
   * arrived) but whose bytes never reached either place.
   */
  async resolveViewSource(
    photoId: string,
  ): Promise<
    | { kind: 'remote'; fsFileId: string; tenantName?: string }
    | { kind: 'local' }
  > {
    const photo = await this.findById(photoId);
    if (!photo) {
      throw new CustomException(
        'Photo not found',
        ERROR_CODE.PHOTO_NOT_FOUND,
        HttpStatus.NOT_FOUND,
      );
    }

    if (photo.fsFileId) {
      const session = await this.sessionService.findById(photo.sessionId);
      const tenantName =
        session?.source === SessionSource.KIOSK && session.deviceId
          ? session.deviceId
          : undefined;
      return { kind: 'remote', fsFileId: photo.fsFileId, tenantName };
    }

    const rows: Array<{ has_content: boolean }> = await this.dataSource.query(
      `SELECT (content IS NOT NULL AND length(content) > 0) AS has_content
         FROM upload_outbox WHERE photo_id = $1
        ORDER BY created_at DESC LIMIT 1`,
      [photoId],
    );
    if (rows[0]?.has_content) {
      return { kind: 'local' };
    }

    throw new CustomException(
      'This photo has not reached the file-service yet and has no locally stored bytes either',
      ERROR_CODE.FILE_STORAGE_NOT_READY,
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }

  /**
   * A signed, short-lived URL for `PhotoContentController`'s unauthenticated
   * `GET :id/local-content` — the local-bytes counterpart of
   * `FileStorageService.issueViewLink`'s fs-core link, for a photo that
   * has not reached fs-core yet (see `resolveViewSource`). Signed with an
   * HMAC over `photoId:expiry`, keyed by this API's own `API_KEY` (a secret
   * already required to exist and already never sent to a browser), rather
   * than a new persisted token table — the same "unguessable, self-
   * expiring, no separate auth header" property a real fs-core link has,
   * without new infrastructure for what is only ever a short transitional
   * window (until the upload worker's next successful send to fs-core).
   *
   * `apiBaseUrl` is the origin the calling browser actually used to reach
   * THIS request (see `PhotoController.viewLink`'s own comment) — not a
   * configured public URL, so this works unmodified for both a local dev
   * setup and a real LAN deployment.
   */
  issueLocalViewLink(
    photoId: string,
    apiBaseUrl: string,
  ): { url: string; expiresAt: string } {
    const exp = Math.floor(Date.now() / 1000) + LOCAL_VIEW_TTL_SECONDS;
    const sig = this.signLocalViewToken(photoId, exp);
    const url = `${apiBaseUrl.replace(/\/$/, '')}/v1/photos/${photoId}/local-content?exp=${exp}&sig=${sig}`;
    return { url, expiresAt: new Date(exp * 1000).toISOString() };
  }

  /** Throws `PHOTO_LOCAL_TOKEN_INVALID` unless `sig`/`exp` are a valid, unexpired pair for `photoId` — see `issueLocalViewLink`. */
  verifyLocalViewTokenOrFail(
    photoId: string,
    expRaw: string,
    sigRaw: string,
  ): void {
    const exp = Number(expRaw);
    const expectedBuf = Buffer.from(
      this.signLocalViewToken(photoId, exp),
      'hex',
    );
    const gotBuf = sigRaw ? Buffer.from(sigRaw, 'hex') : Buffer.alloc(0);
    const valid =
      Number.isFinite(exp) &&
      exp >= Math.floor(Date.now() / 1000) &&
      expectedBuf.length === gotBuf.length &&
      expectedBuf.length > 0 &&
      timingSafeEqual(expectedBuf, gotBuf);
    if (!valid) {
      throw new CustomException(
        'This local-content link is invalid or has expired — request a fresh one via POST :id/view-link',
        ERROR_CODE.PHOTO_LOCAL_TOKEN_INVALID,
        HttpStatus.UNAUTHORIZED,
      );
    }
  }

  private signLocalViewToken(photoId: string, exp: number): string {
    const secret = this.configService.get<string>('security.apiKey') ?? '';
    return createHmac('sha256', secret)
      .update(`${photoId}:${exp}`)
      .digest('hex');
  }

  /** Streams straight from `upload_outbox.content` — see `resolveViewSource`'s 'local' branch. */
  async readLocalContent(
    photoId: string,
  ): Promise<{ data: Buffer; mimeType: string }> {
    const rows: Array<{ content: Buffer | null; mime_type: string }> =
      await this.dataSource.query(
        `SELECT content, mime_type FROM upload_outbox
          WHERE photo_id = $1 AND content IS NOT NULL AND length(content) > 0
          ORDER BY created_at DESC LIMIT 1`,
        [photoId],
      );
    if (!rows[0]?.content) {
      throw new CustomException(
        'No locally stored bytes for this photo',
        ERROR_CODE.FILE_STORAGE_NOT_READY,
        HttpStatus.NOT_FOUND,
      );
    }
    return { data: rows[0].content, mimeType: rows[0].mime_type };
  }
}
