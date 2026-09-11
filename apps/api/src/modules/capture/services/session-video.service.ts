import { CustomException, ERROR_CODE } from '@app/shared/errors/legacy';
import { CommonService } from '@app/shared/common/common.service';
import type { Visibility } from '@face/core';
import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { DataSource, Repository } from 'typeorm';
import { ALLOWED_VIDEO_MIME_TYPES, MAX_VIDEO_BYTES } from '../capture.constants';
import { AddDeviceVideoDto } from '../dto';
import { SessionVideo } from '../entities/session-video.entity';

/**
 * NOT the same shape as `PhotoService`'s own `DATA_URL_PATTERN` — live DB
 * data checked while verifying this task (real `session_videos.mime_type`
 * values) showed a real kiosk-recorded video's mime type is
 * `MediaRecorder.mimeType` verbatim, e.g. `"video/webm;codecs=vp8"` — a
 * codec parameter photos never have. That mimetype ALREADY contains a `;`,
 * so `data:<mimetype>;base64,<data>` can contain two, and the naive
 * "match everything before the first `;`" a JPEG/PNG-only regex gets away
 * with would truncate `video/webm` off `;codecs=vp8` and then fail to match
 * the literal `;base64,` that follows it at all. `;base64,` is instead
 * located directly (never legitimately part of a mimetype or of pure base64
 * data, which uses only `[A-Za-z0-9+/=]`), and everything before it is kept
 * as the mimetype verbatim, codec parameter included — matching what a real
 * kiosk build already writes to this same column via the (now-legacy)
 * VIDEO_STATUS path, so a video reported either way ends up with the same
 * shape of value in `session_videos.mime_type`.
 */
const DATA_URL_MARKER = ';base64,';

/** How long a signed `local-content` link stays valid — see `PhotoService.LOCAL_VIEW_TTL_SECONDS`'s identical reasoning. */
const LOCAL_VIEW_TTL_SECONDS = 600;

/**
 * View-link support for videos — as of 2026-09-09 ("route kiosk VIDEO
 * uploads through apps/api the same way kiosk PHOTO uploads already work")
 * this mirrors `PhotoService` in both shape AND substance, not just shape:
 * a kiosk video's bytes now land in this API's own Postgres
 * (`video_upload_outbox.content`, written by `addDeviceVideo` below) the
 * instant it is captured, and `VideoUploadWorkerService` — the video twin of
 * `UploadWorkerService` — is what actually pushes it to fs-core afterwards,
 * always through this API's own single default-tenant client. `tenantName`
 * therefore always resolves `undefined` now, for the exact same reason
 * `PhotoService.resolveViewContext`'s doc comment gives for photos: nothing
 * ever uploads a video under a per-device tenant anymore, so resolving one
 * here would look in the wrong namespace even before hitting fs-core's
 * "api_key only handed back once" limitation that doc comment describes.
 *
 * This closes the *other* half of the 2026-09-09 "video isn't viewable"
 * investigation that `resolveViewContext` below (kept for whatever, if
 * anything, still calls it) already closed one half of: previously, a video
 * with no local backup anywhere became permanently unviewable the moment
 * fs-core purged it during its own scan (confirmed live, same investigation
 * that found `PhotoService.resolveViewSource`'s identical bug) — see
 * `resolveViewSource` below.
 */
@Injectable()
export class SessionVideoService extends CommonService<SessionVideo> {
  /**
   * How long a video may sit in a non-terminal scan state before this
   * service gives up waiting for the kiosk to ever report something better.
   *
   * There is no server-side poller for video the way `UploadWorkerService
   * .pollScans` exists for photos (2026-09-09 investigation) — apps/api
   * never uploads a video itself, so the ONLY way `fs_status` ever advances
   * past its upload-time value is a later VIDEO_STATUS event from the
   * kiosk's own local scan poll (`UploadWorker.pollScans` in
   * packages/fs-client). If that kiosk-side poll stalls (process restarted,
   * device gone offline, or the exact "real fs-core purges the file mid-scan"
   * failure `pollScans`' own doc comment describes for photos) no such event
   * ever arrives, and the row sits at its last-known status — typically
   * `SCANNING` — forever. Live-confirmed 2026-09-09: real `session_videos`
   * rows from sessions hours apart were ALL still `SCANNING`, none had ever
   * advanced. 10 minutes mirrors `UploadWorker`'s own `stuckScanWarnMs`
   * default (packages/fs-client) — long enough for a real scan, short
   * enough that the CMS stops showing false hope well within one support
   * conversation.
   */
  private static readonly SCAN_STALE_MS = 10 * 60 * 1000;

