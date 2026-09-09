import { CustomException } from '@app/common/errors';
import { toDao } from '@app/common/helpers';
import { FileStorageService } from '@app/modules/file-storage/services/file-storage.service';
import { Pagination } from '@app/modules/shared/common/pagination';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import archiver from 'archiver';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { PassThrough } from 'node:stream';
import { DataSource, EntityManager, Repository } from 'typeorm';
import {
  PhotoVariantDao,
  ReviewEventDao,
  ReviewSetDetailDao,
  ReviewSetListItemDao,
  UploadVariantResultDao,
} from '../dao';
import {
  AiEditDto,
  ApproveRejectDto,
  ListEventsQueryDto,
  ListSetsQueryDto,
} from '../dto';
import { PhotoKind } from '../entities/photo-kind.entity';
import { PhotoReviewEvent } from '../entities/photo-review-event.entity';
import { PhotoVariant } from '../entities/photo-variant.entity';
import { SubjectPhotoSet } from '../entities/subject-photo-set.entity';
import {
  ALLOWED_UPLOAD_MIME_TYPES,
  FORBIDDEN_PROMPT_KEYWORDS,
  IDENTITY_SIMILARITY_REJECT_THRESHOLD,
  IDENTITY_SIMILARITY_WARN_THRESHOLD,
  LOCKED_SET_STATUSES,
  MAX_UPLOAD_BYTES,
  PHOTO_REVIEW_ERROR_CODE,
  PhotoReviewAction,
  PhotoReviewSetStatus,
  PhotoVariantKind,
  PhotoVariantStatus,
} from '../photo-review.constants';
import { PhotoKindService } from './photo-kind.service';
import { PhotoReviewSidecarService, SidecarError } from './photo-review-sidecar.service';

/**
 * How long a signed variant `local-content` link stays valid — same value,
 * same reasoning as `PhotoService`'s own `LOCAL_VIEW_TTL_SECONDS` (a short
 * transitional window, good until the next successful
 * `VariantUploadWorkerService` send or the next time this set is reloaded
 * and a fresh link is minted).
 */
const LOCAL_VARIANT_VIEW_TTL_SECONDS = 600;

/** Bytes + content hash, in whichever shape `storeVariantBytesLocalFirst` needs to hand back to its callers — no `fsFileId` here, unlike the old `uploadCardBytes` this replaces: that id is not known yet at write time (see that method's own doc comment). */
interface StoredVariantBytesResult {
  bytes: number;
  sha256: string;
}

/** Minimal shape read straight off the `photos` table (capture module) — see this module's own cross-module-boundary note below. */
interface FrontSourcePhoto {
  id: string;
  fsFileId: string | null;
  mimeType: string;
}

/** Minimal shape read straight off the `sessions` table. */
interface SessionContext {
  tenantName?: string;
  year: number;
}

/** A very small (16-byte) 1x1 JPEG-ish sniff is not attempted — MIME + size only, matching `PhotoService.addPhoto`'s own validation depth for this pass. */
const uploadedFileMimeAllowed = (mimeType: string) => ALLOWED_UPLOAD_MIME_TYPES.includes(mimeType.toLowerCase());

/**
 * Extracts a real diagnostic message from anything this module's sidecar
 * call sites (`reprocess`/`aiEdit`/`uploadVariant`) can catch —
 * `SidecarError` and `CustomException` (e.g. `FileStorageService`'s own
 * throws, hit when `readSourcePhotoBytes`/`fetchBytesFromFileStorage` falls
 * back to fs-core) both carry their real text somewhere OTHER than the
 * plain `.message` a generic `catch` would read.
 *
 * `CustomException.message` specifically is NOT the message it was
 * constructed with, for every `CustomException` anywhere in this app: Nest's
 * own `HttpException` only populates `.message` from a string response or a
 * `.message` key on an object response, and `CustomException` passes
 * `{ error }` to it (see that class's own constructor) — so `.message`
 * silently reads back as the generic "Custom Exception" (Nest's fallback,
 * derived from the constructor's class name) instead of the real text,
 * which only ever lands on `.payload.error`. Confirmed live during this
 * task's own end-to-end verification (an AUTO_FAILED variant's `note` read
 * literally "Custom Exception" until this fix). A genuine, pre-existing bug
 * in the shared `CustomException` class — worked around here rather than
 * fixed at the source, to keep this task's changes scoped to the
 * photo-review module; worth a follow-up across the rest of the app, where
 * the same silent-message-loss can happen anywhere a `CustomException` is
 * caught and logged rather than left to the global exception filter (which
 * reads the response object directly, not `.message`, so this bug never
 * reaches an actual HTTP response).
 */
function extractSidecarFailureMessage(error: unknown): string {
  if (error instanceof SidecarError) return error.message;
  if (error instanceof CustomException) return error.payload?.error ?? error.message;
  return (error as Error)?.message ?? String(error);
}

/**
 * Core service for the "Duyệt ảnh" (photo review) module —
 * docs/plans/cms-photo-review-plan.md. Owns every state-changing action in
 * §7's API table except `photo_kinds` CRUD (see `PhotoKindService`), and
 * writes a `PhotoReviewEvent` on every one of them (plan §2's audit-trail
 * requirement — "Bắt buộc cho mọi hành động").
 *
 * **Module boundary, important**: this service must not structurally
 * depend on `device-management` (`campaigns`) or `capture`
 * (`sessions`/`photos`/`session_videos`) — both are owned/edited by other
 * agents concurrently (see this module's task brief). Every read against
 * those tables here goes through plain SQL against the table name, exactly
 * the pattern `SessionService`/`StudentService`/`CampaignService` already
 * use in this codebase for cross-boundary reads of tables they do not own
 * either (e.g. `CampaignService.countCompletedSessions` reads `sessions`
 * directly). No entity or service from those modules is imported.
 */
@Injectable()
export class PhotoReviewService {
  private readonly logger = new Logger(PhotoReviewService.name);

  constructor(
    @InjectRepository(SubjectPhotoSet)
    private readonly setRepository: Repository<SubjectPhotoSet>,
    @InjectRepository(PhotoVariant)
    private readonly variantRepository: Repository<PhotoVariant>,
    @InjectRepository(PhotoKind)
    private readonly photoKindRepository: Repository<PhotoKind>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly fileStorage: FileStorageService,
    private readonly sidecar: PhotoReviewSidecarService,
    private readonly photoKindService: PhotoKindService,
    private readonly configService: ConfigService,
  ) {}

  // ── Locking (plan §4) ──────────────────────────────────────────────────

  /**
   * Every mutating action EXCEPT `reprocess` goes through this first. Kept
   * as one small method rather than repeated per handler, per the task
   * brief's explicit instruction to centralise the check.
   */
  private assertUnlocked(set: SubjectPhotoSet): void {
    if (LOCKED_SET_STATUSES.has(set.status) || !set.currentCardVariantId) {
      throw new CustomException(
        `Set is locked (status=${set.status}, currentCardVariantId=${set.currentCardVariantId ?? 'null'}) — every action except "reprocess" is blocked until an initial CARD_AUTO variant is READY`,
        PHOTO_REVIEW_ERROR_CODE.SET_LOCKED,
        HttpStatus.CONFLICT,
      );
    }
  }

  // ── Lookups ──────────────────────────────────────────────────────────

  private async findSetEntityOrFail(id: string): Promise<SubjectPhotoSet> {
    const set = await this.setRepository.findOne({ where: { id } });
    if (!set) {
      throw new CustomException('Photo review set not found', PHOTO_REVIEW_ERROR_CODE.SET_NOT_FOUND, HttpStatus.NOT_FOUND);
    }
    return set;
  }

  private async findVariantEntityOrFail(id: string): Promise<PhotoVariant> {
    const variant = await this.variantRepository.findOne({ where: { id } });
    if (!variant) {
      throw new CustomException(
        'Photo variant not found',
        PHOTO_REVIEW_ERROR_CODE.VARIANT_NOT_FOUND,
        HttpStatus.NOT_FOUND,
      );
    }
    return variant;
  }

  /**
   * Tenant + year for a session — tenant is now always `undefined` (this
   * API's own already-configured default tenant), including for a
   * KIOSK-sourced session. This used to resolve the session's device id as
   * a per-device fs-core tenant (mirroring `PhotoService.resolveViewContext`
   * before its own 2026-09-09 fix — see that method's doc comment for the
   * full reasoning), on the theory that a kiosk subject's source photo AND
   * generated card variant should live under that device's own namespace.
   * Neither half of that held up:
   *
   *  - The source photo is uploaded exclusively by `UploadWorkerService.send()`
   *    (`capture` module), which always uses this API's single default-tenant
   *    client — never a per-device one — so `readSourcePhotoBytes`'s fs-core
   *    fallback was resolving a tenant the photo was never actually stored
   *    under.
   *  - The generated CARD_AUTO/CARD_AI variant is produced by THIS module's
   *    own sidecar call and pushed by `VariantUploadWorkerService` — nothing
   *    the kiosk device itself ever touches — so there was no correctness
   *    reason to route it through a per-device tenant either.
   *
   * And even where a per-device tenant genuinely is correct (a kiosk-uploaded
   * VIDEO — see `SessionVideoService.resolveViewContext`, untouched by this
   * fix), `FileStorageService.clientForTenant` cannot reliably serve it:
   * fs-core's real `/api/v1/self-service/provision` (confirmed live
   * 2026-09-09) only ever returns an `api_key` the very first time a tenant
   * is created; every later call — the only case that matters once a device
   * has already self-provisioned, which every real kiosk does at first boot
   * (`apps/desktop/src/main/secrets.ts`) — returns `created: false` and no
   * `api_key` at all, and apps/api stores no per-device key to fall back on.
   * That is exactly what surfaced here as `photo_variants.note` reading
   * "provision succeeded but returned no api_key" on every `reprocess()` for
   * a KIOSK session's subject.
   *
   * `device_id` is no longer read as a result — kept as plain SQL against
   * `sessions` (cross-module-boundary read, see the class doc comment)
   * rather than importing anything from `capture`.
   */
  private async resolveSessionContext(sessionId: string): Promise<SessionContext> {
    const rows: Array<{ at: Date }> = await this.dataSource.query(
      `SELECT COALESCE(captured_at, created_at) AS at FROM sessions WHERE id = $1`,
      [sessionId],
    );
    const row = rows[0];
    if (!row) {
      throw new CustomException(
        'Source session not found',
        PHOTO_REVIEW_ERROR_CODE.SESSION_NOT_FOUND,
        HttpStatus.NOT_FOUND,
      );
    }
    return {
      tenantName: undefined,
      year: new Date(row.at).getFullYear(),
    };
  }