  constructor(
    @InjectRepository(SessionVideo)
    repository: Repository<SessionVideo>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
  ) {
    super(repository);
  }

  /**
   * Base64-data-URL decoding for video — see `DATA_URL_MARKER`'s own doc
   * comment for why this cannot just be `PhotoService.decodeDataUrl` with a
   * swapped-in regex. The allowlist check strips any `;codec=...` parameter
   * before comparing (`mimeType.split(';')[0]`) — `ALLOWED_VIDEO_MIME_TYPES`
   * lists bare types (`video/webm`, `video/mp4`) — but the FULL mimetype,
   * codec parameter included, is what gets returned/stored, preserving the
   * same fidelity a real kiosk's `MediaRecorder.mimeType` already has
   * (matching what `session_videos.mime_type` holds for a row reported via
   * the legacy VIDEO_STATUS path).
   */
  private decodeDataUrl(dataUrl: string): { mimeType: string; data: Buffer } {
    const markerIndex = dataUrl.indexOf(DATA_URL_MARKER);
    if (!dataUrl.toLowerCase().startsWith('data:video/') || markerIndex === -1) {
      throw new CustomException(
        'Expected dataUrl to be a base64 video data URL',
        ERROR_CODE.VIDEO_INVALID_DATA_URL,
        HttpStatus.BAD_REQUEST,
      );
    }

    const mimeType = dataUrl.slice('data:'.length, markerIndex).toLowerCase();
    const baseMimeType = mimeType.split(';')[0];
    if (!ALLOWED_VIDEO_MIME_TYPES.includes(baseMimeType)) {
      throw new CustomException(
        `Unsupported video type "${mimeType}"`,
        ERROR_CODE.VIDEO_UNSUPPORTED_MIME_TYPE,
        HttpStatus.BAD_REQUEST,
      );
    }

    const data = Buffer.from(dataUrl.slice(markerIndex + DATA_URL_MARKER.length), 'base64');
    if (data.byteLength === 0) {
      throw new CustomException(
        'Video payload decoded to zero bytes',
        ERROR_CODE.VIDEO_INVALID_DATA_URL,
        HttpStatus.BAD_REQUEST,
      );
    }
    if (data.byteLength > MAX_VIDEO_BYTES) {
      throw new CustomException(
        `Video is ${data.byteLength} bytes, above the ${MAX_VIDEO_BYTES} limit`,
        ERROR_CODE.VIDEO_TOO_LARGE,
        HttpStatus.BAD_REQUEST,
      );
    }

    return { mimeType, data };
  }

  /**
   * The kiosk-path counterpart of `PhotoService.addDevicePhoto` (2026-09-09,
   * "route kiosk VIDEO uploads through apps/api") — a device pushes one
   * recorded video's actual bytes here, authenticated via
   * `DeviceCredentialsGuard` exactly like the photo route. Writes into the
   * same `session_videos`/`video_upload_outbox` tables `VideoUploadWorkerService`
   * drains afterwards, so a kiosk-sourced video is durable and viewable from
   * this API's own Postgres the instant it is captured — never only after
   * fs-core has it, closing the "video isn't viewable" gap this whole task
   * exists for (see this class's own doc comment).
   *
   * `id` is the CALLER's id (`dto.videoId`), not one generated here — the
   * kiosk's own local outbox job id (see `AddDeviceVideoDto`'s own doc
   * comment) — so a duplicate call (a retried request) is a harmless
   * `ON CONFLICT DO UPDATE`/`DO NOTHING`, not a second row. A minimal
   * `sessions` row is upserted first (`ON CONFLICT DO NOTHING`) so
   * `session_videos.session_id`'s FK is satisfied even if this call lands
   * before that session's own SESSION_REPORT — identical reasoning to
   * `PhotoService.addDevicePhoto`'s own create-if-missing-session step.
   *
   * The outbox row is written already `approved_at = now()`: this endpoint's
   * caller (`apps/desktop/src/main/uploads.ts`'s `enqueueSessionVideos`) only
   * ever enqueues a video at the moment its session was already locally
   * approved (see that function's own doc comment), so there is no separate
   * staged-then-approved window the way the web/kiosk photo paths have.
   */
  async addDeviceVideo(
    deviceId: string,
    campaignId: string,
    dto: AddDeviceVideoDto,
  ): Promise<{ videoId: string }> {
    const { mimeType, data } = this.decodeDataUrl(dto.dataUrl);
    const sha256 = createHash('sha256').update(data).digest('hex');
    const year = new Date().getFullYear();
    const ext = mimeType.includes('mp4') ? 'mp4' : 'webm';
    // 2026-09-09 ("đưa vào cùng folder với ảnh của sinh viên đó, để dễ quản
    // lý") — mirrors `PhotoService.addDevicePhoto`'s own identical
    // `students/<CCCD>/...` path exactly, so a student's video lands right
    // alongside their photos on the file-service. Same sanitisation (never
    // trust `identityNumber` verbatim as a path segment) and same
    // `sessions/<id>/...`/`video/<year>/<id>/...` fallback shape when the
    // kiosk sends none.
    const safeIdentity = dto.identityNumber?.replace(/[^\w-]/g, '');
    const virtualPath = safeIdentity
      ? `students/${safeIdentity}/${dto.videoId}.${ext}`
      : `video/${year}/${dto.sessionId}/${dto.videoId}.${ext}`;
    // A video is never retaken at the same id (a redo replaces the whole
    // recording under a fresh id — see AddDeviceVideoDto's own doc comment),
    // so the video's own id is a perfectly good, already-unique idem_key —
    // unlike `upload_outbox.idem_key` for photos, which must be derived from
    // `(sessionId, stepId, attempt)` instead of the photo's own id
    // specifically to survive a real retake sharing that same triple.
    const idemKey = dto.videoId;

    await this.dataSource.transaction(async (manager) => {
      await manager.query(
        `INSERT INTO sessions (id, source, device_id, campaign_id, status)
         VALUES ($1, 'KIOSK', $2, $3, 'IN_PROGRESS')
         ON CONFLICT (id) DO NOTHING`,
        [dto.sessionId, deviceId, campaignId],
      );

      await manager.query(
        `INSERT INTO session_videos (id, session_id, camera_role, mime_type, bytes, sha256, duration_ms, virtual_path)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (id) DO UPDATE SET
           camera_role = EXCLUDED.camera_role,
           mime_type = EXCLUDED.mime_type,
           bytes = EXCLUDED.bytes,
           sha256 = EXCLUDED.sha256,
           duration_ms = EXCLUDED.duration_ms,
           virtual_path = EXCLUDED.virtual_path`,
        [
          dto.videoId,
          dto.sessionId,
          dto.cameraRole ?? null,
          mimeType,
          data.byteLength,
          sha256,
          dto.durationMs ?? null,
          virtualPath,
        ],
      );

      // Recorded evidence, not shareable content — same reasoning as
      // PhotoService.addDevicePhoto's own identical choice.
      const visibility: Visibility = 'private';

      await manager.query(
        `INSERT INTO video_upload_outbox (video_id, idem_key, virtual_path, mime_type, content, visibility, approved_at)
         VALUES ($1, $2, $3, $4, $5, $6, now())
         ON CONFLICT (idem_key) DO NOTHING`,
        [dto.videoId, idemKey, virtualPath, mimeType, data, visibility],
      );
    });

    return { videoId: dto.videoId };
  }