  /** Batch version of `resolveSessionContext`, tenant only — see that method's own doc comment for why this is always `undefined` now. Kept (rather than deleted outright) so `listSets`/`getSetDetail` don't need to change shape. */
  private async batchResolveTenants(sessionIds: string[]): Promise<Map<string, string | undefined>> {
    const map = new Map<string, string | undefined>();
    for (const id of sessionIds) map.set(id, undefined);
    return map;
  }

  /**
   * The original "chụp thẳng" (FRONT) photo for a session — fed to the
   * sidecar as the card-photo/identity-comparison source (plan §3/§5.4).
   * Falls back to the earliest photo of the session when no step is
   * explicitly tagged FRONT, so this still works for a workflow that only
   * has custom step ids.
   */
  private async findFrontSourcePhoto(sessionId: string): Promise<FrontSourcePhoto | null> {
    const rows: Array<{ id: string; fs_file_id: string | null; mime_type: string }> = await this.dataSource.query(
      `SELECT id, fs_file_id, mime_type FROM photos
        WHERE session_id = $1 AND (step_type = 'FRONT' OR step_id ILIKE '%front%')
        ORDER BY attempt DESC LIMIT 1`,
      [sessionId],
    );
    if (rows[0]) {
      return { id: rows[0].id, fsFileId: rows[0].fs_file_id, mimeType: rows[0].mime_type };
    }
    const fallback: Array<{ id: string; fs_file_id: string | null; mime_type: string }> = await this.dataSource.query(
      `SELECT id, fs_file_id, mime_type FROM photos WHERE session_id = $1 ORDER BY created_at ASC LIMIT 1`,
      [sessionId],
    );
    return fallback[0] ? { id: fallback[0].id, fsFileId: fallback[0].fs_file_id, mimeType: fallback[0].mime_type } : null;
  }

  private extForMime(mimeType: string): string {
    return mimeType.toLowerCase() === 'image/png' ? 'png' : 'jpg';
  }

  /**
   * Resolves actual bytes for a source `photos` row, for handing to the AI
   * sidecar (which only ever accepts base64 bytes — see
   * `PhotoReviewSidecarService`'s own doc comment, "the sidecar has no
   * url-fetching code anywhere").
   *
   * Prefers `upload_outbox.content` — Part A of the "route kiosk photo
   * uploads through apps/api" work put real bytes there immediately, in
   * this same Postgres instance, well before fs-core has anything, which is
   * exactly what lets `ensureSetForApprovedSession`'s auto-trigger (see
   * `DeviceEventService.recordBatch`) run its first `CARD_AUTO` the instant
   * a session is approved rather than waiting on any upload to complete.
   * Falls back to a short-lived fs-core view-link + HTTP fetch when the
   * outbox has already cleared `content` (a normal completed upload — see
   * `UploadWorkerService.send()`, which blanks `content` once fs-core has
   * confirmed the bytes) or never had a row at all (a photo captured before
   * Part A landed, or a web-path photo whose outbox row was pruned).
   *
   * Raw SQL against `upload_outbox` — same cross-module-boundary pattern as
   * every other read in this service (see the class doc comment): that
   * table belongs to the `capture` module, which this module must not
   * structurally depend on.
   */
  private async readSourcePhotoBytes(
    photo: FrontSourcePhoto,
    tenantName?: string,
  ): Promise<Buffer> {
    const rows: Array<{ content: Buffer | null }> = await this.dataSource.query(
      `SELECT content FROM upload_outbox
        WHERE photo_id = $1 AND content IS NOT NULL AND length(content) > 0
        ORDER BY created_at DESC LIMIT 1`,
      [photo.id],
    );
    if (rows[0]?.content) {
      return rows[0].content;
    }

    if (!photo.fsFileId) {
      throw new SidecarError(
        'Source photo has no bytes available yet — not staged locally, and not yet uploaded to the file-service',
      );
    }
    return this.fetchBytesFromFileStorage(photo.fsFileId, tenantName);
  }

  /** Bytes for an fs-core file id directly — used once a caller already knows nothing local is available (see `readVariantBytes`/`readSourcePhotoBytes`, which both prefer local bytes first and fall back to this only when the local row has cleared its content or never had one). */
  private async fetchBytesFromFileStorage(fsFileId: string, tenantName?: string): Promise<Buffer> {
    const link = await this.fileStorage.issueViewLink(fsFileId, 'photo-review-sidecar', tenantName);
    const res = await fetch(link.url);
    if (!res.ok) {
      throw new SidecarError(`Failed to fetch bytes from the file-service: HTTP ${res.status}`);
    }
    return Buffer.from(await res.arrayBuffer());
  }

  /**
   * Resolves bytes for an EXISTING `photo_variants` row — the local-first
   * counterpart of `readSourcePhotoBytes` above, same preference order:
   * `variant_upload_outbox.content` (written the instant the variant's
   * bytes were produced, regardless of whether fs-core has confirmed the
   * upload yet — see `storeVariantBytesLocalFirst`) before a view-link + HTTP
   * fetch off fs-core, which only ever applies once the local row has
   * cleared its content (`VariantUploadWorkerService.send()` blanks it after
   * a confirmed upload) or never had one (a variant created before this
   * local-first path existed).
   *
   * Used by `aiEdit` to read the variant being edited FROM — this is what
   * lets an AI edit start from a variant that is fully READY and viewable
   * but has not reached fs-core yet (fs-core down, or just not its turn in
   * the cron queue), instead of wrongly requiring `fsFileId` to be set
   * first.
   */
  private async readVariantBytes(variant: PhotoVariant, tenantName?: string): Promise<Buffer> {
    const rows: Array<{ content: Buffer | null }> = await this.dataSource.query(
      `SELECT content FROM variant_upload_outbox
        WHERE variant_id = $1 AND content IS NOT NULL AND length(content) > 0
        ORDER BY created_at DESC LIMIT 1`,
      [variant.id],
    );
    if (rows[0]?.content) {
      return rows[0].content;
    }
    if (!variant.fsFileId) {
      throw new SidecarError(
        'Source variant has no bytes available yet — not staged locally, and not yet uploaded to the file-service',
      );
    }
    return this.fetchBytesFromFileStorage(variant.fsFileId, tenantName);
  }

  /** Cheap existence check backing both `readVariantBytes`'s callers (the `aiEdit` "is this variant usable as a source" gate) and `toVariantDao`'s view-link fallback — a `SELECT content` without materialising it into JS would still ship the whole `bytea` value over the wire, so this asks Postgres for just the boolean instead. */
  private async hasLocalVariantContent(variantId: string): Promise<boolean> {
    const rows: Array<{ has_content: boolean }> = await this.dataSource.query(
      `SELECT (content IS NOT NULL AND length(content) > 0) AS has_content
         FROM variant_upload_outbox WHERE variant_id = $1
        ORDER BY created_at DESC LIMIT 1`,
      [variantId],
    );
    return Boolean(rows[0]?.has_content);
  }

  /**
   * Local-first bytes write for a `photo_variants` row — the direct
   * counterpart of `PhotoService.addPhoto`'s `upload_outbox` insert: bytes
   * land in `variant_upload_outbox` in the SAME transaction as the caller's
   * own variant write (`manager` is shared), so the variant image is
   * durably stored and immediately viewable
   * (`resolveVariantViewSource`/`VariantContentController`) before, and
   * regardless of whether, the push to fs-core ever succeeds.
   *
   * Replaces the old `uploadCardBytes`, which uploaded to fs-core
   * SYNCHRONOUSLY and blocked the caller's own success on that call
   * succeeding — exactly the failure mode this task exists to close (with
   * `FS_API_KEY` currently stale, every `reprocess`/`aiEdit`/`uploadVariant`
   * call used to end in `AUTO_FAILED`/an uncaught 500, even though the
   * sidecar had already produced a perfectly good image). The actual fs-core
   * upload is now entirely `VariantUploadWorkerService`'s job, draining this
   * table in the background exactly like `UploadWorkerService` already does
   * for `upload_outbox` — this method never calls fs-core at all, so it
   * cannot fail on fs-core's account; `fsFileId` on the variant stays null
   * until the cron confirms the upload.
   */
  private async storeVariantBytesLocalFirst(
    manager: EntityManager,
    input: {
      variantId: string;
      tenantName?: string;
      virtualPath: string;
      mimeType: string;
      data: Buffer;
      idempotencyKey: string;
    },
  ): Promise<StoredVariantBytesResult> {
    const sha256 = createHash('sha256').update(input.data).digest('hex');
    await manager.query(
      `INSERT INTO variant_upload_outbox (variant_id, idem_key, virtual_path, mime_type, content, tenant_name)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (idem_key) DO NOTHING`,
      [
        input.variantId,
        input.idempotencyKey,
        input.virtualPath,
        input.mimeType,
        input.data,
        input.tenantName ?? null,
      ],
    );
    return { bytes: input.data.byteLength, sha256 };
  }