  /**
   * The "no local fallback, fail honestly" variant — superseded by
   * `resolveViewSource` below for `VideoController.viewLink`'s own use, the
   * same relationship `PhotoService.resolveViewContext` has to its own
   * `resolveViewSource` (see that method's doc comment). Kept as a separate
   * method since nothing else in this codebase needs the
   * throws-if-not-on-fs-core variant, but removing it outright was not worth
   * the risk this pass.
   *
   * `tenantName` always resolves `undefined` now (2026-09-09) — see the
   * class doc comment for why a per-device tenant lookup would be actively
   * wrong today, not merely redundant: no video is ever actually stored
   * under one anymore.
   */
  async resolveViewContext(
    videoId: string,
  ): Promise<{ fsFileId: string; tenantName?: string }> {
    const video = await this.findById(videoId);
    if (!video) {
      throw new CustomException(
        'Video not found',
        ERROR_CODE.VIDEO_NOT_FOUND,
        HttpStatus.NOT_FOUND,
      );
    }
    if (!video.fsFileId) {
      throw new CustomException(
        'This video has not reached the file-service yet',
        ERROR_CODE.FILE_STORAGE_NOT_READY,
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    if (video.fsStatus === 'FAILED' || video.fsStatus === 'QUARANTINED') {
      throw new CustomException(
        `This video's file-service copy is ${video.fsStatus} and can no longer be viewed`,
        ERROR_CODE.VIDEO_PROCESSING_FAILED,
        HttpStatus.GONE,
      );
    }

    const staleSince = video.fsStatusAt ?? video.uploadedAt;
    const isStale =
      video.fsStatus !== 'READY' &&
      !!staleSince &&
      Date.now() - staleSince.getTime() > SessionVideoService.SCAN_STALE_MS;
    if (isStale) {
      throw new CustomException(
        `This video has been stuck at "${video.fsStatus}" on the file-service since ${staleSince.toISOString()} — it almost certainly never survived its virus scan and is presumed lost`,
        ERROR_CODE.VIDEO_PROCESSING_FAILED,
        HttpStatus.GONE,
      );
    }

    return { fsFileId: video.fsFileId, tenantName: undefined };
  }

  /**
   * Where `VideoController.viewLink` should actually load a video from
   * (2026-09-09 fix) — the video twin of `PhotoService.resolveViewSource`,
   * closing the exact same gap for the exact same live-confirmed reason: a
   * video whose `fsFileId` is set is NOT necessarily still readable — this
   * real fs-core deployment has been observed purging a file during its own
   * virus scan before ever marking it READY (see `pollScans`'s doc comment
   * on `UploadWorkerService`/`VideoUploadWorkerService`) — and, unique to
   * video, a row can also get stuck at a non-terminal scan state forever if
   * `VideoUploadWorkerService.pollScans` itself stalls (see
   * `SCAN_STALE_MS`'s own doc comment). Both cases, plus a plain
   * `FAILED`/`QUARANTINED`, must fall through to the local copy
   * (`video_upload_outbox.content`) exactly like `PhotoService
   * .resolveViewSource` falls through for photos — `VideoUploadWorkerService
   * .send()`/`pollScans()` deliberately never clear that content except on a
   * confirmed `READY`, mirroring the same-day fix to the photo pipeline's
   * own worker, precisely so this fallback always has something to serve.
   *
   * Throws only when NEITHER the remote copy is healthy NOR any local bytes
   * remain — a video whose row exists (e.g. reported only via a legacy
   * VIDEO_STATUS event, never through `addDeviceVideo`) but whose bytes
   * never reached either place.
   */
  async resolveViewSource(
    videoId: string,
  ): Promise<
    | { kind: 'remote'; fsFileId: string; tenantName?: string }
    | { kind: 'local' }
  > {
    const video = await this.findById(videoId);
    if (!video) {
      throw new CustomException(
        'Video not found',
        ERROR_CODE.VIDEO_NOT_FOUND,
        HttpStatus.NOT_FOUND,
      );
    }

    const staleSince = video.fsStatusAt ?? video.uploadedAt;
    const isStale =
      !!video.fsFileId &&
      video.fsStatus !== 'READY' &&
      !!staleSince &&
      Date.now() - staleSince.getTime() > SessionVideoService.SCAN_STALE_MS;

    if (
      video.fsFileId &&
      video.fsStatus !== 'FAILED' &&
      video.fsStatus !== 'QUARANTINED' &&
      !isStale
    ) {
      // Always the default tenant — see the class doc comment for why a
      // KIOSK session's device id must never be used here.
      return { kind: 'remote', fsFileId: video.fsFileId, tenantName: undefined };
    }

    const rows: Array<{ has_content: boolean }> = await this.dataSource.query(
      `SELECT (content IS NOT NULL AND length(content) > 0) AS has_content
         FROM video_upload_outbox WHERE video_id = $1
        ORDER BY created_at DESC LIMIT 1`,
      [videoId],
    );
    if (rows[0]?.has_content) {
      return { kind: 'local' };
    }

    throw new CustomException(
      'This video has not reached the file-service yet and has no locally stored bytes either',
      ERROR_CODE.FILE_STORAGE_NOT_READY,
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }

  /**
   * A signed, short-lived URL for `VideoContentController`'s unauthenticated
   * `GET :id/local-content` — the exact video counterpart of
   * `PhotoService.issueLocalViewLink`; see that method's own doc comment for
   * why an HMAC token rather than a persisted token table. Signed with a
   * `video:` prefix (see `signLocalViewToken`) so a link minted for a photo
   * can never be replayed against a video id or vice versa, even though both
   * happen to share the same signing secret.
   */
  issueLocalViewLink(
    videoId: string,
    apiBaseUrl: string,
  ): { url: string; expiresAt: string } {
    const exp = Math.floor(Date.now() / 1000) + LOCAL_VIEW_TTL_SECONDS;
    const sig = this.signLocalViewToken(videoId, exp);
    const url = `${apiBaseUrl.replace(/\/$/, '')}/v1/videos/${videoId}/local-content?exp=${exp}&sig=${sig}`;
    return { url, expiresAt: new Date(exp * 1000).toISOString() };
  }

  /** Throws `VIDEO_LOCAL_TOKEN_INVALID` unless `sig`/`exp` are a valid, unexpired pair for `videoId` — see `issueLocalViewLink`. */
  verifyLocalViewTokenOrFail(
    videoId: string,
    expRaw: string,
    sigRaw: string,
  ): void {
    const exp = Number(expRaw);
    const expectedBuf = Buffer.from(
      this.signLocalViewToken(videoId, exp),
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
        ERROR_CODE.VIDEO_LOCAL_TOKEN_INVALID,
        HttpStatus.UNAUTHORIZED,
      );
    }
  }

  private signLocalViewToken(videoId: string, exp: number): string {
    const secret = this.configService.get<string>('security.apiKey') ?? '';
    return createHmac('sha256', secret)
      .update(`video:${videoId}:${exp}`)
      .digest('hex');
  }

  /** Streams straight from `video_upload_outbox.content` — see `resolveViewSource`'s 'local' branch. */
  async readLocalContent(
    videoId: string,
  ): Promise<{ data: Buffer; mimeType: string }> {
    const rows: Array<{ content: Buffer | null; mime_type: string }> =
      await this.dataSource.query(
        `SELECT content, mime_type FROM video_upload_outbox
          WHERE video_id = $1 AND content IS NOT NULL AND length(content) > 0
          ORDER BY created_at DESC LIMIT 1`,
        [videoId],
      );
    if (!rows[0]?.content) {
      throw new CustomException(
        'No locally stored bytes for this video',
        ERROR_CODE.FILE_STORAGE_NOT_READY,
        HttpStatus.NOT_FOUND,
      );
    }
    return { data: rows[0].content, mimeType: rows[0].mime_type };
  }
}