  /**
   * Where to load a variant's card image from for viewing — the variant
   * counterpart of `PhotoService.resolveViewSource`: the real fs-core link
   * once `fsFileId` is set AND reachable, or a signal to fall back to this
   * API's own locally held bytes (`variant_upload_outbox.content`) when it
   * is not. Unlike `PhotoService.resolveViewSource`, this ALSO falls back to
   * local bytes when `fsFileId` is set but the fs-core call itself fails
   * (e.g. a later outage after a successful upload, or — the scenario this
   * task's own verification exercised — `FS_API_KEY` going stale) as long as
   * the local row has not yet cleared its content; `PhotoController`'s photo
   * path does not need this extra branch because a photo's `content` is
   * blanked the moment `fs_file_id` is confirmed, same as here, so in
   * practice this only ever helps in the narrow window where both still
   * happen to be true. Returns `{ kind: 'none' }` rather than throwing —
   * every caller here is a best-effort DAO field, not a hard requirement
   * (mirrors this module's existing `try/catch` around every `issueViewLink`
   * call, e.g. `toVariantDao`'s own original body).
   *
   * `fsFileId` alone is NOT enough to trust the remote copy (2026-09-09
   * fix, same reasoning as `PhotoService.resolveViewSource`'s own fix) —
   * `VariantUploadWorkerService.send()` sets it from the upload response
   * BEFORE the file has actually survived fs-core's own scan, and this real
   * fs-core deployment has been observed purging a file during that scan
   * (live-confirmed: variant `de2db48a-3563-45cd-b10e-cf1ba9e1e535`'s
   * `fs_file_id` now 404s on `getFile`). `fsStatus` is what that service's
   * `pollScans()` sets to `'FAILED'` once that happens — a non-healthy
   * status (`'FAILED'`/`'QUARANTINED'`) must fall through to the same
   * local-content check a missing `fsFileId` already gets, exactly like
   * `resolveCurrentCardViewUrl` below already does for the "current card"
   * views.
   */
  private async resolveVariantViewSource(
    variant: PhotoVariant,
  ): Promise<
    | { kind: 'remote'; fsFileId: string }
    | { kind: 'local' }
    | { kind: 'none' }
  > {
    if (variant.fsFileId && variant.fsStatus !== 'FAILED' && variant.fsStatus !== 'QUARANTINED') {
      return { kind: 'remote', fsFileId: variant.fsFileId };
    }
    if (await this.hasLocalVariantContent(variant.id)) {
      return { kind: 'local' };
    }
    return { kind: 'none' };
  }

  /**
   * A signed, short-lived URL for `VariantContentController`'s
   * unauthenticated `GET /v1/review/variants/:id/local-content` — the
   * variant counterpart of `PhotoService.issueLocalViewLink`/
   * `verifyLocalViewTokenOrFail`/`readLocalContent`, mirrored here rather
   * than imported: those are private instance methods on `PhotoService`
   * (owned by `CaptureModule`, which this module must not import — see this
   * class's own top doc comment), not exported utilities, so reusing them
   * would mean either exporting crypto helpers off a controller-adjacent
   * service for one other caller or reaching into `CaptureModule` from here.
   * A direct, isolated mirror (signing `variant:<id>:<exp>` instead of
   * `<id>:<exp>`, so a link minted for one route can never be replayed
   * against the other even though both share the same `API_KEY` secret) is
   * simpler and keeps this module's existing "duplicate small things rather
   * than couple modules" convention (see `resolveSessionContext` etc.).
   */
  private issueLocalVariantViewLink(
    variantId: string,
    apiBaseUrl: string,
  ): { url: string; expiresAt: string } {
    const exp = Math.floor(Date.now() / 1000) + LOCAL_VARIANT_VIEW_TTL_SECONDS;
    const sig = this.signLocalVariantViewToken(variantId, exp);
    const url = `${apiBaseUrl.replace(/\/$/, '')}/v1/review/variants/${variantId}/local-content?exp=${exp}&sig=${sig}`;
    return { url, expiresAt: new Date(exp * 1000).toISOString() };
  }

  /** Throws `VARIANT_LOCAL_TOKEN_INVALID` unless `sig`/`exp` are a valid, unexpired pair for `variantId` — see `issueLocalVariantViewLink`. Called by `VariantContentController`. */
  verifyLocalVariantViewTokenOrFail(variantId: string, expRaw: string, sigRaw: string): void {
    const exp = Number(expRaw);
    const expectedBuf = Buffer.from(this.signLocalVariantViewToken(variantId, exp), 'hex');
    const gotBuf = sigRaw ? Buffer.from(sigRaw, 'hex') : Buffer.alloc(0);
    const valid =
      Number.isFinite(exp) &&
      exp >= Math.floor(Date.now() / 1000) &&
      expectedBuf.length === gotBuf.length &&
      expectedBuf.length > 0 &&
      timingSafeEqual(expectedBuf, gotBuf);
    if (!valid) {
      throw new CustomException(
        'This local-content link is invalid or has expired — reload the set to get a fresh one',
        PHOTO_REVIEW_ERROR_CODE.VARIANT_LOCAL_TOKEN_INVALID,
        HttpStatus.UNAUTHORIZED,
      );
    }
  }

  private signLocalVariantViewToken(variantId: string, exp: number): string {
    const secret = this.configService.get<string>('security.apiKey') ?? '';
    return createHmac('sha256', secret).update(`variant:${variantId}:${exp}`).digest('hex');
  }

  /** Streams straight from `variant_upload_outbox.content` — see `resolveVariantViewSource`'s 'local' branch. Called by `VariantContentController`. */
  async readLocalVariantContent(variantId: string): Promise<{ data: Buffer; mimeType: string }> {
    const rows: Array<{ content: Buffer | null; mime_type: string }> = await this.dataSource.query(
      `SELECT content, mime_type FROM variant_upload_outbox
        WHERE variant_id = $1 AND content IS NOT NULL AND length(content) > 0
        ORDER BY created_at DESC LIMIT 1`,
      [variantId],
    );
    if (!rows[0]?.content) {
      throw new CustomException(
        'No locally stored bytes for this variant',
        PHOTO_REVIEW_ERROR_CODE.VARIANT_NOT_VIEWABLE,
        HttpStatus.NOT_FOUND,
      );
    }
    return { data: rows[0].content, mimeType: rows[0].mime_type };
  }

  private buildVirtualPath(sessionId: string, year: number, prefix: string, version: number, ext: string): string {
    return `card/${year}/${sessionId}/${prefix}-v${version}.${ext}`;
  }

  /** Best-effort sidecar metadata file next to the image (plan §3: `auto-v1.json`/`ai-v2.json`) — never fails the caller's own flow. */
  private async uploadMetadataBestEffort(input: {
    tenantName?: string;
    virtualPath: string;
    metadata: Record<string, unknown>;
    idempotencyKey: string;
  }): Promise<void> {
    try {
      const data = Buffer.from(JSON.stringify(input.metadata, null, 2), 'utf8');
      const uploadInput = {
        virtualPath: input.virtualPath,
        mimeType: 'application/json',
        data,
        idempotencyKey: input.idempotencyKey,
        visibility: 'private' as const,
      };
      if (input.tenantName) {
        await (await this.fileStorage.clientForTenant(input.tenantName)).uploadRaw(uploadInput);
      } else {
        await this.fileStorage.uploadRaw(uploadInput);
      }
    } catch (error) {
      this.logger.warn(`best-effort metadata upload failed for ${input.virtualPath}: ${(error as Error).message}`);
    }
  }

  private async lockSet(manager: EntityManager, id: string): Promise<SubjectPhotoSet> {
    const set = await manager.getRepository(SubjectPhotoSet).findOne({
      where: { id },
      lock: { mode: 'pessimistic_write' },
    });
    if (!set) {
      throw new CustomException('Photo review set not found', PHOTO_REVIEW_ERROR_CODE.SET_NOT_FOUND, HttpStatus.NOT_FOUND);
    }
    return set;
  }

  private async nextVersion(manager: EntityManager, setId: string): Promise<number> {
    const rows: Array<{ next: number }> = await manager.query(
      `SELECT COALESCE(MAX(version), 0) + 1 AS next FROM photo_variants WHERE set_id = $1`,
      [setId],
    );
    return rows[0]?.next ?? 1;
  }

  private async writeEvent(
    manager: EntityManager,
    input: {
      setId: string;
      variantId?: string | null;
      action: PhotoReviewAction;
      actorUserId?: string | null;
      payload?: Record<string, unknown> | null;
    },
  ): Promise<void> {
    const repo = manager.getRepository(PhotoReviewEvent);
    await repo.save(
      repo.create({
        setId: input.setId,
        variantId: input.variantId ?? null,
        action: input.action,
        actorUserId: input.actorUserId ?? null,
        payload: input.payload ?? null,
        at: new Date(),
      }),
    );
  }

  /**
   * `viewUrl` resolution for one variant, shown to the CMS (plan §5.2's
   * detail page, "Phiên bản"/"Ảnh thẻ hiện tại" panels) — per this task's
   * product ask ("chỉ cần hiển thị ảnh", the review side must never surface
   * whether a card photo has reached fs-core yet), this ALWAYS resolves to
   * a real, loadable URL whenever the variant has bytes ANYWHERE (fs-core or
   * still-local), and only ever omits `viewUrl` when the variant genuinely
   * has no bytes yet (`PROCESSING`, or `FAILED` with nothing produced) — see
   * `resolveVariantViewSource`.
   */
  private async toVariantDao(
    variant: PhotoVariant,
    apiBaseUrl: string,
    tenantName?: string,
  ): Promise<PhotoVariantDao> {
    const dao = toDao(PhotoVariantDao, variant);
    const source = await this.resolveVariantViewSource(variant);
    if (source.kind === 'remote') {
      try {
        const link = await this.fileStorage.issueViewLink(source.fsFileId, 'photo-review', tenantName);
        dao.viewUrl = link.url;
        dao.viewUrlExpiresAt = link.expiresAt;
        return dao;
      } catch (error) {
        this.logger.warn(`view-link failed for variant ${variant.id}: ${(error as Error).message}`);
        // Fall through: fs-core rejected/failed the request (e.g. a stale
        // FS_API_KEY) even though this variant has an fsFileId — try the
        // local fallback below before giving up, same "show SOMETHING"
        // principle `resolveVariantViewSource`'s own doc comment explains.
        if (await this.hasLocalVariantContent(variant.id)) {
          const local = this.issueLocalVariantViewLink(variant.id, apiBaseUrl);
          dao.viewUrl = local.url;
          dao.viewUrlExpiresAt = local.expiresAt;
        }
        return dao;
      }
    }
    if (source.kind === 'local') {
      const local = this.issueLocalVariantViewLink(variant.id, apiBaseUrl);
      dao.viewUrl = local.url;
      dao.viewUrlExpiresAt = local.expiresAt;
    }
    return dao;
  }

  /**
   * `currentCardViewUrl` resolution shared by `listSets`, `getSetDetail`,
   * and `toSetListItemDao` — same "always resolve to a real URL whenever
   * bytes exist anywhere" rule as `toVariantDao`, just working off a plain
   * `(variantId, fsFileId, fsStatus)` tuple instead of a loaded
   * `PhotoVariant` entity (these three call sites all read the current
   * variant's `fs_file_id`/`fs_status` off a raw SQL join rather than a full
   * entity load, so there is no `variant` object to hand
   * `toVariantDao`/`resolveVariantViewSource` here).
   *
   * `fsStatus` gate (2026-09-09 fix) — same reasoning as
   * `resolveVariantViewSource`'s own fix just above: `fsFileId` alone only
   * means "accepted by fs-core," not "still there." Before this fix, a
   * `'FAILED'`/`'QUARANTINED'` current variant still attempted
   * `issueViewLink` first — usually harmless (that call's own
   * `waitUntilReady` eventually times out and this falls through to local
   * content in the `catch` below regardless), but pointlessly slow (up to
   * its 30s timeout) for a variant already KNOWN dead, and — the case that
   * actually matters — that fallback is only possible at all because
   * `VariantUploadWorkerService.send()`/`pollScans()` (this same day's
   * pairing fix) now leave local content in place for exactly this state;
   * checking `fsStatus` up front is what makes the "known dead, skip
   * straight to local" path fast instead of merely eventually-correct.
   */
  private async resolveCurrentCardViewUrl(
    variantId: string | null | undefined,
    fsFileId: string | null | undefined,
    fsStatus: string | null | undefined,
    apiBaseUrl: string,
    tenantName?: string,
  ): Promise<{ url?: string; expiresAt?: string }> {
    if (!variantId) return {};
    if (fsFileId && fsStatus !== 'FAILED' && fsStatus !== 'QUARANTINED') {
      try {
        const link = await this.fileStorage.issueViewLink(fsFileId, 'photo-review', tenantName);
        return { url: link.url, expiresAt: link.expiresAt };
      } catch (error) {
        this.logger.warn(`current-card view-link failed for variant ${variantId}: ${(error as Error).message}`);
      }
    }
    if (await this.hasLocalVariantContent(variantId)) {
      const local = this.issueLocalVariantViewLink(variantId, apiBaseUrl);
      return { url: local.url, expiresAt: local.expiresAt };
    }
    return {};
  }

  // ── GET /v1/review/sets ─────────────────────────────────────────────

  async listSets(query: ListSetsQueryDto, apiBaseUrl: string): Promise<Pagination<ReviewSetListItemDao>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const offset = (page - 1) * limit;

    const conditions: string[] = [];
    const params: unknown[] = [];
    if (query.campaignId) {
      params.push(query.campaignId);
      conditions.push(`s.campaign_id = $${params.length}`);
    }
    if (query.kindId) {
      params.push(query.kindId);
      conditions.push(`s.kind_id = $${params.length}`);
    }
    if (query.status) {
      params.push(query.status);
      conditions.push(`s.status = $${params.length}`);
    }
    if (query.missingCard === true) conditions.push('s.current_card_variant_id IS NULL');
    if (query.missingCard === false) conditions.push('s.current_card_variant_id IS NOT NULL');
    if (query.q) {
      params.push(`%${query.q}%`);
      conditions.push(`(s.subject_code ILIKE $${params.length} OR s.subject_name ILIKE $${params.length})`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const outerConditions: string[] = [];
    if (query.hasAi === true) outerConditions.push('has_ai = true');
    if (query.hasAi === false) outerConditions.push('has_ai = false');
    if (query.hasUpload === true) outerConditions.push('has_upload = true');
    if (query.hasUpload === false) outerConditions.push('has_upload = false');
    const outerWhere = outerConditions.length ? `WHERE ${outerConditions.join(' AND ')}` : '';

    const cte = `
      WITH agg AS (
        SELECT
          s.id, s.campaign_id, s.subject_code, s.subject_name, s.kind_id, k.code AS kind_code,
          s.source_session_id, s.status, s.current_card_variant_id, s.created_at, s.updated_at,
          cv.fs_file_id AS current_fs_file_id,
          cv.fs_status AS current_fs_status,
          EXISTS (SELECT 1 FROM photo_variants v WHERE v.set_id = s.id AND v.kind = 'CARD_AI' AND v.status <> 'DISCARDED') AS has_ai,
          EXISTS (SELECT 1 FROM photo_variants v WHERE v.set_id = s.id AND v.kind = 'CARD_UPLOAD' AND v.status <> 'DISCARDED') AS has_upload
        FROM subject_photo_sets s
        LEFT JOIN photo_kinds k ON k.id = s.kind_id
        LEFT JOIN photo_variants cv ON cv.id = s.current_card_variant_id
        ${where}
      )
      SELECT * FROM agg ${outerWhere}
    `;

    const countRows: Array<{ count: number }> = await this.dataSource.query(
      `SELECT COUNT(*)::int AS count FROM (${cte}) t`,
      params,
    );
    const totalItems = countRows[0]?.count ?? 0;

    const rows: Array<Record<string, unknown>> = await this.dataSource.query(
      `${cte} ORDER BY updated_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset],
    );

    const tenantMap = await this.batchResolveTenants([
      ...new Set(rows.map((r) => r.source_session_id as string)),
    ]);

    const links = await Promise.all(
      rows.map((row) =>
        this.resolveCurrentCardViewUrl(
          row.current_card_variant_id as string | null,
          row.current_fs_file_id as string | null,
          row.current_fs_status as string | null,
          apiBaseUrl,
          tenantMap.get(row.source_session_id as string),
        ),
      ),
    );

    const items = toDao(
      ReviewSetListItemDao,
      rows.map((row, i) => ({
        id: row.id,
        campaignId: row.campaign_id,
        subjectCode: row.subject_code,
        subjectName: row.subject_name ?? undefined,
        kindId: row.kind_id,
        kindCode: row.kind_code ?? undefined,
        sourceSessionId: row.source_session_id,
        status: row.status,
        currentCardVariantId: row.current_card_variant_id ?? undefined,
        currentCardViewUrl: links[i]?.url,
        currentCardViewUrlExpiresAt: links[i]?.expiresAt,
        hasAi: row.has_ai,
        hasUpload: row.has_upload,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
    );

    return new Pagination(items, {
      itemCount: items.length,
      totalItems,
      itemsPerPage: limit,
      totalPages: Math.max(1, Math.ceil(totalItems / limit)),
      currentPage: page,
    });
  }

  // ── GET /v1/review/sets/:id ──────────────────────────────────────────

  async getSetDetail(id: string, apiBaseUrl: string): Promise<ReviewSetDetailDao> {
    const rows: Array<Record<string, unknown>> = await this.dataSource.query(
      `SELECT s.id, s.campaign_id, s.subject_code, s.subject_name, s.kind_id, k.code AS kind_code,
              s.source_session_id, s.status, s.current_card_variant_id, s.created_at, s.updated_at
         FROM subject_photo_sets s
         LEFT JOIN photo_kinds k ON k.id = s.kind_id
        WHERE s.id = $1`,
      [id],
    );
    const row = rows[0];
    if (!row) {
      throw new CustomException('Photo review set not found', PHOTO_REVIEW_ERROR_CODE.SET_NOT_FOUND, HttpStatus.NOT_FOUND);
    }

    const sessionId = row.source_session_id as string;
    const tenantMap = await this.batchResolveTenants([sessionId]);
    const tenantName = tenantMap.get(sessionId);

    const [photoRows, videoRows, variantRows, eventRows]: [
      Array<Record<string, unknown>>,
      Array<Record<string, unknown>>,
      PhotoVariant[],
      Array<Record<string, unknown>>,
    ] = await Promise.all([
      this.dataSource.query(
        `SELECT id, step_id, step_type, camera_role, attempt, mime_type, fs_file_id, fs_status, captured_at
           FROM photos WHERE session_id = $1 ORDER BY step_id, attempt`,
        [sessionId],
      ),
      this.dataSource.query(
        `SELECT id, camera_role, mime_type, duration_ms, fs_file_id, fs_status
           FROM session_videos WHERE session_id = $1 ORDER BY camera_role`,
        [sessionId],
      ),
      this.variantRepository.find({
        where: { setId: id },
        order: { version: 'DESC' },
      }),
      this.dataSource.query(
        `SELECT e.id, e.set_id, e.variant_id, e.action, e.actor_user_id, e.payload, e.at, u.email AS actor_email
           FROM photo_review_events e
           LEFT JOIN users u ON u.id = e.actor_user_id
          WHERE e.set_id = $1
          ORDER BY e.at DESC
          LIMIT 50`,
        [id],
      ),
    ]);

    const nonDiscardedVariants = variantRows.filter((v) => v.status !== PhotoVariantStatus.DISCARDED);
    const variants = await Promise.all(nonDiscardedVariants.map((v) => this.toVariantDao(v, apiBaseUrl, tenantName)));

    const currentVariant = row.current_card_variant_id
      ? nonDiscardedVariants.find((v) => v.id === row.current_card_variant_id)
      : undefined;
    const currentCardLink = await this.resolveCurrentCardViewUrl(
      currentVariant?.id,
      currentVariant?.fsFileId,
      currentVariant?.fsStatus,
      apiBaseUrl,
      tenantName,
    );
    const currentCardViewUrl = currentCardLink.url;
    const currentCardViewUrlExpiresAt = currentCardLink.expiresAt;

    return toDao(ReviewSetDetailDao, {
      id: row.id,
      campaignId: row.campaign_id,
      subjectCode: row.subject_code,
      subjectName: row.subject_name ?? undefined,
      kindId: row.kind_id,
      kindCode: row.kind_code ?? undefined,
      sourceSessionId: sessionId,
      status: row.status,
      currentCardVariantId: row.current_card_variant_id ?? undefined,
      currentCardViewUrl,
      currentCardViewUrlExpiresAt,
      hasAi: nonDiscardedVariants.some((v) => v.kind === PhotoVariantKind.CARD_AI),
      hasUpload: nonDiscardedVariants.some((v) => v.kind === PhotoVariantKind.CARD_UPLOAD),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      originalPhotos: photoRows.map((p) => ({
        id: p.id,
        stepId: p.step_id,
        stepType: p.step_type ?? undefined,
        cameraRole: p.camera_role ?? undefined,
        attempt: p.attempt,
        mimeType: p.mime_type,
        fsFileId: p.fs_file_id ?? undefined,
        fsStatus: p.fs_status ?? undefined,
        capturedAt: p.captured_at ?? undefined,
      })),
      videos: videoRows.map((v) => ({
        id: v.id,
        cameraRole: v.camera_role ?? undefined,
        mimeType: v.mime_type,
        durationMs: v.duration_ms ?? undefined,
        fsFileId: v.fs_file_id ?? undefined,
        fsStatus: v.fs_status ?? undefined,
      })),
      variants,
      events: eventRows.map((e) => ({
        id: e.id,
        setId: e.set_id,
        variantId: e.variant_id ?? undefined,
        action: e.action,
        actorUserId: e.actor_user_id ?? undefined,
        actorEmail: e.actor_email ?? undefined,
        payload: e.payload ?? undefined,
        at: e.at,
      })),
    });
  }

  // ── POST /v1/review/sets/:id/reprocess ──────────────────────────────

  /**
   * Allowed even when locked — this is how a set gets OUT of `PENDING_AUTO`
   * (first ever card) or `AUTO_FAILED` (retry), per plan §4/R-Q1.
   *
   * Defensive by design: the actual image pipeline lives in the Python AI
   * sidecar (a different agent's module, may not be built/reachable in any
   * given environment). Any failure — unreachable, non-2xx, timeout — must
   * resolve to a clean `AUTO_FAILED` state, never an unhandled crash or a
   * hanging request; `PhotoReviewSidecarService` already caps every call at
   * `SIDECAR_TIMEOUT_MS` (30s) via `AbortController`.
   */
  async reprocess(setId: string, actorUserId: string | null, apiBaseUrl: string): Promise<PhotoVariantDao> {
    const set = await this.findSetEntityOrFail(setId);
    const kind = await this.photoKindService.findKindEntityOrFail(set.kindId);
    const sessionContext = await this.resolveSessionContext(set.sourceSessionId);
    const frontPhoto = await this.findFrontSourcePhoto(set.sourceSessionId);
    if (!frontPhoto) {
      throw new CustomException(
        'No original photo found for this set\'s source session',
        PHOTO_REVIEW_ERROR_CODE.SOURCE_PHOTO_NOT_FOUND,
        HttpStatus.NOT_FOUND,
      );
    }

    const variant = await this.dataSource.transaction(async (manager) => {
      await this.lockSet(manager, setId);
      const version = await this.nextVersion(manager, setId);
      const repo = manager.getRepository(PhotoVariant);
      const created = await repo.save(
        repo.create({
          setId,
          version,
          kind: PhotoVariantKind.CARD_AUTO,
          status: PhotoVariantStatus.PROCESSING,
          sourcePhotoId: frontPhoto.id,
          createdByUserId: actorUserId,
        }),
      );
      await this.writeEvent(manager, {
        setId,
        variantId: created.id,
        action: PhotoReviewAction.REPROCESS,
        actorUserId,
      });
      return created;
    });

    try {
      const sourceBytes = await this.readSourcePhotoBytes(frontPhoto, sessionContext.tenantName);
      const result = await this.sidecar.cardPhoto({
        imageBase64: sourceBytes.toString('base64'),
        cardSpec: kind.cardSpec,
      });

      const ext = this.extForMime(result.mimeType);
      const virtualPath = this.buildVirtualPath(set.sourceSessionId, sessionContext.year, 'auto', variant.version, ext);
      const data = Buffer.from(result.imageBase64, 'base64');

      const readyVariant = await this.dataSource.transaction(async (manager) => {
        const lockedSet = await this.lockSet(manager, setId);
        const stored = await this.storeVariantBytesLocalFirst(manager, {
          variantId: variant.id,
          tenantName: sessionContext.tenantName,
          virtualPath,
          mimeType: result.mimeType,
          data,
          idempotencyKey: `photo-review:${variant.id}:auto`,
        });

        const repo = manager.getRepository(PhotoVariant);
        variant.status = PhotoVariantStatus.READY;
        // fsFileId intentionally left null here — VariantUploadWorkerService's
        // cron sets it once the push to fs-core actually succeeds (see
        // storeVariantBytesLocalFirst's own doc comment for why this no
        // longer uploads to fs-core synchronously).
        variant.virtualPath = virtualPath;
        variant.bytes = stored.bytes;
        variant.sha256 = stored.sha256;
        variant.width = result.width ?? null;
        variant.height = result.height ?? null;
        variant.dpi = result.dpi ?? null;
        // The sidecar does not version its own pipeline output today (see
        // SidecarCardPhotoResult's own doc comment) — left null rather than
        // a made-up constant, matching "never a fabricated value" elsewhere
        // in this module's own sidecar-result handling.
        variant.qualityReport = result.warnings.length ? { warnings: result.warnings } : null;
        variant.algorithmVersion = null;
        await repo.save(variant);

        lockedSet.currentCardVariantId = variant.id;
        lockedSet.status = PhotoReviewSetStatus.READY;
        await manager.getRepository(SubjectPhotoSet).save(lockedSet);

        await this.writeEvent(manager, {
          setId,
          variantId: variant.id,
          action: PhotoReviewAction.AUTO_GENERATED,
          actorUserId: null,
        });
        return variant;
      });

      // Best-effort, direct-to-fs-core (see uploadMetadataBestEffort's own
      // doc comment) — a sidecar metadata sidecar file, not the image
      // itself, so it stays out of the local-first path; fs-core being down
      // just means this warns and skips, same as before this task.
      await this.uploadMetadataBestEffort({
        tenantName: sessionContext.tenantName,
        virtualPath: virtualPath.replace(/\.[^.]+$/, '.json'),
        idempotencyKey: `photo-review:${variant.id}:auto:meta`,
        metadata: {
          warnings: result.warnings,
          cardSpec: kind.cardSpec,
        },
      });

      return this.toVariantDao(readyVariant, apiBaseUrl, sessionContext.tenantName);
    } catch (error) {
      const message = extractSidecarFailureMessage(error);
      this.logger.warn(`reprocess failed for set ${setId}: ${message}`);
      await this.dataSource.transaction(async (manager) => {
        const lockedSet = await this.lockSet(manager, setId);
        const repo = manager.getRepository(PhotoVariant);
        variant.status = PhotoVariantStatus.FAILED;
        variant.note = message;
        await repo.save(variant);

        lockedSet.status = PhotoReviewSetStatus.AUTO_FAILED;
        await manager.getRepository(SubjectPhotoSet).save(lockedSet);

        await this.writeEvent(manager, {
          setId,
          variantId: variant.id,
          action: PhotoReviewAction.AUTO_FAILED,
          actorUserId: null,
          payload: { error: message },
        });
      });
    }

    return this.toVariantDao(variant, apiBaseUrl, sessionContext.tenantName);
  }

  // ── POST /v1/review/sets/:id/ai-edit ────────────────────────────────

  /**
   * Runs synchronously (awaits the sidecar call before returning) rather
   * than dispatching to a real background job queue — this codebase has no
   * job-table infrastructure for AI edits yet, and the task brief
   * explicitly allows `GET /v1/review/jobs/:id` to just read back a
   * `photo_variants` row's current state (documented there too). A future
   * async queue can slot in behind the same `PhotoVariantDao` shape without
   * changing this method's contract.
   */
  async aiEdit(
    setId: string,
    dto: AiEditDto,
    actorUserId: string | null,
    apiBaseUrl: string,
  ): Promise<PhotoVariantDao> {
    const set = await this.findSetEntityOrFail(setId);
    this.assertUnlocked(set);

    const lowerPrompt = dto.prompt.toLowerCase();
    const hit = FORBIDDEN_PROMPT_KEYWORDS.find((kw) => lowerPrompt.includes(kw));
    if (hit) {
      throw new CustomException(
        `Yêu cầu bị từ chối: chứa từ khóa không được phép sửa ("${hit}") — xem plan §6.3 (AI không được đổi biểu cảm, mở mắt, bỏ kính, gầy mặt, trẻ hóa, làm đẹp, đổi mắt/mũi/miệng)`,
        PHOTO_REVIEW_ERROR_CODE.PROMPT_FORBIDDEN,
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    const fromVariantId = dto.fromVariantId ?? set.currentCardVariantId;
    if (!fromVariantId) {
      throw new CustomException('No source variant to edit from', PHOTO_REVIEW_ERROR_CODE.VARIANT_NOT_FOUND, HttpStatus.NOT_FOUND);
    }
    const fromVariant = await this.findVariantEntityOrFail(fromVariantId);
    if (fromVariant.setId !== setId) {
      throw new CustomException('Variant does not belong to this set', PHOTO_REVIEW_ERROR_CODE.VARIANT_NOT_IN_SET, HttpStatus.BAD_REQUEST);
    }
    // "Usable" no longer means "already on fs-core" — a variant that is
    // fully READY with only local bytes (fs-core down, or just not its turn
    // in VariantUploadWorkerService's queue yet) is exactly as editable as
    // one that has already been pushed; `readVariantBytes` below resolves
    // bytes from either place. Only a genuinely-empty variant (DISCARDED, or
    // one with no bytes ANYWHERE — PROCESSING that never finished, or FAILED
    // with nothing produced) is rejected here.
    if (
      fromVariant.status === PhotoVariantStatus.DISCARDED ||
      (!fromVariant.fsFileId && !(await this.hasLocalVariantContent(fromVariant.id)))
    ) {
      throw new CustomException(
        'Source variant is not usable (discarded or has no image bytes yet)',
        PHOTO_REVIEW_ERROR_CODE.VARIANT_NOT_READY,
        HttpStatus.CONFLICT,
      );
    }

    const kind = await this.photoKindService.findKindEntityOrFail(set.kindId);
    const sessionContext = await this.resolveSessionContext(set.sourceSessionId);

    const variant = await this.dataSource.transaction(async (manager) => {
      await this.lockSet(manager, setId);
      const version = await this.nextVersion(manager, setId);
      const repo = manager.getRepository(PhotoVariant);
      const created = await repo.save(
        repo.create({
          setId,
          version,
          kind: PhotoVariantKind.CARD_AI,
          status: PhotoVariantStatus.PROCESSING,
          derivedFromVariantId: fromVariant.id,
          prompt: dto.prompt,
          regionMode: dto.region ?? null,
          createdByUserId: actorUserId,
        }),
      );
      await this.writeEvent(manager, {
        setId,
        variantId: created.id,
        action: PhotoReviewAction.AI_REQUESTED,
        actorUserId,
        payload: { prompt: dto.prompt, region: dto.region, fromVariantId: fromVariant.id },
      });
      return created;
    });

    try {
      const sourceBytes = await this.readVariantBytes(fromVariant, sessionContext.tenantName);
      const result = await this.sidecar.edit({
        imageBase64: sourceBytes.toString('base64'),
        prompt: dto.prompt,
        region: dto.region,
        fromVariantId: fromVariant.id,
      });

      const ext = this.extForMime(result.mimeType);
      const virtualPath = this.buildVirtualPath(set.sourceSessionId, sessionContext.year, 'ai', variant.version, ext);
      const data = Buffer.from(result.imageBase64, 'base64');

      await this.dataSource.transaction(async (manager) => {
        const stored = await this.storeVariantBytesLocalFirst(manager, {
          variantId: variant.id,
          tenantName: sessionContext.tenantName,
          virtualPath,
          mimeType: result.mimeType,
          data,
          idempotencyKey: `photo-review:${variant.id}:ai`,
        });

        variant.status = PhotoVariantStatus.READY;
        // fsFileId intentionally left null — see storeVariantBytesLocalFirst's
        // own doc comment; VariantUploadWorkerService's cron fills it in once
        // the push to fs-core actually succeeds.
        variant.virtualPath = virtualPath;
        variant.bytes = stored.bytes;
        variant.sha256 = stored.sha256;
        variant.width = result.width ?? null;
        variant.height = result.height ?? null;
        variant.seed = result.seed ?? null;
        variant.modelId = result.modelId ?? null;
        variant.algorithmVersion = result.algorithmVersion ?? null;
        variant.identitySimilarity = result.identitySimilarity ?? null;
        await manager.getRepository(PhotoVariant).save(variant);
        // Not set as current — plan §5.3/§6.2: "con người chấp nhận: không bao
        // giờ tự đặt bản AI làm ảnh hiện tại". A reviewer must call
        // POST /v1/review/variants/:id/accept explicitly.
      });

      await this.uploadMetadataBestEffort({
        tenantName: sessionContext.tenantName,
        virtualPath: virtualPath.replace(/\.[^.]+$/, '.json'),
        idempotencyKey: `photo-review:${variant.id}:ai:meta`,
        metadata: {
          prompt: dto.prompt,
          region: dto.region,
          modelId: result.modelId,
          seed: result.seed,
          identitySimilarity: result.identitySimilarity,
          algorithmVersion: result.algorithmVersion,
        },
      });
    } catch (error) {
      const message = extractSidecarFailureMessage(error);
      this.logger.warn(`ai-edit failed for set ${setId}: ${message}`);
      variant.status = PhotoVariantStatus.FAILED;
      variant.note = message;
      await this.variantRepository.save(variant);
    }

    return this.toVariantDao(variant, apiBaseUrl, sessionContext.tenantName);
  }

  // ── GET /v1/review/jobs/:id ──────────────────────────────────────────

  /**
   * Simplification, documented per the task brief: there is no separate job
   * table in this pass, so `:id` is treated as a `photo_variants.id` and
   * this just returns that variant's current state. `aiEdit`/`reprocess`
   * already run synchronously (see their own doc comments), so by the time
   * a client polls this, the variant is normally already READY/FAILED — a
   * real async job queue is a reasonable future improvement, not required
   * now.
   */
  async getJob(variantId: string, apiBaseUrl: string): Promise<PhotoVariantDao> {
    const variant = await this.findVariantEntityOrFail(variantId);
    const set = await this.findSetEntityOrFail(variant.setId);
    const sessionContext = await this.resolveSessionContext(set.sourceSessionId);
    return this.toVariantDao(variant, apiBaseUrl, sessionContext.tenantName);
  }

  // ── POST /v1/review/variants/:id/accept ─────────────────────────────

  async acceptVariant(variantId: string, actorUserId: string | null, apiBaseUrl: string): Promise<PhotoVariantDao> {
    const variant = await this.findVariantEntityOrFail(variantId);
    const set = await this.findSetEntityOrFail(variant.setId);
    this.assertUnlocked(set);

    if (variant.kind !== PhotoVariantKind.CARD_AI && variant.kind !== PhotoVariantKind.CARD_UPLOAD) {
      throw new CustomException(
        'Only a CARD_AI or CARD_UPLOAD variant can be accepted',
        PHOTO_REVIEW_ERROR_CODE.VARIANT_NOT_READY,
        HttpStatus.CONFLICT,
      );
    }
    if (variant.status !== PhotoVariantStatus.READY) {
      throw new CustomException('Variant is not READY', PHOTO_REVIEW_ERROR_CODE.VARIANT_NOT_READY, HttpStatus.CONFLICT);
    }
    if (variant.identitySimilarity != null && variant.identitySimilarity < IDENTITY_SIMILARITY_REJECT_THRESHOLD) {
      throw new CustomException(
        `Identity similarity ${variant.identitySimilarity.toFixed(2)} is below the ${IDENTITY_SIMILARITY_REJECT_THRESHOLD} threshold — cannot accept`,
        PHOTO_REVIEW_ERROR_CODE.IDENTITY_MISMATCH,
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    await this.dataSource.transaction(async (manager) => {
      const lockedSet = await this.lockSet(manager, set.id);
      lockedSet.currentCardVariantId = variant.id;
      if (lockedSet.status === PhotoReviewSetStatus.READY) {
        lockedSet.status = PhotoReviewSetStatus.IN_REVIEW;
      }
      await manager.getRepository(SubjectPhotoSet).save(lockedSet);

      const action =
        variant.kind === PhotoVariantKind.CARD_AI ? PhotoReviewAction.AI_ACCEPTED : PhotoReviewAction.UPLOAD_REPLACED;
      await this.writeEvent(manager, { setId: set.id, variantId: variant.id, action, actorUserId });
    });

    const sessionContext = await this.resolveSessionContext(set.sourceSessionId);
    return this.toVariantDao(variant, apiBaseUrl, sessionContext.tenantName);
  }

  // ── POST /v1/review/variants/:id/discard ────────────────────────────

  async discardVariant(
    variantId: string,
    actorUserId: string | null,
    apiBaseUrl: string,
  ): Promise<PhotoVariantDao> {
    const variant = await this.findVariantEntityOrFail(variantId);
    const set = await this.findSetEntityOrFail(variant.setId);
    this.assertUnlocked(set);

    if (set.currentCardVariantId === variant.id) {
      throw new CustomException(
        'Cannot discard the current card variant — switch current to another variant first',
        PHOTO_REVIEW_ERROR_CODE.VARIANT_IS_CURRENT,
        HttpStatus.CONFLICT,
      );
    }
    if (variant.status === PhotoVariantStatus.DISCARDED) {
      return this.toVariantDao(variant, apiBaseUrl, (await this.resolveSessionContext(set.sourceSessionId)).tenantName);
    }

    await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(PhotoVariant);
      variant.status = PhotoVariantStatus.DISCARDED;
      await repo.save(variant);
      await this.writeEvent(manager, {
        setId: set.id,
        variantId: variant.id,
        action: PhotoReviewAction.AI_DISCARDED,
        actorUserId,
      });
    });

    const sessionContext = await this.resolveSessionContext(set.sourceSessionId);
    return this.toVariantDao(variant, apiBaseUrl, sessionContext.tenantName);
  }

  // ── POST /v1/review/sets/:id/upload ─────────────────────────────────

  /**
   * Identity check against the set's original FRONT photo is mandatory
   * (plan §5.4/R-Q8) and, unlike `reprocess`, a sidecar failure here fails
   * the whole request (503) rather than silently proceeding — this is a
   * safety check, not a nice-to-have.
   */
  async uploadVariant(
    setId: string,
    file: { buffer: Buffer; mimetype: string; size: number },
    actorUserId: string | null,
    apiBaseUrl: string,
  ): Promise<UploadVariantResultDao> {
    const set = await this.findSetEntityOrFail(setId);
    this.assertUnlocked(set);

    if (!uploadedFileMimeAllowed(file.mimetype)) {
      throw new CustomException(
        `Unsupported image type "${file.mimetype}" — only JPEG/PNG allowed`,
        PHOTO_REVIEW_ERROR_CODE.UPLOAD_INVALID,
        HttpStatus.BAD_REQUEST,
      );
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      throw new CustomException(
        `Image is ${file.size} bytes, above the ${MAX_UPLOAD_BYTES} limit`,
        PHOTO_REVIEW_ERROR_CODE.UPLOAD_INVALID,
        HttpStatus.BAD_REQUEST,
      );
    }

    const kind = await this.photoKindService.findKindEntityOrFail(set.kindId);
    const sessionContext = await this.resolveSessionContext(set.sourceSessionId);
    const frontPhoto = await this.findFrontSourcePhoto(set.sourceSessionId);
    if (!frontPhoto) {
      throw new CustomException(
        'Reference (FRONT) photo is not available yet — cannot verify identity',
        PHOTO_REVIEW_ERROR_CODE.SOURCE_PHOTO_NOT_FOUND,
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    let similarity: number;
    try {
      // readSourcePhotoBytes prefers upload_outbox.content (Part A) over a
      // file-service round trip — resolved here, inside the try, so a photo
      // with no bytes available anywhere yet (not staged locally, not on
      // fs-core) surfaces through the exact same SIDECAR_UNREACHABLE 503
      // this catch block already produces, rather than a second bespoke
      // error path.
      const referenceBytes = await this.readSourcePhotoBytes(frontPhoto, sessionContext.tenantName);
      const simResult = await this.sidecar.identitySimilarity({
        referenceImageBase64: referenceBytes.toString('base64'),
        candidateImageBase64: file.buffer.toString('base64'),
      });
      similarity = simResult.similarity;
    } catch (error) {
      const message = extractSidecarFailureMessage(error);
      // Unlike reprocess: this check is a safety requirement, not a
      // best-effort pipeline step — a sidecar outage must fail the request
      // clearly rather than let an unverified photo through.
      throw new CustomException(
        `Could not verify identity (AI sidecar unreachable): ${message}`,
        PHOTO_REVIEW_ERROR_CODE.SIDECAR_UNREACHABLE,
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    if (similarity < IDENTITY_SIMILARITY_REJECT_THRESHOLD) {
      throw new CustomException(
        `Identity similarity ${similarity.toFixed(2)} is below the ${IDENTITY_SIMILARITY_REJECT_THRESHOLD} threshold — this may not be the same person`,
        PHOTO_REVIEW_ERROR_CODE.IDENTITY_MISMATCH,
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    // The uploaded bytes only exist in memory at this point (not yet on the
    // file-service), so the sidecar gets them as base64 rather than a URL —
    // unlike `reprocess`/`aiEdit`, which crop an image that already lives on
    // fs-core and so pass a short-lived view-link URL instead.
    const cardResult = await this.sidecar
      .cardPhoto({
        imageBase64: file.buffer.toString('base64'),
        cardSpec: kind.cardSpec,
      })
      .catch((error) => {
        const message = extractSidecarFailureMessage(error);
        throw new CustomException(
          `Card-photo pipeline failed for the uploaded image: ${message}`,
          PHOTO_REVIEW_ERROR_CODE.SIDECAR_UNREACHABLE,
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      });

    const variant = await this.dataSource.transaction(async (manager) => {
      const lockedSet = await this.lockSet(manager, setId);
      const version = await this.nextVersion(manager, setId);
      const repo = manager.getRepository(PhotoVariant);

      const ext = this.extForMime(cardResult.mimeType);
      const virtualPath = this.buildVirtualPath(set.sourceSessionId, sessionContext.year, 'upload', version, ext);
      const data = Buffer.from(cardResult.imageBase64, 'base64');

      // Created first, without bytes/fsFileId — `storeVariantBytesLocalFirst`
      // below needs a real `photo_variants.id` to satisfy
      // `variant_upload_outbox`'s FK before it can insert the local-first row.
      const created = await repo.save(
        repo.create({
          setId,
          version,
          kind: PhotoVariantKind.CARD_UPLOAD,
          status: PhotoVariantStatus.READY,
          virtualPath,
          width: cardResult.width ?? null,
          height: cardResult.height ?? null,
          dpi: cardResult.dpi ?? null,
          identitySimilarity: similarity,
          qualityReport: cardResult.warnings.length ? { warnings: cardResult.warnings } : null,
          algorithmVersion: null,
          createdByUserId: actorUserId,
        }),
      );

      const stored = await this.storeVariantBytesLocalFirst(manager, {
        variantId: created.id,
        tenantName: sessionContext.tenantName,
        virtualPath,
        mimeType: cardResult.mimeType,
        data,
        idempotencyKey: `photo-review:${setId}:upload:v${version}`,
      });
      created.bytes = stored.bytes;
      created.sha256 = stored.sha256;
      // fsFileId intentionally left null — see storeVariantBytesLocalFirst's
      // own doc comment; VariantUploadWorkerService's cron fills it in once
      // the push to fs-core actually succeeds. Previously this whole
      // transaction aborted (no variant row at all) if the direct fs-core
      // upload failed here — with fs-core down, EVERY upload-replace used
      // to fail outright even though the sidecar had already produced a
      // usable card photo.
      await repo.save(created);

      // Best-effort: also keep the original file the operator picked, next
      // to the cropped card photo (plan §3 — `upload-vN.source.jpg`). Still
      // direct-to-fs-core (a sidecar file, not the image itself — see
      // uploadMetadataBestEffort's own doc comment); fs-core being down just
      // means this warns and skips.
      await this.uploadMetadataBestEffort({
        tenantName: sessionContext.tenantName,
        virtualPath: this.buildVirtualPath(set.sourceSessionId, sessionContext.year, 'upload', version, 'source.json'),
        idempotencyKey: `photo-review:${setId}:upload:v${version}:meta`,
        metadata: { identitySimilarity: similarity, originalMimeType: file.mimetype },
      });

      lockedSet.currentCardVariantId = created.id;
      if (lockedSet.status === PhotoReviewSetStatus.READY) {
        lockedSet.status = PhotoReviewSetStatus.IN_REVIEW;
      }
      await manager.getRepository(SubjectPhotoSet).save(lockedSet);

      await this.writeEvent(manager, {
        setId,
        variantId: created.id,
        action: PhotoReviewAction.UPLOAD_REPLACED,
        actorUserId,
        payload: { identitySimilarity: similarity },
      });

      return created;
    });

    const dao = await this.toVariantDao(variant, apiBaseUrl, sessionContext.tenantName);
    return toDao(UploadVariantResultDao, {
      variant: dao,
      identitySimilarity: similarity,
      identityWarning: similarity < IDENTITY_SIMILARITY_WARN_THRESHOLD,
    });
  }

  // ── POST /v1/review/sets/:id/current ────────────────────────────────

  async setCurrent(
    setId: string,
    variantId: string,
    actorUserId: string | null,
    apiBaseUrl: string,
  ): Promise<ReviewSetListItemDao> {
    const set = await this.findSetEntityOrFail(setId);
    this.assertUnlocked(set);

    const variant = await this.findVariantEntityOrFail(variantId);
    if (variant.setId !== setId) {
      throw new CustomException('Variant does not belong to this set', PHOTO_REVIEW_ERROR_CODE.VARIANT_NOT_IN_SET, HttpStatus.BAD_REQUEST);
    }
    if (variant.status === PhotoVariantStatus.DISCARDED) {
      throw new CustomException('Cannot set a discarded variant as current', PHOTO_REVIEW_ERROR_CODE.VARIANT_DISCARDED, HttpStatus.CONFLICT);
    }
    if (variant.status !== PhotoVariantStatus.READY) {
      throw new CustomException('Only a READY variant can be set as current', PHOTO_REVIEW_ERROR_CODE.VARIANT_NOT_READY, HttpStatus.CONFLICT);
    }

    await this.dataSource.transaction(async (manager) => {
      const lockedSet = await this.lockSet(manager, setId);
      lockedSet.currentCardVariantId = variant.id;
      await manager.getRepository(SubjectPhotoSet).save(lockedSet);
      await this.writeEvent(manager, {
        setId,
        variantId: variant.id,
        action: PhotoReviewAction.SET_CURRENT,
        actorUserId,
      });
    });

    return this.toSetListItemDao(setId, apiBaseUrl);
  }

  // ── POST /v1/review/sets/:id/approve, /reject ───────────────────────

  async approve(
    setId: string,
    dto: ApproveRejectDto,
    actorUserId: string | null,
    apiBaseUrl: string,
  ): Promise<ReviewSetListItemDao> {
    return this.transitionSetStatus(setId, PhotoReviewSetStatus.APPROVED, PhotoReviewAction.APPROVED, dto, actorUserId, apiBaseUrl);
  }

  async reject(
    setId: string,
    dto: ApproveRejectDto,
    actorUserId: string | null,
    apiBaseUrl: string,
  ): Promise<ReviewSetListItemDao> {
    return this.transitionSetStatus(setId, PhotoReviewSetStatus.REJECTED, PhotoReviewAction.REJECTED, dto, actorUserId, apiBaseUrl);
  }

  private async transitionSetStatus(
    setId: string,
    status: PhotoReviewSetStatus,
    action: PhotoReviewAction,
    dto: ApproveRejectDto,
    actorUserId: string | null,
    apiBaseUrl: string,
  ): Promise<ReviewSetListItemDao> {
    const set = await this.findSetEntityOrFail(setId);
    this.assertUnlocked(set);

    await this.dataSource.transaction(async (manager) => {
      const lockedSet = await this.lockSet(manager, setId);
      lockedSet.status = status;
      await manager.getRepository(SubjectPhotoSet).save(lockedSet);
      await this.writeEvent(manager, {
        setId,
        action,
        actorUserId,
        payload: dto.note ? { note: dto.note } : null,
      });
    });

    return this.toSetListItemDao(setId, apiBaseUrl);
  }

  /** Single-row equivalent of one `listSets` result item — used to build the response of every mutating action that returns a set (setCurrent/approve/reject), without a bogus "page 1, limit 1" query that could return the wrong set entirely. */
  private async toSetListItemDao(setId: string, apiBaseUrl: string): Promise<ReviewSetListItemDao> {
    const rows: Array<Record<string, unknown>> = await this.dataSource.query(
      `SELECT
          s.id, s.campaign_id, s.subject_code, s.subject_name, s.kind_id, k.code AS kind_code,
          s.source_session_id, s.status, s.current_card_variant_id, s.created_at, s.updated_at,
          cv.fs_file_id AS current_fs_file_id,
          cv.fs_status AS current_fs_status,
          EXISTS (SELECT 1 FROM photo_variants v WHERE v.set_id = s.id AND v.kind = 'CARD_AI' AND v.status <> 'DISCARDED') AS has_ai,
          EXISTS (SELECT 1 FROM photo_variants v WHERE v.set_id = s.id AND v.kind = 'CARD_UPLOAD' AND v.status <> 'DISCARDED') AS has_upload
        FROM subject_photo_sets s
        LEFT JOIN photo_kinds k ON k.id = s.kind_id
        LEFT JOIN photo_variants cv ON cv.id = s.current_card_variant_id
       WHERE s.id = $1`,
      [setId],
    );
    const row = rows[0];
    if (!row) {
      throw new CustomException('Photo review set not found', PHOTO_REVIEW_ERROR_CODE.SET_NOT_FOUND, HttpStatus.NOT_FOUND);
    }

    const tenantMap = await this.batchResolveTenants([row.source_session_id as string]);
    const currentCardLink = await this.resolveCurrentCardViewUrl(
      row.current_card_variant_id as string | null,
      row.current_fs_file_id as string | null,
      row.current_fs_status as string | null,
      apiBaseUrl,
      tenantMap.get(row.source_session_id as string),
    );
    const currentCardViewUrl = currentCardLink.url;
    const currentCardViewUrlExpiresAt = currentCardLink.expiresAt;

    return toDao(ReviewSetListItemDao, {
      id: row.id,
      campaignId: row.campaign_id,
      subjectCode: row.subject_code,
      subjectName: row.subject_name ?? undefined,
      kindId: row.kind_id,
      kindCode: row.kind_code ?? undefined,
      sourceSessionId: row.source_session_id,
      status: row.status,
      currentCardVariantId: row.current_card_variant_id ?? undefined,
      currentCardViewUrl,
      currentCardViewUrlExpiresAt,
      hasAi: row.has_ai,
      hasUpload: row.has_upload,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  }

  // ── GET /v1/review/sets/:id/events ──────────────────────────────────

  async listEvents(setId: string, query: ListEventsQueryDto): Promise<Pagination<ReviewEventDao>> {
    await this.findSetEntityOrFail(setId);
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const offset = (page - 1) * limit;

    const countRows: Array<{ count: number }> = await this.dataSource.query(
      `SELECT COUNT(*)::int AS count FROM photo_review_events WHERE set_id = $1`,
      [setId],
    );
    const totalItems = countRows[0]?.count ?? 0;

    const rows: Array<Record<string, unknown>> = await this.dataSource.query(
      `SELECT e.id, e.set_id, e.variant_id, e.action, e.actor_user_id, e.payload, e.at, u.email AS actor_email
         FROM photo_review_events e
         LEFT JOIN users u ON u.id = e.actor_user_id
        WHERE e.set_id = $1
        ORDER BY e.at DESC
        LIMIT $2 OFFSET $3`,
      [setId, limit, offset],
    );

    const items = toDao(
      ReviewEventDao,
      rows.map((e) => ({
        id: e.id,
        setId: e.set_id,
        variantId: e.variant_id ?? undefined,
        action: e.action,
        actorUserId: e.actor_user_id ?? undefined,
        actorEmail: e.actor_email ?? undefined,
        payload: e.payload ?? undefined,
        at: e.at,
      })),
    );

    return new Pagination(items, {
      itemCount: items.length,
      totalItems,
      itemsPerPage: limit,
      totalPages: Math.max(1, Math.ceil(totalItems / limit)),
      currentPage: page,
    });
  }

  // ── GET /v1/review/export ────────────────────────────────────────────

  /**
   * Builds a real zip (the `archiver` package is already a dependency of
   * this app — see `ActivationPackageService.buildActivationZip`, which
   * this mirrors — so no new dependency was added) containing one image per
   * APPROVED set's current card variant, named `<subjectCode>.<ext>`, plus
   * a `manifest.csv` (plan R-Q9: "zip theo mã SV + CSV"). A set with no
   * downloadable current variant is skipped but still listed in the
   * manifest with an `exported` status, so one bad row never fails the
   * whole export.
   */
  async exportApproved(campaignId: string, status: PhotoReviewSetStatus): Promise<Buffer> {
    const rows: Array<{
      id: string;
      subject_code: string;
      subject_name: string | null;
      status: string;
      updated_at: Date;
      source_session_id: string;
      current_fs_file_id: string | null;
    }> = await this.dataSource.query(
      `SELECT s.id, s.subject_code, s.subject_name, s.status, s.updated_at, s.source_session_id,
              cv.fs_file_id AS current_fs_file_id
         FROM subject_photo_sets s
         LEFT JOIN photo_variants cv ON cv.id = s.current_card_variant_id
        WHERE s.campaign_id = $1 AND s.status = $2
        ORDER BY s.subject_code`,
      [campaignId, status],
    );

    const tenantMap = await this.batchResolveTenants([...new Set(rows.map((r) => r.source_session_id))]);

    const archive = archiver('zip', { zlib: { level: 9 } });
    const output = new PassThrough();
    const chunks: Buffer[] = [];
    output.on('data', (chunk: Buffer) => chunks.push(chunk));
    const done = new Promise<Buffer>((resolve, reject) => {
      output.on('end', () => resolve(Buffer.concat(chunks)));
      archive.on('error', reject);
    });
    archive.pipe(output);

    const manifestLines = ['subject_code,subject_name,status,updated_at,exported'];
    const csvField = (value: string) => `"${value.replace(/"/g, '""')}"`;

    for (const row of rows) {
      let exported = 'NO_CARD';
      if (row.current_fs_file_id) {
        try {
          const link = await this.fileStorage.issueViewLink(
            row.current_fs_file_id,
            'photo-review-export',
            tenantMap.get(row.source_session_id),
          );
          const res = await fetch(link.url);
          if (res.ok) {
            const buf = Buffer.from(await res.arrayBuffer());
            const contentType = res.headers.get('content-type') ?? 'image/jpeg';
            archive.append(buf, { name: `${row.subject_code}.${this.extForMime(contentType)}` });
            exported = 'OK';
          } else {
            exported = `DOWNLOAD_FAILED_${res.status}`;
          }
        } catch (error) {
          this.logger.warn(`export download failed for set ${row.id}: ${(error as Error).message}`);
          exported = 'ERROR';
        }
      }
      manifestLines.push(
        [
          csvField(row.subject_code),
          csvField(row.subject_name ?? ''),
          row.status,
          new Date(row.updated_at).toISOString(),
          exported,
        ].join(','),
      );
    }

    archive.append(manifestLines.join('\n'), { name: 'manifest.csv' });
    await archive.finalize();
    return done;
  }

  // ── Hook from session approval (plan §4's state-diagram start) ─────

  /**
   * Ensures a `subject_photo_sets` row exists (or is updated) for a session
   * that just got approved/completed — plan §4: "phiên chụp được xác nhận
   * → (tạo/cập nhật hồ sơ, source_session_id = phiên này) → PENDING_AUTO".
   *
   * Called from both capture paths' own approval points:
   * `SessionService.completeSession` (web) and `DeviceEventService.recordBatch`
   * (kiosk, right after it applies a `SESSION_REPORT`) — both best-effort,
   * outside their own transaction, exactly as documented here originally.
   * `DeviceEventService.recordBatch` additionally uses this call's
   * `pendingAuto` flag to auto-trigger the first `CARD_AUTO` — see that
   * method's own comment for why the flag (not just the returned id) is
   * what decides whether to fire.
   *
   * Reads the session's `subject_code`/`subject_name`/`campaign_id`
   * straight off the `sessions` table (read-only, same cross-boundary
   * pattern as the rest of this service). Defaults `kindId` to the single
   * seeded `STUDENT_CARD` kind, since `campaigns` has no `kind_id` column
   * yet in this pass (plan §7 names this as a future campaign→kind link,
   * not yet built on the `device-management` side) — a documented
   * assumption, not a spec requirement met in full.
   *
   * Per plan §4/R-Q10: a set already `APPROVED` keeps its status and
   * current variant untouched (the newer session id is still recorded, so
   * a reviewer can later choose to reprocess against it) rather than being
   * silently reset to `PENDING_AUTO` — "giữ bản đã duyệt, hiện cảnh báo …
   * để cán bộ tự quyết" — `pendingAuto: false` in that case, specifically so
   * the caller's auto-trigger does NOT fire a fresh `CARD_AUTO` over an
   * already-reviewed set. Any other status resets to `PENDING_AUTO`
   * (`pendingAuto: true`), which used to lock the set until an operator
   * manually clicked "reprocess" — now, per the caller's own auto-trigger,
   * that first `CARD_AUTO` runs immediately instead.
   */
  async ensureSetForApprovedSession(
    sessionId: string,
  ): Promise<{ setId: string; pendingAuto: boolean } | null> {
    const sessionRows: Array<{ subject_code: string | null; subject_name: string | null; campaign_id: string | null }> =
      await this.dataSource.query(`SELECT subject_code, subject_name, campaign_id FROM sessions WHERE id = $1`, [
        sessionId,
      ]);
    const session = sessionRows[0];
    if (!session?.subject_code || !session.campaign_id) {
      this.logger.warn(`ensureSetForApprovedSession: session ${sessionId} has no subject_code/campaign_id — skipping`);
      return null;
    }
    // Captured into locals: used again below, after several `await`s —
    // TypeScript cannot keep a property access narrowed across a call it
    // can't prove is side-effect free.
    const subjectCode = session.subject_code;
    const campaignId = session.campaign_id;
    const subjectName = session.subject_name;

    const kind = await this.photoKindRepository.findOne({ where: { code: 'STUDENT_CARD' } });
    if (!kind) {
      this.logger.warn('ensureSetForApprovedSession: STUDENT_CARD photo kind not found — did the seed migration run?');
      return null;
    }

    const existing = await this.setRepository.findOne({
      where: { campaignId, subjectCode, kindId: kind.id },
    });

    if (existing) {
      if (existing.status !== PhotoReviewSetStatus.APPROVED) {
        existing.sourceSessionId = sessionId;
        existing.status = PhotoReviewSetStatus.PENDING_AUTO;
        if (subjectName) existing.subjectName = subjectName;
        await this.setRepository.save(existing);
        return { setId: existing.id, pendingAuto: true };
      }
      // Keep the approved variant current; just record that a newer
      // session exists so a reviewer can decide (R-Q10).
      existing.sourceSessionId = sessionId;
      await this.setRepository.save(existing);
      return { setId: existing.id, pendingAuto: false };
    }

    const created = await this.setRepository.save(
      this.setRepository.create({
        campaignId,
        subjectCode,
        subjectName: subjectName ?? null,
        kindId: kind.id,
        sourceSessionId: sessionId,
        status: PhotoReviewSetStatus.PENDING_AUTO,
      }),
    );
    return { setId: created.id, pendingAuto: true };
  }
}
