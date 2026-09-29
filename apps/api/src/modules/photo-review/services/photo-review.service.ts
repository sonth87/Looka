import { CustomException } from '@app/shared/errors/legacy';
import { toDao } from '@app/shared/http/to-dao.helper';
import { FileStorageService } from '@app/modules/file-storage/services/file-storage.service';
import { ReviewStatsService } from '@app/modules/stats/services/review-stats.service';
import { Pagination } from '@app/shared/http/pagination';
import { DomainEventDispatcher } from '@app/shared/cqrs/domain-event.dispatcher';
import { TransactionContext } from '@app/shared/database/transaction-context';
import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
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
import { PhotoSetStatusChangedEvent } from '../domain/event/photo-set-status-changed.event';
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
import {
  PHOTO_AI_PORT,
  PhotoAiError,
  unwrapPhotoAi,
} from '../application/ports/photo-ai.port';
import type { PhotoAiPort } from '../application/ports/photo-ai.port';
import { PhotoKindService } from './photo-kind.service';
import { SidecarError } from './photo-review-sidecar.service';
import sharp from 'sharp';
import { ReviewAssignmentService } from './review-assignment.service';
import { WorkflowCatalogReadRepository } from '@app/modules/workflow/infrastructure/read/workflow-catalog.read-repository';
import type { WorkflowConfig } from '@app/modules/workflow/domain/schema/workflow-config.schema';

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
  /** `sessions.metadata->>'identityNumber'` (2026-09-10, "lưu ảnh làm mịn vào thư mục CCCD") — the subject's CCCD, when known, same field `StudentSubjectInfo.identityNumber` rides into `sessions.metadata` under. `undefined` for a session with no student lookup at all (manual entry with no CCCD, or an older session predating this). */
  identityNumber?: string;
}

/** A very small (16-byte) 1x1 JPEG-ish sniff is not attempted — MIME + size only, matching `PhotoService.addPhoto`'s own validation depth for this pass. */
const uploadedFileMimeAllowed = (mimeType: string) =>
  ALLOWED_UPLOAD_MIME_TYPES.includes(mimeType.toLowerCase());

/**
 * Extracts a real diagnostic message from anything this module's
 * `PhotoAiPort` call sites (`reprocess`/`aiEdit`/`uploadVariant`) can catch
 * — `PhotoAiError` (thrown by `unwrapPhotoAi` for any non-`Success`
 * `PhotoAiPort` outcome) and `SidecarError` (still thrown directly by this
 * class's own `readSourcePhotoBytes`/`fetchBytesFromFileStorage`/
 * `readVariantBytes` for "no bytes available anywhere yet" — unrelated to
 * `PhotoReviewSidecarService`'s own HTTP calls, but the same error type,
 * reused rather than duplicated) both already carry their real text on
 * plain `.message` (explicit here for clarity, though the generic fallback
 * below would already read it correctly); `CustomException` (e.g.
 * `FileStorageService`'s own throws, hit when the same two helpers fall
 * back to fs-core) does NOT — see below.
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
  if (error instanceof PhotoAiError) return error.message;
  if (error instanceof SidecarError) return error.message;
  if (error instanceof CustomException)
    return error.payload?.error ?? error.message;
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
    @Inject(PHOTO_AI_PORT) private readonly photoAi: PhotoAiPort,
    private readonly photoKindService: PhotoKindService,
    private readonly configService: ConfigService,
    private readonly reviewStats: ReviewStatsService,
    private readonly reviewAssignments: ReviewAssignmentService,
    private readonly transactionContext: TransactionContext,
    private readonly domainEventDispatcher: DomainEventDispatcher,
    private readonly workflowCatalog: WorkflowCatalogReadRepository,
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
      throw new CustomException(
        'Photo review set not found',
        PHOTO_REVIEW_ERROR_CODE.SET_NOT_FOUND,
        HttpStatus.NOT_FOUND,
      );
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
  private async resolveSessionContext(
    sessionId: string,
  ): Promise<SessionContext> {
    const rows: Array<{ at: Date; identity_number: string | null }> =
      await this.dataSource.query(
        `SELECT COALESCE(captured_at, created_at) AS at, metadata->>'identityNumber' AS identity_number
         FROM sessions WHERE id = $1`,
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
      identityNumber: row.identity_number ?? undefined,
    };
  }

  /** Batch version of `resolveSessionContext`, tenant only — see that method's own doc comment for why this is always `undefined` now. Kept (rather than deleted outright) so `listSets`/`getSetDetail` don't need to change shape. */
  private async batchResolveTenants(
    sessionIds: string[],
  ): Promise<Map<string, string | undefined>> {
    const map = new Map<string, string | undefined>();
    for (const id of sessionIds) map.set(id, undefined);
    return map;
  }

  /**
   * One query for the display name (falling back to email) of every user id
   * in `userIds` — used by `getSetDetail` to label each variant's
   * `createdByName` without an N+1 lookup per variant.
   */
  private async batchResolveUserNames(
    userIds: string[],
  ): Promise<Map<string, string | undefined>> {
    const map = new Map<string, string | undefined>();
    const unique = [...new Set(userIds)];
    if (unique.length === 0) return map;
    const rows: Array<{ id: string; name: string | null }> =
      await this.dataSource.query(
        `SELECT id, COALESCE(display_name, email) AS name FROM users WHERE id = ANY($1)`,
        [unique],
      );
    for (const row of rows) map.set(row.id, row.name ?? undefined);
    return map;
  }

  /**
   * The original "chụp thẳng" (FRONT) photo for a session — fed to the
   * sidecar as the card-photo/identity-comparison source (plan §3/§5.4).
   * Falls back to the earliest photo of the session when no step is
   * explicitly tagged FRONT, so this still works for a workflow that only
   * has custom step ids.
   */
  private async findFrontSourcePhoto(
    sessionId: string,
  ): Promise<FrontSourcePhoto | null> {
    const rows: Array<{
      id: string;
      fs_file_id: string | null;
      mime_type: string;
    }> = await this.dataSource.query(
      `SELECT id, fs_file_id, mime_type FROM photos
        WHERE session_id = $1 AND (step_type = 'FRONT' OR step_id ILIKE '%front%')
        ORDER BY attempt DESC LIMIT 1`,
      [sessionId],
    );
    if (rows[0]) {
      return {
        id: rows[0].id,
        fsFileId: rows[0].fs_file_id,
        mimeType: rows[0].mime_type,
      };
    }
    const fallback: Array<{
      id: string;
      fs_file_id: string | null;
      mime_type: string;
    }> = await this.dataSource.query(
      `SELECT id, fs_file_id, mime_type FROM photos WHERE session_id = $1 ORDER BY created_at ASC LIMIT 1`,
      [sessionId],
    );
    return fallback[0]
      ? {
          id: fallback[0].id,
          fsFileId: fallback[0].fs_file_id,
          mimeType: fallback[0].mime_type,
        }
      : null;
  }

  /**
   * A SPECIFIC original photo, by id, scoped to its session — the
   * source-picker counterpart of `findFrontSourcePhoto` above (which always
   * auto-picks the FRONT one). Giai đoạn 5 (plan §5.1, feature 12):
   * `aiEdit`'s `sourceKind: 'ORIGINAL_PHOTO'` lets a reviewer start an edit
   * from ANY captured angle/attempt, not just the auto-picked front photo.
   * Scoped by `sessionId` (not just `photoId` alone) so a caller cannot
   * point this at another session's photo.
   */
  private async findPhotoOrFail(
    photoId: string,
    sessionId: string,
  ): Promise<FrontSourcePhoto> {
    const rows: Array<{
      id: string;
      fs_file_id: string | null;
      mime_type: string;
    }> = await this.dataSource.query(
      `SELECT id, fs_file_id, mime_type FROM photos WHERE id = $1 AND session_id = $2`,
      [photoId, sessionId],
    );
    if (!rows[0]) {
      throw new CustomException(
        'Original photo not found for this set',
        PHOTO_REVIEW_ERROR_CODE.SOURCE_PHOTO_NOT_FOUND,
        HttpStatus.NOT_FOUND,
      );
    }
    return {
      id: rows[0].id,
      fsFileId: rows[0].fs_file_id,
      mimeType: rows[0].mime_type,
    };
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
  private async fetchBytesFromFileStorage(
    fsFileId: string,
    tenantName?: string,
  ): Promise<Buffer> {
    const link = await this.fileStorage.issueViewLink(
      fsFileId,
      'photo-review-sidecar',
      tenantName,
    );
    const res = await fetch(link.url);
    if (!res.ok) {
      throw new SidecarError(
        `Failed to fetch bytes from the file-service: HTTP ${res.status}`,
      );
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
  private async readVariantBytes(
    variant: PhotoVariant,
    tenantName?: string,
  ): Promise<Buffer> {
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
    { kind: 'remote'; fsFileId: string } | { kind: 'local' } | { kind: 'none' }
  > {
    if (
      variant.fsFileId &&
      variant.fsStatus !== 'FAILED' &&
      variant.fsStatus !== 'QUARANTINED'
    ) {
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
  verifyLocalVariantViewTokenOrFail(
    variantId: string,
    expRaw: string,
    sigRaw: string,
  ): void {
    const exp = Number(expRaw);
    const expectedBuf = Buffer.from(
      this.signLocalVariantViewToken(variantId, exp),
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
        'This local-content link is invalid or has expired — reload the set to get a fresh one',
        PHOTO_REVIEW_ERROR_CODE.VARIANT_LOCAL_TOKEN_INVALID,
        HttpStatus.UNAUTHORIZED,
      );
    }
  }

  private signLocalVariantViewToken(variantId: string, exp: number): string {
    const secret = this.configService.get<string>('security.apiKey') ?? '';
    return createHmac('sha256', secret)
      .update(`variant:${variantId}:${exp}`)
      .digest('hex');
  }

  /** Streams straight from `variant_upload_outbox.content` — see `resolveVariantViewSource`'s 'local' branch. Called by `VariantContentController`. */
  async readLocalVariantContent(
    variantId: string,
  ): Promise<{ data: Buffer; mimeType: string }> {
    const rows: Array<{ content: Buffer | null; mime_type: string }> =
      await this.dataSource.query(
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

  /**
   * `students/<CCCD>/final_card/<prefix>-v<version>.<ext>` when the source
   * session has a known CCCD (2026-09-10, "ảnh làm mịn lưu vào thư mục mã
   * căn cước, folder final_card, dễ truy xuất") — same
   * `students/<CCCD>/...` convention `photo.service.ts`'s `addDevicePhoto`
   * and `session-video.service.ts`'s `addDeviceVideo` already use for raw
   * captures, so a student's whole folder (raw photos, video, and every
   * processed card variant) lives together. Falls back to the original
   * session-id-based path when no CCCD is known (manual entry, or a session
   * predating the CCCD-scan feature) — never a placeholder identity.
   */
  private buildVirtualPath(
    sessionId: string,
    setId: string,
    year: number,
    prefix: string,
    version: number,
    ext: string,
    identityNumber?: string,
  ): string {
    // `setId` scopes the identity-based path per photo set (2026-09-24 fix).
    // Without it, a student with the same CCCD captured under a SECOND set
    // (a different campaign, or a different card kind) collided on this
    // exact path: nextVersion() counts per set_id, so the first auto/ai/
    // upload variant of every set starts back at version 1, producing the
    // identical students/<CCCD>/final_card/auto-v1.png for both sets.
    // fs-core rejects the second set's upload with 409 ALREADY_REGISTERED
    // (a fresh Idempotency-Key against an already-registered path), and
    // VariantUploadWorkerService has no conflict handling for that (unlike
    // UploadWorkerService.resolvePathConflict for photos), so the second
    // set's variant was permanently FAILED. The session-id fallback branch
    // doesn't need this: it is already unique per capture session.
    const safeIdentity = identityNumber?.replace(/[^\w-]/g, '');
    if (safeIdentity) {
      return `students/${safeIdentity}/final_card/${setId}/${prefix}-v${version}.${ext}`;
    }
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
        // 'public' (not 'private'): file-service's owner-based ACL always
        // denies reads to private files here — Looka never sends
        // X-Owner-User-Id (it authenticates with a pure API key, so
        // owner_user_id stays null server-side), and viewerId passed to
        // issueViewLink is a per-module label, not a stable identity that
        // could ever match an owner. Access control is Looka's own
        // @RequirePermission guards before a link is ever minted; the
        // file-service key + share-token is the only thing that can reach
        // this URL. See D:\Work\file-service\projects\fs-engine\authz\authz.go
        // Decide() step 6 and shared.go's ResolveFileOwnership doc comment.
        visibility: 'public' as const,
      };
      if (input.tenantName) {
        await (
          await this.fileStorage.clientForTenant(input.tenantName)
        ).uploadRaw(uploadInput);
      } else {
        await this.fileStorage.uploadRaw(uploadInput);
      }
    } catch (error) {
      this.logger.warn(
        `best-effort metadata upload failed for ${input.virtualPath}: ${(error as Error).message}`,
      );
    }
  }

  private async lockSet(
    manager: EntityManager,
    id: string,
  ): Promise<SubjectPhotoSet> {
    const set = await manager.getRepository(SubjectPhotoSet).findOne({
      where: { id },
      lock: { mode: 'pessimistic_write' },
    });
    if (!set) {
      throw new CustomException(
        'Photo review set not found',
        PHOTO_REVIEW_ERROR_CODE.SET_NOT_FOUND,
        HttpStatus.NOT_FOUND,
      );
    }
    return set;
  }

  private async nextVersion(
    manager: EntityManager,
    setId: string,
  ): Promise<number> {
    const rows: Array<{ next: number }> = await manager.query(
      `SELECT COALESCE(MAX(version), 0) + 1 AS next FROM photo_variants WHERE set_id = $1`,
      [setId],
    );
    return rows[0]?.next ?? 1;
  }

  /** D-Q6's "quá hạn" formula — `dueAt` unset (no campaign SLA) or the set already decided means never overdue. */
  private computeOverdue(
    dueAt: Date | null | undefined,
    status: PhotoReviewSetStatus,
  ): boolean {
    if (!dueAt) return false;
    if (
      status === PhotoReviewSetStatus.APPROVED ||
      status === PhotoReviewSetStatus.REJECTED
    )
      return false;
    return new Date(dueAt).getTime() < Date.now();
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
   * Raises `PhotoSetStatusChangedEvent` for a real `subject_photo_sets.status`
   * transition — called from every site in this service that assigns
   * `.status` on a locked/loaded set, right after the entity save. A no-op
   * reassignment (`fromStatus === toStatus`, e.g. re-approving an already
   * APPROVED set) is skipped — this module has nothing else meaningful to
   * say about it, and it keeps `PrintModule`'s handler from doing redundant
   * work on every idempotent double-click.
   *
   * `manager` MUST be the same one the caller's own `dataSource.transaction`
   * callback was given — `TransactionContext.run` binds it for the duration
   * of `dispatcher.dispatch()` so a handler's `TransactionContext.manager()`
   * resolves to it (see `PhotoSetStatusChangedEvent`'s own doc comment). A
   * handler that throws propagates out of this call and rolls the caller's
   * whole transaction back with it — that is intentional dispatcher
   * behavior, not a bug here.
   */
  private async raiseStatusChangeEvent(
    manager: EntityManager,
    setId: string,
    campaignId: string,
    fromStatus: PhotoReviewSetStatus,
    toStatus: PhotoReviewSetStatus,
  ): Promise<void> {
    if (fromStatus === toStatus) return;
    await this.transactionContext.run(manager, () =>
      this.domainEventDispatcher.dispatch([
        new PhotoSetStatusChangedEvent(setId, campaignId, fromStatus, toStatus),
      ]),
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
    creatorName?: string,
  ): Promise<PhotoVariantDao> {
    const dao = toDao(PhotoVariantDao, variant);
    dao.createdByName = creatorName ?? undefined;
    const source = await this.resolveVariantViewSource(variant);
    if (source.kind === 'remote') {
      try {
        const link = await this.fileStorage.issueViewLink(
          source.fsFileId,
          'photo-review',
          tenantName,
        );
        dao.viewUrl = link.url;
        dao.viewUrlExpiresAt = link.expiresAt;
        return dao;
      } catch (error) {
        this.logger.warn(
          `view-link failed for variant ${variant.id}: ${(error as Error).message}`,
        );
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
        const link = await this.fileStorage.issueViewLink(
          fsFileId,
          'photo-review',
          tenantName,
        );
        return { url: link.url, expiresAt: link.expiresAt };
      } catch (error) {
        this.logger.warn(
          `current-card view-link failed for variant ${variantId}: ${(error as Error).message}`,
        );
      }
    }
    if (await this.hasLocalVariantContent(variantId)) {
      const local = this.issueLocalVariantViewLink(variantId, apiBaseUrl);
      return { url: local.url, expiresAt: local.expiresAt };
    }
    return {};
  }

  // ── GET /v1/review/sets ─────────────────────────────────────────────

  async listSets(
    query: ListSetsQueryDto,
    apiBaseUrl: string,
    actorUserId: string | null = null,
  ): Promise<Pagination<ReviewSetListItemDao>> {
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
    if (query.missingCard === true)
      conditions.push('s.current_card_variant_id IS NULL');
    if (query.missingCard === false)
      conditions.push('s.current_card_variant_id IS NOT NULL');
    if (query.className) {
      params.push(query.className);
      conditions.push(`s.class_name = $${params.length}`);
    }
    if (query.major) {
      params.push(query.major);
      conditions.push(`s.major = $${params.length}`);
    }
    if (query.faculty) {
      params.push(query.faculty);
      conditions.push(`s.faculty = $${params.length}`);
    }
    if (query.citizenId) {
      params.push(query.citizenId);
      conditions.push(`s.citizen_id = $${params.length}`);
    }
    if (query.subjectCode) {
      params.push(query.subjectCode);
      conditions.push(`s.subject_code = $${params.length}`);
    }
    if (query.q) {
      params.push(`%${query.q}%`);
      conditions.push(
        `(s.subject_code ILIKE $${params.length} OR s.subject_name ILIKE $${params.length})`,
      );
    }
    // plan §5.2, feature 13 (PER-CAMPAIGN pivot 2026-09-28) — a non-admin
    // reviewer only ever sees sets matching a whole-campaign or group row
    // they hold; zero rows anywhere means zero results, not unrestricted.
    const scopeFilter = await this.reviewAssignments.buildScopeFilter(
      actorUserId,
      params.length,
    );
    if (scopeFilter) {
      params.push(...scopeFilter.params);
      conditions.push(scopeFilter.sql);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const outerConditions: string[] = [];
    if (query.hasAi === true) outerConditions.push('has_ai = true');
    if (query.hasAi === false) outerConditions.push('has_ai = false');
    if (query.hasUpload === true) outerConditions.push('has_upload = true');
    if (query.hasUpload === false) outerConditions.push('has_upload = false');
    // due_at + overdue — cms-8-screens-api-plan.md §2.4/D-Q6: "quá hạn" only
    // applies once a due_at is actually set (campaign has an SLA), and never
    // to an already-decided set.
    const overdueExpr =
      "due_at IS NOT NULL AND due_at < now() AND status NOT IN ('APPROVED', 'REJECTED')";
    if (query.overdue === true) outerConditions.push(overdueExpr);
    if (query.overdue === false) outerConditions.push(`NOT (${overdueExpr})`);
    if (query.approved === true) outerConditions.push("status = 'APPROVED'");
    if (query.approved === false) outerConditions.push("status <> 'APPROVED'");
    const outerWhere = outerConditions.length
      ? `WHERE ${outerConditions.join(' AND ')}`
      : '';

    const cte = `
      WITH agg AS (
        SELECT
          s.id, s.campaign_id, c.name AS campaign_name, s.subject_code, s.subject_name, s.kind_id, k.code AS kind_code,
          s.source_session_id, s.status, s.current_card_variant_id, s.created_at, s.updated_at,
          s.class_name, s.major, s.faculty, s.citizen_id, s.due_at,
          cv.fs_file_id AS current_fs_file_id,
          cv.fs_status AS current_fs_status,
          COALESCE(u.display_name, u.email) AS operator_name,
          (SELECT v2.note FROM photo_variants v2
             WHERE v2.set_id = s.id AND v2.status = 'FAILED'
             ORDER BY v2.version DESC LIMIT 1) AS fail_reason,
          EXISTS (SELECT 1 FROM photo_variants v WHERE v.set_id = s.id AND v.kind = 'CARD_AI' AND v.status <> 'DISCARDED') AS has_ai,
          EXISTS (SELECT 1 FROM photo_variants v WHERE v.set_id = s.id AND v.kind = 'CARD_UPLOAD' AND v.status <> 'DISCARDED') AS has_upload
        FROM subject_photo_sets s
        LEFT JOIN campaigns c ON c.id = s.campaign_id
        LEFT JOIN photo_kinds k ON k.id = s.kind_id
        LEFT JOIN photo_variants cv ON cv.id = s.current_card_variant_id
        LEFT JOIN sessions se ON se.id = s.source_session_id
        LEFT JOIN users u ON u.id = se.operator_user_id
        ${where}
      )
      SELECT * FROM agg ${outerWhere}
    `;

    const countRows: Array<{ count: number }> = await this.dataSource.query(
      `SELECT COUNT(*)::int AS count FROM (${cte}) t`,
      params,
    );
    const totalItems = countRows[0]?.count ?? 0;

    // 2026-09-22 product ask: APPROVED sets sink to the bottom, everything
    // still actionable floats to the top — `(status = 'APPROVED')` is
    // `false` (sorts first) for every non-approved status, `true` (sorts
    // last) only for APPROVED; `updated_at DESC` is the secondary/original
    // order within each of those two groups.
    const rows: Array<Record<string, unknown>> = await this.dataSource.query(
      `${cte} ORDER BY (status = 'APPROVED') ASC, updated_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
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
        campaignName: row.campaign_name ?? undefined,
        subjectCode: row.subject_code,
        subjectName: row.subject_name ?? undefined,
        kindId: row.kind_id,
        kindCode: row.kind_code ?? undefined,
        sourceSessionId: row.source_session_id,
        status: row.status,
        currentCardVariantId: row.current_card_variant_id ?? undefined,
        failReason: row.fail_reason ?? undefined,
        currentCardViewUrl: links[i]?.url,
        currentCardViewUrlExpiresAt: links[i]?.expiresAt,
        hasAi: row.has_ai,
        hasUpload: row.has_upload,
        className: row.class_name ?? undefined,
        major: row.major ?? undefined,
        faculty: row.faculty ?? undefined,
        citizenId: row.citizen_id ?? undefined,
        operatorName: row.operator_name ?? undefined,
        dueAt: row.due_at ?? undefined,
        overdue: this.computeOverdue(
          row.due_at as Date | null,
          row.status as PhotoReviewSetStatus,
        ),
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

  /**
   * `actorUserId` is only passed by `ReviewController.getSetDetail` (the
   * direct `GET /v1/review/sets/:id` route) — every internal call site
   * (`reprocess`/`setCurrent`/`transitionSetStatus` re-fetching the whole
   * set after a mutation) omits it, since scope was already checked earlier
   * in that same handler and re-checking here would just be a redundant
   * round trip against the same actor/set pair.
   */
  async getSetDetail(
    id: string,
    apiBaseUrl: string,
    actorUserId: string | null = null,
  ): Promise<ReviewSetDetailDao> {
    const rows: Array<Record<string, unknown>> = await this.dataSource.query(
      `SELECT s.id, s.campaign_id, c.name AS campaign_name, s.subject_code, s.subject_name, s.kind_id, k.code AS kind_code,
              s.source_session_id, s.status, s.current_card_variant_id, s.created_at, s.updated_at,
              s.class_name, s.major, s.faculty, s.citizen_id, s.due_at,
              COALESCE(u.display_name, u.email) AS operator_name,
              se.created_at AS source_captured_at,
              dev.name AS source_device_name,
              (SELECT v2.note FROM photo_variants v2
                 WHERE v2.set_id = s.id AND v2.status = 'FAILED'
                 ORDER BY v2.version DESC LIMIT 1) AS fail_reason
         FROM subject_photo_sets s
         LEFT JOIN campaigns c ON c.id = s.campaign_id
         LEFT JOIN photo_kinds k ON k.id = s.kind_id
         LEFT JOIN sessions se ON se.id = s.source_session_id
         LEFT JOIN users u ON u.id = se.operator_user_id
         LEFT JOIN devices dev ON dev.id = se.device_id
        WHERE s.id = $1`,
      [id],
    );
    const row = rows[0];
    if (!row) {
      throw new CustomException(
        'Photo review set not found',
        PHOTO_REVIEW_ERROR_CODE.SET_NOT_FOUND,
        HttpStatus.NOT_FOUND,
      );
    }
    await this.reviewAssignments.assertInScope(actorUserId, {
      campaignId: row.campaign_id as string,
      className: row.class_name as string | null,
      faculty: row.faculty as string | null,
      major: row.major as string | null,
    });

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
        `SELECT e.id, e.set_id, e.variant_id, e.action, e.actor_user_id, e.payload, e.at,
                COALESCE(u.display_name, u.email) AS actor_name
           FROM photo_review_events e
           LEFT JOIN users u ON u.id = e.actor_user_id
          WHERE e.set_id = $1
          ORDER BY e.at DESC
          LIMIT 50`,
        [id],
      ),
    ]);

    const nonDiscardedVariants = variantRows.filter(
      (v) => v.status !== PhotoVariantStatus.DISCARDED,
    );
    const creatorNameMap = await this.batchResolveUserNames(
      nonDiscardedVariants
        .map((v) => v.createdByUserId)
        .filter((v): v is string => !!v),
    );
    const variants = await Promise.all(
      nonDiscardedVariants.map((v) =>
        this.toVariantDao(
          v,
          apiBaseUrl,
          tenantName,
          v.createdByUserId ? creatorNameMap.get(v.createdByUserId) : undefined,
        ),
      ),
    );

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
      campaignName: row.campaign_name ?? undefined,
      subjectCode: row.subject_code,
      subjectName: row.subject_name ?? undefined,
      kindId: row.kind_id,
      kindCode: row.kind_code ?? undefined,
      sourceSessionId: sessionId,
      status: row.status,
      currentCardVariantId: row.current_card_variant_id ?? undefined,
      failReason: row.fail_reason ?? undefined,
      currentCardViewUrl,
      currentCardViewUrlExpiresAt,
      hasAi: nonDiscardedVariants.some(
        (v) => v.kind === PhotoVariantKind.CARD_AI,
      ),
      hasUpload: nonDiscardedVariants.some(
        (v) => v.kind === PhotoVariantKind.CARD_UPLOAD,
      ),
      className: row.class_name ?? undefined,
      major: row.major ?? undefined,
      faculty: row.faculty ?? undefined,
      citizenId: row.citizen_id ?? undefined,
      operatorName: row.operator_name ?? undefined,
      sourceCapturedAt: row.source_captured_at ?? undefined,
      sourceDeviceName: row.source_device_name ?? undefined,
      dueAt: row.due_at ?? undefined,
      overdue: this.computeOverdue(
        row.due_at as Date | null,
        row.status as PhotoReviewSetStatus,
      ),
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
        actorName: e.actor_name ?? undefined,
        payload: e.payload ?? undefined,
        at: e.at,
      })),
    });
  }

  // ── AI processing pipeline (`ai_pipeline_steps` executor, 2026-09-28) ───

  /**
   * A campaign's effective AI-processing steps — its pinned workflow
   * version's `config.aiProcessing`, same "campaign → `workflow_version_id`
   * → `WorkflowCatalogReadRepository.getVersionRef`" resolution
   * `CampaignService.toCampaignResponse` already uses for `captureAngles`/
   * `cardSpec` (`device-management/services/campaign.service.ts`) — read via
   * plain SQL against `campaigns` (this module owns no entity there, same
   * cross-boundary-read convention as `sessions`/`photos` elsewhere in this
   * file), never an entity import. Returns `[]` (meaning: caller should fall
   * back to today's single hardcoded card-crop) whenever there is no
   * campaign, no pinned workflow version, or the workflow's own
   * `aiProcessing.enabled` is `false` — i.e. every campaign that predates
   * this feature keeps behaving exactly as before, with zero config needed.
   */
  private async resolveAiProcessingSteps(
    campaignId: string | null,
  ): Promise<WorkflowConfig['aiProcessing']['steps']> {
    if (!campaignId) return [];
    const rows: Array<{ workflow_version_id: string | null }> =
      await this.dataSource.query(
        `SELECT workflow_version_id FROM campaigns WHERE id = $1`,
        [campaignId],
      );
    const versionId = rows[0]?.workflow_version_id;
    if (!versionId) return [];
    const ref = await this.workflowCatalog.getVersionRef(versionId);
    if (!ref?.config.aiProcessing?.enabled) return [];
    return ref.config.aiProcessing.steps ?? [];
  }

  /**
   * Effective cardSpec for a set's photo pipeline — same override
   * precedence `CampaignService.toCampaignResponse` already documents and
   * applies for `GET /campaigns` ("an explicit campaign-level value always
   * wins"): the campaign's own `card_spec` column, else the pinned workflow
   * version's `config.output.cardSpec`, else the given photo kind's own
   * `cardSpec` (this module's long-standing fallback before this method
   * existed — kept as the last resort so a campaign with no opinion at all,
   * or no campaign at all, keeps working exactly as before). Without this,
   * `reprocess()`/`aiEdit()`/`uploadVariant()` all silently ignored a
   * campaign's own card_spec override and the pinned workflow's
   * `output.cardSpec`, always sizing/coloring the card from the hardcoded
   * `STUDENT_CARD` kind alone. Raw SQL against `campaigns`, same
   * cross-module-boundary convention as `resolveAiProcessingSteps` above.
   */
  private async resolveEffectiveCardSpec(
    campaignId: string | null,
    kindCardSpec: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    if (!campaignId) return kindCardSpec;
    const rows: Array<{
      card_spec: Record<string, unknown> | null;
      workflow_version_id: string | null;
    }> = await this.dataSource.query(
      `SELECT card_spec, workflow_version_id FROM campaigns WHERE id = $1`,
      [campaignId],
    );
    const row = rows[0];
    if (!row) return kindCardSpec;
    if (row.card_spec) return row.card_spec;
    if (row.workflow_version_id) {
      const ref = await this.workflowCatalog.getVersionRef(
        row.workflow_version_id,
      );
      const versionCardSpec = ref?.config.output?.cardSpec as
        Record<string, unknown> | undefined;
      if (versionCardSpec) return versionCardSpec;
    }
    return kindCardSpec;
  }

  /**
   * Runs a campaign's configured `ai_pipeline_steps` in order, each step's
   * output feeding the next — the catalog's own worked example is
   * CARD_CROP → BACKGROUND_REPLACE → SKIN_SMOOTH → AI_EDIT (see
   * `1813000000000-CreateAiPipelineSteps.ts`'s seed data). `steps` empty
   * (the overwhelmingly common case today — see `resolveAiProcessingSteps`)
   * takes a dedicated fast path: exactly the single `makeCardPhoto` call
   * this method always made before the executor existed, independent of
   * whether a `CARD_CROP` catalog row even exists — a campaign with no
   * opinion about AI processing must keep working even if the catalog is
   * empty or misconfigured.
   *
   * Only `CARD_CROP` (`/card-photo`) and `AI_EDIT` (`/edit`) steps actually
   * dispatch anywhere real — `BACKGROUND_REPLACE` (`/background`) and
   * `SKIN_SMOOTH` (`/retouch`) have no `PhotoAiPort` method at all (neither
   * ever got a real client implementation, and both would target the same
   * dead `services/python-ai` sidecar `makeCardPhoto`/`identitySimilarity`
   * already accept as a known gap — see `PhotoAiAdapter`'s own doc
   * comment). A configured step of either kind is logged and skipped
   * (pass-through, not a pipeline failure) rather than invented client code
   * against an endpoint nothing serves.
   *
   * `mirror` only applies to the FIRST step that actually touches pixels —
   * it corrects the raw sensor capture to match what the subject saw in the
   * live-view mirror (see `SidecarCardPhotoInput.mirror`'s own doc
   * comment); every later step in the chain is already correctly oriented.
   */
  private async runAiProcessingPipeline(input: {
    steps: WorkflowConfig['aiProcessing']['steps'];
    initialImageBase64: string;
    cardSpec: Record<string, unknown>;
    mirror: boolean;
  }): Promise<{
    imageBase64: string;
    mimeType: string;
    width: number | null;
    height: number | null;
    dpi: number | null;
    warnings: string[];
  }> {
    if (input.steps.length === 0) {
      const value = unwrapPhotoAi(
        await this.photoAi.makeCardPhoto({
          imageBase64: input.initialImageBase64,
          cardSpec: input.cardSpec,
          mirror: input.mirror,
        }),
      );
      return { ...value, warnings: value.warnings ?? [] };
    }

    const catalog = await this.loadAiPipelineStepCatalog(
      input.steps.map((s) => s.code),
    );

    let imageBase64 = input.initialImageBase64;
    let mimeType = 'image/jpeg';
    let width: number | null = null;
    let height: number | null = null;
    let dpi: number | null = null;
    const warnings: string[] = [];
    let mirrorNextStep = input.mirror;
    // How many steps actually touched pixels (`/card-photo` or `/edit`) —
    // an inactive/missing/unimplemented step is a documented pass-through,
    // but a NON-EMPTY `steps` list that ends up executing ZERO of them
    // (every step inactive/unknown, or only `/background`/`/retouch`,
    // neither of which is implemented) must not silently succeed with the
    // untouched original capture as if it were a real result — see the
    // throw below.
    let executedSteps = 0;

    for (const step of input.steps) {
      const entry = catalog.get(step.code);
      if (!entry || !entry.active) {
        const warning = `AI pipeline step "${step.code}" not found or inactive in ai_pipeline_steps — skipped`;
        this.logger.warn(warning);
        warnings.push(warning);
        continue;
      }
      switch (entry.sidecarEndpoint) {
        case '/card-photo': {
          const value = unwrapPhotoAi(
            await this.photoAi.makeCardPhoto({
              imageBase64,
              cardSpec: input.cardSpec,
              mirror: mirrorNextStep,
            }),
          );
          imageBase64 = value.imageBase64;
          mimeType = value.mimeType;
          width = value.width;
          height = value.height;
          dpi = value.dpi;
          warnings.push(...(value.warnings ?? []));
          mirrorNextStep = false;
          executedSteps += 1;
          break;
        }
        case '/edit': {
          // The external /edit service has no `mirror` parameter at all
          // (see this method's own doc comment on `mirrorNextStep` and
          // `aiEdit()`'s identical note) — when `/edit` is the FIRST step to
          // actually touch pixels, the mirror this pipeline still owes the
          // subject (2026-09-10 product decision: the live-view preview is
          // mirrored, the raw capture is not) would otherwise be silently
          // dropped. Applied locally with `sharp` instead of being lost.
          if (mirrorNextStep) {
            imageBase64 = await sharp(Buffer.from(imageBase64, 'base64'))
              .flop()
              .toBuffer()
              .then((buf) => buf.toString('base64'));
          }
          // Step-level `params` (a workflow author's per-step override) wins
          // over the catalog row's own `default_params` — same precedence
          // for every one of these five, not just `prompt`.
          const resolve = <T>(key: string): T | undefined =>
            (step.params?.[key] as T | undefined) ??
            (entry.defaultParams?.[key] as T | undefined);
          // `width`/`height` fall back once more, to `cardSpecToEditDimensions`
          // — same "always match the configured output format" rule
          // `aiEdit()` applies (2026-09-28 user decision; see that method's
          // own comment), so a step that specifies neither still gets a
          // correctly-sized result rather than the service's own
          // auto-computed aspect ratio.
          const cardDimensions = this.cardSpecToEditDimensions(input.cardSpec);
          const requestedWidth =
            resolve<number>('width') ?? cardDimensions.width;
          const requestedHeight =
            resolve<number>('height') ?? cardDimensions.height;
          const rawStepPrompt = resolve<string>('prompt');
          // 2026-09-29 user decision — a catalog/workflow-configured prompt
          // reaches the real generative model exactly like a reviewer's own
          // free-text prompt does (aiEdit()), so it gets the exact same
          // FORBIDDEN_PROMPT_KEYWORDS guard; this path had none before.
          // Checked on the RAW resolved prompt, before the background-color
          // instruction is appended below — that instruction is app-written,
          // not user/workflow-author input, so it can never itself trip the
          // filter and does not need re-checking.
          if (rawStepPrompt) {
            const hit = this.findForbiddenPromptKeyword(rawStepPrompt);
            if (hit) {
              throw new PhotoAiError(
                `AI pipeline step "${step.code}" prompt contains a forbidden keyword ("${hit}") — see plan §6.3`,
                'Terminal',
              );
            }
          }
          const stepPrompt = this.appendBackgroundColorInstruction(
            rawStepPrompt,
            input.cardSpec,
          );
          const value = unwrapPhotoAi(
            await this.photoAi.edit({
              imageBuffer: Buffer.from(imageBase64, 'base64'),
              mimeType,
              prompt: stepPrompt,
              cfg: resolve<number>('cfg'),
              steps: resolve<number>('steps'),
              seed: resolve<number>('seed'),
              width: requestedWidth,
              height: requestedHeight,
            }),
          );
          imageBase64 = value.imageBuffer.toString('base64');
          mimeType = value.mimeType;
          // The service rounds its output down to a multiple of 16 (its own
          // documented behavior — see AiImageEditClient) and returns a plain
          // JPEG with no dpi metadata at all. Any width/height/dpi carried
          // over from an earlier `/card-photo` step no longer describes
          // this image, so it is replaced with the requested dimensions
          // (the closest known approximation — off by at most 15px) rather
          // than left stale, and dpi is cleared since `/edit` has none.
          width = requestedWidth ?? null;
          height = requestedHeight ?? null;
          dpi = null;
          mirrorNextStep = false;
          executedSteps += 1;
          // 2026-09-29 user decision (kept auto-promoting the pipeline's
          // result as the set's current card, rather than requiring a
          // separate human accept like aiEdit()'s CARD_AI does — see the
          // authz-trust-boundary audit finding on this method) — the one
          // thing that must not stay silent is that a GENERATIVE step ran:
          // unlike a deterministic `/card-photo` crop, this pixel content
          // was regenerated by a model with no identity check of its own.
          // Surfaced into `warnings` (→ `variant.qualityReport`, visible in
          // the CMS review panel), not just the server log.
          warnings.push(
            `Step "${step.code}" applied a generative AI edit (/edit) — no automated identity check ran on this result; review the face carefully before Duyệt.`,
          );
          break;
        }
        case '/background':
        case '/retouch': {
          const warning = `AI pipeline step "${step.code}" (${entry.sidecarEndpoint}) has no PhotoAiPort implementation yet — skipped as a known gap, image passed through unchanged`;
          this.logger.warn(warning);
          warnings.push(warning);
          break;
        }
        default: {
          const warning = `AI pipeline step "${step.code}" has unknown sidecar_endpoint "${entry.sidecarEndpoint}" — skipped`;
          this.logger.warn(warning);
          warnings.push(warning);
        }
      }
    }

    if (executedSteps === 0) {
      // A configured, non-empty pipeline that never actually touches the
      // image (every step inactive/unknown, or only the unimplemented
      // `/background`/`/retouch`) used to return the untouched original
      // capture — uncropped, unmirrored, null width/height/dpi — as if it
      // were a successful result, which `reprocess()` would then save as
      // the set's READY current card. Failing loudly here routes it through
      // the exact same AUTO_FAILED path a real sidecar failure already
      // takes, instead of silently promoting a raw capture as a finished
      // "4x6 card".
      throw new SidecarError(
        `AI pipeline configured with ${input.steps.length} step(s) but none of them executed (inactive/unknown/unimplemented) — ${warnings.join('; ')}`,
      );
    }

    return { imageBase64, mimeType, width, height, dpi, warnings };
  }

  /**
   * Physical card size (`cardSpec.size`, e.g. `'4x6'` — centimeters) + dpi
   * → the `width`/`height` `PhotoAiPort.edit()` should request, so an
   * AI-edited image comes out already sized for the target card instead of
   * whatever aspect ratio the service auto-computes from the input. Same
   * cm→pixel math `services/python-ai`'s own `CARD_PHOTO_PIXEL_TABLE` used
   * before its 2026-09-28 removal (`docs/plans/card-photo-export-and-filters-plan-2026-09-17.md`
   * §F.1's own table: 4x6@300dpi → 472×709, etc.) — computed here instead
   * of hardcoded, since only two `dpi` values and two `size` values exist
   * today (`workflow-config.schema.ts`'s `cardSpecSchema`) but the formula
   * generalizes without needing a new table entry if a third ever does.
   *
   * This is NOT a face-aware crop — 2026-09-28, the user was asked
   * explicitly whether "auto focus vào mặt" should mean real face
   * detection (no such capability exists anywhere in this backend, client
   * or server) or just matching the configured output size, and chose the
   * latter (see this task's own AskUserQuestion). The integration guide's
   * own "những chỗ dễ nhầm" note still applies: the service reshapes the
   * canvas to this aspect ratio, it does not locate or center the face
   * within it.
   *
   * Returns `{}` (both fields omitted) when `cardSpec` doesn't carry a
   * parseable `size`/`dpi` — callers spread the result into `edit()`'s
   * input, so an empty object just means "let the service pick", the same
   * fallback as before this feature existed.
   */
  private cardSpecToEditDimensions(cardSpec: Record<string, unknown>): {
    width?: number;
    height?: number;
  } {
    const size = typeof cardSpec.size === 'string' ? cardSpec.size : null;
    const dpi = typeof cardSpec.dpi === 'number' ? cardSpec.dpi : null;
    const match = size ? /^(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)$/i.exec(size) : null;
    if (!match || !dpi) return {};
    const CM_PER_INCH = 2.54;
    const widthCm = Number(match[1]);
    const heightCm = Number(match[2]);
    return {
      width: Math.round((widthCm / CM_PER_INCH) * dpi),
      height: Math.round((heightCm / CM_PER_INCH) * dpi),
    };
  }

  /**
   * `/edit` has no dedicated background-color field at all (its full
   * parameter set is `image`/`prompt`/`cfg`/`steps`/`seed`/`width`/`height`
   * — see the integration guide) — the only way to steer the output's
   * background is to describe it IN the prompt text itself. Confirmed
   * working via live testing 2026-09-28: a busy real background (plants,
   * string lights, signage) was fully replaced by a flat color from a
   * prompt instruction alone. Not pixel-exact to the given hex (the model
   * reads "orange #F37320" as a color description, not a strict spec) —
   * an accepted approximation, not a guarantee.
   *
   * Always appended (rather than only when the caller's own prompt is
   * silent about background) — 2026-09-28 user decision: every AI edit
   * should push the output toward the configured card background,
   * regardless of what a reviewer's own free-text prompt says, so the
   * result stays background-compliant by default.
   */
  private appendBackgroundColorInstruction(
    prompt: string | undefined,
    cardSpec: Record<string, unknown>,
  ): string | undefined {
    const color =
      typeof cardSpec.backgroundColor === 'string'
        ? cardSpec.backgroundColor.trim()
        : null;
    if (!color) return prompt;
    const instruction = `Change the background to a solid, flat, evenly lit color, hex ${color}, with no texture, shadows, or objects. Keep the subject unchanged — do not alter the face, expression, hair, or clothing.`;
    return prompt ? `${prompt}\n\n${instruction}` : instruction;
  }

  /**
   * Strips Vietnamese diacritics (both combining-mark forms and the
   * dedicated `đ`/`Đ` letter, which does not decompose under NFD) — used
   * only for `FORBIDDEN_PROMPT_KEYWORDS` matching, so a prompt without
   * diacritics or encoded in NFD still matches the same keyword an
   * NFC-with-diacritics prompt would. The caller is expected to have
   * already called `.normalize('NFC')` first (see the one call site).
   */
  private stripDiacriticsForPromptFilter(text: string): string {
    return text
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/đ/g, 'd')
      .replace(/Đ/g, 'D');
  }

  /**
   * Normalized (NFC, diacritics stripped, lowercased) `FORBIDDEN_PROMPT_KEYWORDS`
   * match — factored out of `aiEdit()` so `runAiProcessingPipeline`'s
   * `/edit` step can apply the exact same guard (2026-09-29 user decision:
   * a catalog `default_params.prompt`/workflow `step.params.prompt` reaches
   * the real generative model exactly like a reviewer's own free-text
   * prompt does, and had no filter at all before this — see the
   * authz-trust-boundary audit finding on this pipeline). Returns the
   * matched keyword, or `undefined` when clean.
   */
  private findForbiddenPromptKeyword(prompt: string): string | undefined {
    const normalizedPrompt = this.stripDiacriticsForPromptFilter(
      prompt.normalize('NFC'),
    ).toLowerCase();
    return FORBIDDEN_PROMPT_KEYWORDS.find((kw) =>
      normalizedPrompt.includes(
        this.stripDiacriticsForPromptFilter(kw.normalize('NFC')).toLowerCase(),
      ),
    );
  }

  private async loadAiPipelineStepCatalog(codes: string[]): Promise<
    Map<
      string,
      {
        active: boolean;
        sidecarEndpoint: string;
        defaultParams: Record<string, unknown> | null;
      }
    >
  > {
    if (codes.length === 0) return new Map();
    const rows: Array<{
      code: string;
      active: boolean;
      sidecar_endpoint: string;
      default_params: Record<string, unknown> | null;
    }> = await this.dataSource.query(
      `SELECT code, active, sidecar_endpoint, default_params
         FROM ai_pipeline_steps WHERE code = ANY($1)`,
      [codes],
    );
    return new Map(
      rows.map((r) => [
        r.code,
        {
          active: r.active,
          sidecarEndpoint: r.sidecar_endpoint,
          defaultParams: r.default_params,
        },
      ]),
    );
  }

  // ── POST /v1/review/sets/:id/reprocess ──────────────────────────────

  /**
   * Allowed even when locked — this is how a set gets OUT of `PENDING_AUTO`
   * (first ever card) or `AUTO_FAILED` (retry), per plan §4/R-Q1.
   *
   * Defensive by design: the actual image pipeline runs through
   * `PhotoAiPort` (a campaign-configured `ai_pipeline_steps` sequence when
   * one exists, else the single hardcoded card-crop this method always did
   * — see `runAiProcessingPipeline`'s own doc comment). Any failure —
   * unreachable, non-2xx, timeout — must resolve to a clean `AUTO_FAILED`
   * state, never an unhandled crash or a hanging request.
   */
  async reprocess(
    setId: string,
    actorUserId: string | null,
    apiBaseUrl: string,
  ): Promise<ReviewSetDetailDao> {
    const set = await this.findSetEntityOrFail(setId);
    // Not covered by `assertUnlocked` (deliberately, per R-Q1) but still a
    // per-record write action — plan §5.2's scope guard applies here too,
    // otherwise a scoped-out reviewer could bypass every other restriction
    // through this one route.
    await this.reviewAssignments.assertInScope(actorUserId, set);

    // Single-flight guard (2026-09-29): with the `ai_pipeline_steps`
    // executor wired up, one run can now take minutes (an `AI_EDIT` step's
    // `/edit` call queues on a single-worker GPU service). Before this
    // guard, two overlapping runs for the same set — the kiosk's own
    // no-in-flight-guard resend loop re-POSTing the same un-acked
    // SESSION_REPORT batch every ~15s is one source, a reviewer's manual
    // "Tạo lại ảnh 4x6" click landing mid-auto-run is another — would each
    // create their own PROCESSING `CARD_AUTO` variant and queue their own
    // AI request on top of whatever is already running. A variant already
    // `PROCESSING` for this set means a run is already in flight; skip
    // starting a second one rather than stacking work on the AI service.
    const alreadyProcessing = await this.variantRepository.findOne({
      where: {
        setId,
        kind: PhotoVariantKind.CARD_AUTO,
        status: PhotoVariantStatus.PROCESSING,
      },
    });
    if (alreadyProcessing) {
      this.logger.warn(
        `reprocess: set ${setId} already has a PROCESSING CARD_AUTO variant (${alreadyProcessing.id}) — skipping duplicate run`,
      );
      return this.getSetDetail(setId, apiBaseUrl);
    }

    const kind = await this.photoKindService.findKindEntityOrFail(set.kindId);
    const sessionContext = await this.resolveSessionContext(
      set.sourceSessionId,
    );
    const frontPhoto = await this.findFrontSourcePhoto(set.sourceSessionId);
    if (!frontPhoto) {
      throw new CustomException(
        "No original photo found for this set's source session",
        PHOTO_REVIEW_ERROR_CODE.SOURCE_PHOTO_NOT_FOUND,
        HttpStatus.NOT_FOUND,
      );
    }

    // Snapshot of "what the set pointed at when this run started" — used
    // after the (now potentially long) pipeline run below to detect
    // whether a human action (approve/reject/accept/discard/setCurrent)
    // moved the set on in the meantime, so this run's result never
    // silently overwrites something newer than itself. See the two
    // transactions below.
    const snapshotCurrentVariantId = set.currentCardVariantId ?? null;

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
      const sourceBytes = await this.readSourcePhotoBytes(
        frontPhoto,
        sessionContext.tenantName,
      );
      const aiSteps = await this.resolveAiProcessingSteps(set.campaignId);
      const effectiveCardSpec = await this.resolveEffectiveCardSpec(
        set.campaignId,
        kind.cardSpec,
      );
      const result = await this.runAiProcessingPipeline({
        steps: aiSteps,
        initialImageBase64: sourceBytes.toString('base64'),
        cardSpec: effectiveCardSpec,
        mirror: true,
      });

      const ext = this.extForMime(result.mimeType);
      const virtualPath = this.buildVirtualPath(
        set.sourceSessionId,
        setId,
        sessionContext.year,
        'auto',
        variant.version,
        ext,
        sessionContext.identityNumber,
      );
      const data = Buffer.from(result.imageBase64, 'base64');

      await this.dataSource.transaction(async (manager) => {
        const lockedSet = await this.lockSet(manager, setId);
        const fromStatus = lockedSet.status;
        const stored = await this.storeVariantBytesLocalFirst(manager, {
          variantId: variant.id,
          tenantName: sessionContext.tenantName,
          virtualPath,
          mimeType: result.mimeType,
          data,
          idempotencyKey: `photo-review:${variant.id}:auto`,
        });

        // Guarded UPDATE, not a blind `save(variant)` on the in-memory
        // entity fetched BEFORE the (now potentially minutes-long) pipeline
        // run above — same stale-entity fix `aiEdit()` already uses (see
        // its own comment): a concurrent `discardVariant()` on this same
        // PROCESSING variant is legal, and without `WHERE status =
        // 'PROCESSING'` this would silently revert it back to READY.
        const [readyRows]: [Array<{ id: string }>, number] =
          await manager.query(
            `UPDATE photo_variants
                SET status = $2, virtual_path = $3, bytes = $4, sha256 = $5,
                    width = $6, height = $7, dpi = $8, quality_report = $9,
                    algorithm_version = $10, updated_at = now()
              WHERE id = $1 AND status = $11
              RETURNING id`,
            [
              variant.id,
              PhotoVariantStatus.READY,
              virtualPath,
              stored.bytes,
              stored.sha256,
              result.width ?? null,
              result.height ?? null,
              result.dpi ?? null,
              // The sidecar does not version its own pipeline output today
              // (see SidecarCardPhotoResult's own doc comment) — algorithm
              // version left null rather than a made-up constant, matching
              // "never a fabricated value" elsewhere in this module's own
              // sidecar-result handling.
              result.warnings.length
                ? JSON.stringify({ warnings: result.warnings })
                : null,
              null,
              PhotoVariantStatus.PROCESSING,
            ],
          );
        const appliedToReady = readyRows.length > 0;
        if (!appliedToReady) {
          this.logger.warn(
            `reprocess: variant ${variant.id} was discarded while its pipeline run was still in flight — result dropped, not resurrected`,
          );
          return;
        }

        await this.writeEvent(manager, {
          setId,
          variantId: variant.id,
          action: PhotoReviewAction.AUTO_GENERATED,
          actorUserId: null,
        });

        // Only promote this run's output to the set's current card / READY
        // when nothing else moved the set on while this run was in flight —
        // a human approve/reject/accept/discard/setCurrent landing mid-run
        // must win, never be silently overwritten by a now-stale auto
        // result (this method's own past bug: it used to force
        // `currentCardVariantId`/`status` unconditionally here). "Nothing
        // else moved it on" means both: the set still points at the same
        // current variant it did when this run started (an accept/discard/
        // setCurrent since then would have changed that), AND it has not
        // been explicitly approved or rejected by a reviewer (which leaves
        // `currentCardVariantId` untouched, so needs its own check).
        const safeToPromote =
          lockedSet.currentCardVariantId === snapshotCurrentVariantId &&
          lockedSet.status !== PhotoReviewSetStatus.APPROVED &&
          lockedSet.status !== PhotoReviewSetStatus.REJECTED;
        if (safeToPromote) {
          lockedSet.currentCardVariantId = variant.id;
          lockedSet.status = PhotoReviewSetStatus.READY;
          await manager.getRepository(SubjectPhotoSet).save(lockedSet);
          await this.raiseStatusChangeEvent(
            manager,
            setId,
            lockedSet.campaignId,
            fromStatus,
            lockedSet.status,
          );
        } else {
          this.logger.warn(
            `reprocess: set ${setId} moved on (status=${lockedSet.status}) while this run was in flight — new variant ${variant.id} saved READY but left out of review, not made current`,
          );
        }
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
          cardSpec: effectiveCardSpec,
        },
      });

      // Return the whole set (not just the variant) — this route feeds
      // the CMS's `withBusy()` action chain (approve/reject/setCurrent/
      // reprocess), which replaces its entire detail view with whatever
      // this resolves to; a bare `PhotoVariantDao` here used to leave that
      // view with no `variants`/`originalPhotos`/`events` array to render
      // (plan B1, 2026-09-18).
      return this.getSetDetail(setId, apiBaseUrl);
    } catch (error) {
      const message = extractSidecarFailureMessage(error);
      this.logger.warn(`reprocess failed for set ${setId}: ${message}`);
      await this.dataSource.transaction(async (manager) => {
        const lockedSet = await this.lockSet(manager, setId);
        const fromStatus = lockedSet.status;
        // Guarded UPDATE — same stale-entity reasoning as the success path
        // above: a concurrent discardVariant() on this PROCESSING variant
        // is legal while the pipeline was running.
        await manager.query(
          `UPDATE photo_variants SET status = $2, note = $3, updated_at = now()
             WHERE id = $1 AND status = $4`,
          [
            variant.id,
            PhotoVariantStatus.FAILED,
            message,
            PhotoVariantStatus.PROCESSING,
          ],
        );

        await this.writeEvent(manager, {
          setId,
          variantId: variant.id,
          action: PhotoReviewAction.AUTO_FAILED,
          actorUserId: null,
          payload: { error: message },
        });

        // Only demote the SET to AUTO_FAILED when it has no valid current
        // card to fall back on (a first-ever run, or an already-failed
        // retry) — this method's own past bug: it used to force
        // `AUTO_FAILED` unconditionally here, which (since `AUTO_FAILED` is
        // a LOCKED status) could silently destroy an APPROVED/READY/
        // IN_REVIEW/REJECTED set's existing, still-valid card the moment a
        // reprocess attempt failed for any reason (including the makeCardPhoto
        // sidecar being permanently unreachable). When the set already has a
        // current card, only the failed variant is recorded; the set's
        // status and current card are left exactly as they were.
        const safeToFail =
          lockedSet.status === PhotoReviewSetStatus.PENDING_AUTO ||
          lockedSet.status === PhotoReviewSetStatus.AUTO_FAILED ||
          !lockedSet.currentCardVariantId;
        if (safeToFail) {
          lockedSet.status = PhotoReviewSetStatus.AUTO_FAILED;
          await manager.getRepository(SubjectPhotoSet).save(lockedSet);
          await this.reviewStats.recordAutoFailed(
            manager,
            set.campaignId,
            new Date(),
          );
          await this.raiseStatusChangeEvent(
            manager,
            setId,
            lockedSet.campaignId,
            fromStatus,
            lockedSet.status,
          );
        } else {
          this.logger.warn(
            `reprocess: set ${setId} already has a valid current card (status=${lockedSet.status}) — leaving it alone despite this run's failure (${message})`,
          );
        }
      });
    }

    return this.getSetDetail(setId, apiBaseUrl);
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
    await this.reviewAssignments.assertInScope(actorUserId, set);
    this.assertUnlocked(set);

    const hit = this.findForbiddenPromptKeyword(dto.prompt);
    if (hit) {
      throw new CustomException(
        `Yêu cầu bị từ chối: chứa từ khóa không được phép sửa ("${hit}") — xem plan §6.3 (AI không được đổi biểu cảm, mở mắt, bỏ kính, gầy mặt, trẻ hóa, làm đẹp, đổi mắt/mũi/miệng)`,
        PHOTO_REVIEW_ERROR_CODE.PROMPT_FORBIDDEN,
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    // Giai đoạn 5 (plan §5.1, feature 12) — `sourceKind` picks whether this
    // edit starts from an existing `photo_variants` row (unchanged default
    // behavior: `fromVariantId` or the set's current card) or directly from
    // one of the session's own captured `photos` rows. Exactly one of
    // `fromVariant`/`sourcePhoto` ends up set; the other stays `null` and is
    // never referenced past this block.
    const sourceKind = dto.sourceKind ?? 'VARIANT';
    let fromVariant: PhotoVariant | null = null;
    let sourcePhoto: FrontSourcePhoto | null = null;

    if (sourceKind === 'ORIGINAL_PHOTO') {
      if (!dto.sourcePhotoId) {
        throw new CustomException(
          'sourcePhotoId is required when sourceKind is ORIGINAL_PHOTO',
          PHOTO_REVIEW_ERROR_CODE.SOURCE_PHOTO_NOT_FOUND,
          HttpStatus.BAD_REQUEST,
        );
      }
      sourcePhoto = await this.findPhotoOrFail(
        dto.sourcePhotoId,
        set.sourceSessionId,
      );
    } else {
      const fromVariantId = dto.fromVariantId ?? set.currentCardVariantId;
      if (!fromVariantId) {
        throw new CustomException(
          'No source variant to edit from',
          PHOTO_REVIEW_ERROR_CODE.VARIANT_NOT_FOUND,
          HttpStatus.NOT_FOUND,
        );
      }
      fromVariant = await this.findVariantEntityOrFail(fromVariantId);
      if (fromVariant.setId !== setId) {
        throw new CustomException(
          'Variant does not belong to this set',
          PHOTO_REVIEW_ERROR_CODE.VARIANT_NOT_IN_SET,
          HttpStatus.BAD_REQUEST,
        );
      }
      // "Usable" no longer means "already on fs-core" — a variant that is
      // fully READY with only local bytes (fs-core down, or just not its
      // turn in VariantUploadWorkerService's queue yet) is exactly as
      // editable as one that has already been pushed; `readVariantBytes`
      // below resolves bytes from either place. Only a genuinely-empty
      // variant (DISCARDED, or one with no bytes ANYWHERE — PROCESSING that
      // never finished, or FAILED with nothing produced) is rejected here.
      if (
        fromVariant.status === PhotoVariantStatus.DISCARDED ||
        (!fromVariant.fsFileId &&
          !(await this.hasLocalVariantContent(fromVariant.id)))
      ) {
        throw new CustomException(
          'Source variant is not usable (discarded or has no image bytes yet)',
          PHOTO_REVIEW_ERROR_CODE.VARIANT_NOT_READY,
          HttpStatus.CONFLICT,
        );
      }
    }

    // A `photoKindService.findKindEntityOrFail(set.kindId)` fetch used to
    // sit here and was removed 2026-09-28 as dead code — at the time,
    // `AiImageEditClient.edit()` had no `width`/`height` fields at all, so
    // `kind.cardSpec` had nothing to feed. Re-added the same day, a few
    // hours later, once `width`/`height` were wired up (see
    // `cardSpecToEditDimensions`'s own doc comment): this time it is
    // genuinely used, not a repeat of the same mistake.
    const kind = await this.photoKindService.findKindEntityOrFail(set.kindId);
    const sessionContext = await this.resolveSessionContext(
      set.sourceSessionId,
    );

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
          derivedFromVariantId: fromVariant?.id ?? null,
          sourcePhotoId: sourcePhoto?.id ?? null,
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
        payload: {
          prompt: dto.prompt,
          cfg: dto.cfg ?? null,
          steps: dto.steps ?? null,
          region: dto.region,
          fromVariantId: fromVariant?.id ?? null,
          sourcePhotoId: sourcePhoto?.id ?? null,
        },
      });
      await this.reviewStats.recordAiRequested(
        manager,
        set.campaignId,
        actorUserId,
        new Date(),
      );
      return created;
    });

    try {
      const sourceBytes = fromVariant
        ? await this.readVariantBytes(fromVariant, sessionContext.tenantName)
        : await this.readSourcePhotoBytes(
            sourcePhoto!,
            sessionContext.tenantName,
          );
      // `region` (OUTSIDE_FACE/GLASSES/HAIR/FULL) has no equivalent on the
      // external AI image-edit service's own contract — it edits the whole
      // image from a prompt, no region mask. Still recorded on the variant
      // row above (`regionMode`) as descriptive metadata; just not sent
      // here. `fromVariantId` is likewise not part of that service's
      // contract (it has no concept of "variant history") — nothing to
      // forward.
      //
      // `width`/`height` are always computed from `kind.cardSpec` (2026-09-28
      // user decision), never left to the service's own auto-computed
      // aspect ratio — every AI-edited card photo comes out already sized
      // to the target card format. This is NOT a face-aware crop (the
      // service does not detect face position at all — see the integration
      // guide's own "những chỗ dễ nhầm"); the user explicitly chose this
      // narrower "match the configured output size" scope over building
      // real face detection (no such capability exists anywhere in this
      // backend today) — see `cardSpecToEditDimensions`'s own doc comment.
      //
      // `cardSpec` itself is the campaign's effective one (its own
      // `card_spec` override, else its pinned workflow version's
      // `output.cardSpec`, else this kind's own default) — see
      // `resolveEffectiveCardSpec`'s own doc comment; using `kind.cardSpec`
      // alone here ignored both overrides.
      const effectiveCardSpec = await this.resolveEffectiveCardSpec(
        set.campaignId,
        kind.cardSpec,
      );
      const editDimensions = this.cardSpecToEditDimensions(effectiveCardSpec);
      const editPrompt = this.appendBackgroundColorInstruction(
        dto.prompt,
        effectiveCardSpec,
      );
      const editResult = unwrapPhotoAi(
        await this.photoAi.edit({
          imageBuffer: sourceBytes,
          mimeType: 'image/jpeg',
          prompt: editPrompt,
          cfg: dto.cfg,
          steps: dto.steps,
          seed: dto.seed,
          ...editDimensions,
        }),
      );

      // Identity-similarity scoring is a separate, best-effort call (not
      // part of the edit service's own response) — `PhotoAiPort` is kept
      // for exactly this (see `PhotoAiAdapter`'s own doc comment on why the
      // underlying sidecar client still exists post `services/python-ai`
      // removal). A scoring failure must not fail the whole edit — the
      // pixel result is still valid; a reviewer can judge similarity by eye
      // when the score is missing, same as this modal already does for a
      // `null` value. Branches directly on the outcome (no `unwrapPhotoAi`)
      // — this call was already "swallow the failure, don't throw" before
      // the port existed, so there is no `try`/`catch` to preserve.
      //
      // The reference image is the set's own enrolled FRONT capture — same
      // reference `uploadVariant()` uses — NOT `sourceBytes` (the edit's own
      // input, which can itself be a prior CARD_AI variant or any session
      // angle via `sourcePhotoId`). Scoring each edit only against its own
      // immediate predecessor lets a chain of edits drift the face away
      // from the real captured person one small, individually-passing step
      // at a time. Falls back to `sourceBytes` only if this set genuinely
      // has no FRONT photo on file (should not happen in practice — every
      // set is seeded from a session that has one — but this call must
      // never throw for a missing reference).
      const frontPhotoForIdentity = await this.findFrontSourcePhoto(
        set.sourceSessionId,
      );
      const identityReferenceBytes = frontPhotoForIdentity
        ? await this.readSourcePhotoBytes(
            frontPhotoForIdentity,
            sessionContext.tenantName,
          ).catch(() => sourceBytes)
        : sourceBytes;

      let identitySimilarity: number | undefined;
      const simOutcome = await this.photoAi.identitySimilarity({
        referenceImageBase64: identityReferenceBytes.toString('base64'),
        candidateImageBase64: editResult.imageBuffer.toString('base64'),
      });
      if (simOutcome.kind === 'Success') {
        identitySimilarity = simOutcome.value.similarity;
      } else {
        this.logger.warn(
          `aiEdit: identity-similarity scoring unavailable for variant ${variant.id}: ${simOutcome.reason}`,
        );
      }

      const result = {
        imageBase64: editResult.imageBuffer.toString('base64'),
        mimeType: editResult.mimeType,
        width: undefined as number | undefined,
        height: undefined as number | undefined,
        seed: editResult.seed != null ? String(editResult.seed) : undefined,
        identitySimilarity,
        modelId: 'ai-image-edit-local',
        algorithmVersion: undefined as string | undefined,
      };

      const ext = this.extForMime(result.mimeType);
      const virtualPath = this.buildVirtualPath(
        set.sourceSessionId,
        setId,
        sessionContext.year,
        'ai',
        variant.version,
        ext,
        sessionContext.identityNumber,
      );
      const data = Buffer.from(result.imageBase64, 'base64');

      let appliedToReady = false;
      await this.dataSource.transaction(async (manager) => {
        const stored = await this.storeVariantBytesLocalFirst(manager, {
          variantId: variant.id,
          tenantName: sessionContext.tenantName,
          virtualPath,
          mimeType: result.mimeType,
          data,
          idempotencyKey: `photo-review:${variant.id}:ai`,
        });

        // Guarded UPDATE, not a blind `save(variant)` on the in-memory
        // entity this method fetched BEFORE the sidecar call above (which
        // can take up to SIDECAR_TIMEOUT_MS = 30s) — a concurrent
        // `discardVariant()` on this same PROCESSING variant is legal
        // (PROCESSING is neither DISCARDED nor the set's current variant,
        // so nothing blocks it) and, before this fix, would be silently
        // reverted back to READY the moment this save ran, because the
        // in-memory object has no idea the row changed underneath it.
        // `WHERE status = 'PROCESSING'` makes this a no-op once that race
        // has already happened, instead of overwriting whatever
        // `discardVariant` wrote.
        const [readyRows]: [Array<{ id: string }>, number] =
          await manager.query(
            `UPDATE photo_variants
                SET status = $2, virtual_path = $3, bytes = $4, sha256 = $5,
                    width = $6, height = $7, seed = $8, model_id = $9,
                    algorithm_version = $10, identity_similarity = $11,
                    updated_at = now()
              WHERE id = $1 AND status = $12
              RETURNING id`,
            [
              variant.id,
              PhotoVariantStatus.READY,
              virtualPath,
              stored.bytes,
              stored.sha256,
              result.width ?? null,
              result.height ?? null,
              result.seed ?? null,
              result.modelId ?? null,
              result.algorithmVersion ?? null,
              result.identitySimilarity ?? null,
              PhotoVariantStatus.PROCESSING,
            ],
          );
        appliedToReady = readyRows.length > 0;
        // Not set as current — plan §5.3/§6.2: "con người chấp nhận: không bao
        // giờ tự đặt bản AI làm ảnh hiện tại". A reviewer must call
        // POST /v1/review/variants/:id/accept explicitly.
      });

      if (!appliedToReady) {
        this.logger.warn(
          `aiEdit: variant ${variant.id} was discarded while its sidecar edit was still in flight — result dropped, not resurrected`,
        );
      } else {
        await this.uploadMetadataBestEffort({
          tenantName: sessionContext.tenantName,
          virtualPath: virtualPath.replace(/\.[^.]+$/, '.json'),
          idempotencyKey: `photo-review:${variant.id}:ai:meta`,
          metadata: {
            prompt: dto.prompt,
            // The prompt ACTUALLY sent to /edit differs from the reviewer's
            // raw `dto.prompt` whenever the kind's cardSpec has a
            // `backgroundColor` (`appendBackgroundColorInstruction` appends
            // an instruction to it) — recorded separately here (plan §6.2
            // #6 traceability) rather than overwriting `prompt` above, so
            // existing readers of the raw prompt field are unaffected.
            effectivePrompt: editPrompt,
            cfg: dto.cfg,
            steps: dto.steps,
            region: dto.region,
            modelId: result.modelId,
            seed: result.seed,
            identitySimilarity: result.identitySimilarity,
            algorithmVersion: result.algorithmVersion,
          },
        });
      }
    } catch (error) {
      const message = extractSidecarFailureMessage(error);
      this.logger.warn(`ai-edit failed for set ${setId}: ${message}`);
      // Same guarded-UPDATE fix as the success path above — this catch runs
      // after the same long sidecar await, so the in-memory `variant` can be
      // just as stale here.
      const [failedRows]: [Array<{ id: string }>, number] =
        await this.dataSource.query(
          `UPDATE photo_variants SET status = $2, note = $3, updated_at = now()
            WHERE id = $1 AND status = $4
            RETURNING id`,
          [
            variant.id,
            PhotoVariantStatus.FAILED,
            message,
            PhotoVariantStatus.PROCESSING,
          ],
        );
      if (failedRows.length === 0) {
        this.logger.warn(
          `aiEdit: variant ${variant.id} was discarded before its failed sidecar edit could be recorded — left DISCARDED`,
        );
      }
    }

    // Re-fetched rather than returning the stale in-memory `variant` — the
    // guarded updates above may have been skipped (discarded mid-flight),
    // so this is the only way to hand the caller the row's REAL current
    // state instead of a PROCESSING snapshot that stopped being true
    // somewhere during the sidecar call.
    const refreshed = await this.findVariantEntityOrFail(variant.id);
    return this.toVariantDao(refreshed, apiBaseUrl, sessionContext.tenantName);
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
  async getJob(
    variantId: string,
    apiBaseUrl: string,
    actorUserId: string | null = null,
  ): Promise<PhotoVariantDao> {
    const variant = await this.findVariantEntityOrFail(variantId);
    const set = await this.findSetEntityOrFail(variant.setId);
    await this.reviewAssignments.assertInScope(actorUserId, set);
    const sessionContext = await this.resolveSessionContext(
      set.sourceSessionId,
    );
    return this.toVariantDao(variant, apiBaseUrl, sessionContext.tenantName);
  }

  // ── POST /v1/review/variants/:id/accept ─────────────────────────────

  async acceptVariant(
    variantId: string,
    actorUserId: string | null,
    apiBaseUrl: string,
  ): Promise<PhotoVariantDao> {
    const variant = await this.findVariantEntityOrFail(variantId);
    const set = await this.findSetEntityOrFail(variant.setId);
    await this.reviewAssignments.assertInScope(actorUserId, set);
    this.assertUnlocked(set);

    if (
      variant.kind !== PhotoVariantKind.CARD_AI &&
      variant.kind !== PhotoVariantKind.CARD_UPLOAD
    ) {
      throw new CustomException(
        'Only a CARD_AI or CARD_UPLOAD variant can be accepted',
        PHOTO_REVIEW_ERROR_CODE.VARIANT_NOT_READY,
        HttpStatus.CONFLICT,
      );
    }
    if (variant.status !== PhotoVariantStatus.READY) {
      throw new CustomException(
        'Variant is not READY',
        PHOTO_REVIEW_ERROR_CODE.VARIANT_NOT_READY,
        HttpStatus.CONFLICT,
      );
    }
    if (
      variant.identitySimilarity != null &&
      variant.identitySimilarity < IDENTITY_SIMILARITY_REJECT_THRESHOLD
    ) {
      throw new CustomException(
        `Identity similarity ${variant.identitySimilarity.toFixed(2)} is below the ${IDENTITY_SIMILARITY_REJECT_THRESHOLD} threshold — cannot accept`,
        PHOTO_REVIEW_ERROR_CODE.IDENTITY_MISMATCH,
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    await this.dataSource.transaction(async (manager) => {
      const lockedSet = await this.lockSet(manager, set.id);
      const fromStatus = lockedSet.status;
      const previousCardVariantId = lockedSet.currentCardVariantId ?? null;
      lockedSet.currentCardVariantId = variant.id;
      if (lockedSet.status === PhotoReviewSetStatus.READY) {
        lockedSet.status = PhotoReviewSetStatus.IN_REVIEW;
      }
      await manager.getRepository(SubjectPhotoSet).save(lockedSet);
      await this.raiseStatusChangeEvent(
        manager,
        set.id,
        lockedSet.campaignId,
        fromStatus,
        lockedSet.status,
      );

      const action =
        variant.kind === PhotoVariantKind.CARD_AI
          ? PhotoReviewAction.AI_ACCEPTED
          : PhotoReviewAction.UPLOAD_REPLACED;
      // 2026-09-29 user decision (fail-open, not fail-closed — the identity
      // backend is permanently down, see `photoAi.identitySimilarity`'s own
      // doc comment): a `null` score still allows accept, but the fact that
      // NO automated identity check actually ran must be visible in the
      // audit trail, not silently indistinguishable from "checked and
      // passed" the way a bare accept event was before this.
      await this.writeEvent(manager, {
        setId: set.id,
        variantId: variant.id,
        action,
        actorUserId,
        payload:
          variant.identitySimilarity == null
            ? { identityVerified: false }
            : {
                identityVerified: true,
                identitySimilarity: variant.identitySimilarity,
              },
      });
      if (action === PhotoReviewAction.AI_ACCEPTED) {
        await this.reviewStats.recordAiAccepted(
          manager,
          set.campaignId,
          actorUserId,
          new Date(),
        );

        // Giai đoạn 5 (plan §5.1, feature 12) — "xóa hẳn ảnh AI cũ":
        // accepting a NEW CARD_AI variant hard-deletes the PREVIOUS current
        // variant, but ONLY when that previous one was ITSELF a CARD_AI
        // (never a CARD_AUTO baseline or a CARD_UPLOAD). A deliberate,
        // narrowly-scoped exception to this module's own "never hard-delete
        // a variant, only DISCARDED" rule (`PhotoVariant`'s own doc
        // comment) — safe because every FK pointing at `photo_variants` is
        // already `ON DELETE SET NULL` (`derived_from_variant_id`,
        // `photo_review_events.variant_id`) or `ON DELETE CASCADE`
        // (`variant_upload_outbox.variant_id`), confirmed against the real
        // migration before relying on that here — no manual cleanup beyond
        // the delete itself. Bytes already pushed to fs-core are NOT
        // deleted (fs-core is versioned storage; this app's fs-client has
        // no delete capability — same constraint already documented for
        // kiosk cross-sitting retakes).
        if (previousCardVariantId && previousCardVariantId !== variant.id) {
          const previous = await manager
            .getRepository(PhotoVariant)
            .findOne({ where: { id: previousCardVariantId } });
          if (previous && previous.kind === PhotoVariantKind.CARD_AI) {
            await manager.getRepository(PhotoVariant).delete(previous.id);
          }
        }
      }
    });

    const sessionContext = await this.resolveSessionContext(
      set.sourceSessionId,
    );
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
    await this.reviewAssignments.assertInScope(actorUserId, set);
    this.assertUnlocked(set);

    if (set.currentCardVariantId === variant.id) {
      throw new CustomException(
        'Cannot discard the current card variant — switch current to another variant first',
        PHOTO_REVIEW_ERROR_CODE.VARIANT_IS_CURRENT,
        HttpStatus.CONFLICT,
      );
    }
    if (variant.status === PhotoVariantStatus.DISCARDED) {
      return this.toVariantDao(
        variant,
        apiBaseUrl,
        (await this.resolveSessionContext(set.sourceSessionId)).tenantName,
      );
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

    const sessionContext = await this.resolveSessionContext(
      set.sourceSessionId,
    );
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
    await this.reviewAssignments.assertInScope(actorUserId, set);
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
    const sessionContext = await this.resolveSessionContext(
      set.sourceSessionId,
    );
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
      const referenceBytes = await this.readSourcePhotoBytes(
        frontPhoto,
        sessionContext.tenantName,
      );
      const simResult = unwrapPhotoAi(
        await this.photoAi.identitySimilarity({
          referenceImageBase64: referenceBytes.toString('base64'),
          candidateImageBase64: file.buffer.toString('base64'),
        }),
      );
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
    // file-service), so the port gets them as base64 rather than a URL —
    // unlike `reprocess`/`aiEdit`, which crop an image that already lives on
    // fs-core and so pass a short-lived view-link URL instead.
    const effectiveCardSpec = await this.resolveEffectiveCardSpec(
      set.campaignId,
      kind.cardSpec,
    );
    const cardOutcome = await this.photoAi.makeCardPhoto({
      imageBase64: file.buffer.toString('base64'),
      cardSpec: effectiveCardSpec,
      mirror: true,
    });
    if (cardOutcome.kind !== 'Success') {
      throw new CustomException(
        `Card-photo pipeline failed for the uploaded image: ${cardOutcome.reason}`,
        PHOTO_REVIEW_ERROR_CODE.SIDECAR_UNREACHABLE,
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    const cardResult = cardOutcome.value;

    const variant = await this.dataSource.transaction(async (manager) => {
      const lockedSet = await this.lockSet(manager, setId);
      const fromStatus = lockedSet.status;
      const version = await this.nextVersion(manager, setId);
      const repo = manager.getRepository(PhotoVariant);

      const ext = this.extForMime(cardResult.mimeType);
      const virtualPath = this.buildVirtualPath(
        set.sourceSessionId,
        setId,
        sessionContext.year,
        'upload',
        version,
        ext,
        sessionContext.identityNumber,
      );
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
          qualityReport: cardResult.warnings.length
            ? { warnings: cardResult.warnings }
            : null,
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
        virtualPath: this.buildVirtualPath(
          set.sourceSessionId,
          setId,
          sessionContext.year,
          'upload',
          version,
          'source.json',
          sessionContext.identityNumber,
        ),
        idempotencyKey: `photo-review:${setId}:upload:v${version}:meta`,
        metadata: {
          identitySimilarity: similarity,
          originalMimeType: file.mimetype,
        },
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
      await this.reviewStats.recordUploaded(
        manager,
        set.campaignId,
        actorUserId,
        new Date(),
      );
      await this.raiseStatusChangeEvent(
        manager,
        setId,
        lockedSet.campaignId,
        fromStatus,
        lockedSet.status,
      );

      return created;
    });

    const dao = await this.toVariantDao(
      variant,
      apiBaseUrl,
      sessionContext.tenantName,
    );
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
  ): Promise<ReviewSetDetailDao> {
    const set = await this.findSetEntityOrFail(setId);
    await this.reviewAssignments.assertInScope(actorUserId, set);
    this.assertUnlocked(set);

    const variant = await this.findVariantEntityOrFail(variantId);
    if (variant.setId !== setId) {
      throw new CustomException(
        'Variant does not belong to this set',
        PHOTO_REVIEW_ERROR_CODE.VARIANT_NOT_IN_SET,
        HttpStatus.BAD_REQUEST,
      );
    }
    if (variant.status === PhotoVariantStatus.DISCARDED) {
      throw new CustomException(
        'Cannot set a discarded variant as current',
        PHOTO_REVIEW_ERROR_CODE.VARIANT_DISCARDED,
        HttpStatus.CONFLICT,
      );
    }
    if (variant.status !== PhotoVariantStatus.READY) {
      throw new CustomException(
        'Only a READY variant can be set as current',
        PHOTO_REVIEW_ERROR_CODE.VARIANT_NOT_READY,
        HttpStatus.CONFLICT,
      );
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

    return this.getSetDetail(setId, apiBaseUrl);
  }

  // ── POST /v1/review/sets/:id/approve, /reject ───────────────────────

  async approve(
    setId: string,
    dto: ApproveRejectDto,
    actorUserId: string | null,
    apiBaseUrl: string,
  ): Promise<ReviewSetDetailDao> {
    return this.transitionSetStatus(
      setId,
      PhotoReviewSetStatus.APPROVED,
      PhotoReviewAction.APPROVED,
      dto,
      actorUserId,
      apiBaseUrl,
    );
  }

  async reject(
    setId: string,
    dto: ApproveRejectDto,
    actorUserId: string | null,
    apiBaseUrl: string,
  ): Promise<ReviewSetDetailDao> {
    return this.transitionSetStatus(
      setId,
      PhotoReviewSetStatus.REJECTED,
      PhotoReviewAction.REJECTED,
      dto,
      actorUserId,
      apiBaseUrl,
    );
  }

  private async transitionSetStatus(
    setId: string,
    status: PhotoReviewSetStatus,
    action: PhotoReviewAction,
    dto: ApproveRejectDto,
    actorUserId: string | null,
    apiBaseUrl: string,
  ): Promise<ReviewSetDetailDao> {
    const set = await this.findSetEntityOrFail(setId);
    await this.reviewAssignments.assertInScope(actorUserId, set);
    this.assertUnlocked(set);

    await this.dataSource.transaction(async (manager) => {
      const lockedSet = await this.lockSet(manager, setId);
      const fromStatus = lockedSet.status;
      // Idempotency guard — same "a retried/double-clicked request must not
      // double-write" rule this session already applied to
      // `PrintItemService.statusCallback`/`markPrintedManually`. Decided
      // under the row lock (`fromStatus`, not the pre-lock `set` read
      // above, which could already be stale by the time this transaction
      // starts): re-approving an already-APPROVED set (or re-rejecting an
      // already-REJECTED one) is a no-op — no duplicate
      // `photo_review_events` row, no double-counted
      // `ReviewStatsService.recordDecision`, and no redundant
      // `raiseStatusChangeEvent` (which already no-ops on
      // `fromStatus === toStatus`, but skipping the write here closes the
      // audit-trail/stats side of the same gap, not just the print-side
      // event).
      if (fromStatus === status) {
        return;
      }
      // Product decision: a set leaving APPROVED whose active print item has
      // already moved past the withdrawable window (EXPORTED/PRINTED — the
      // card has physically left this system, or been handed to a printer)
      // must not silently flip to REJECTED while the card itself stays
      // "Chờ in"/"Đã in". `onSetLeftApproved` (print module) already leaves
      // an EXPORTED/PRINTED item untouched on this exact transition — this
      // check turns that "untouched" outcome into a hard block instead,
      // decided inside the SAME transaction/manager as the status write for
      // consistency with a concurrent export. Only fires leaving APPROVED
      // (re-approving an already-APPROVED set already returned above, and
      // every other status pair reaching this method is APPROVED<->REJECTED
      // only — see `approve`/`reject`); a set with no print item, or only a
      // PENDING/RENDERED one, is unaffected (still withdrawable as before).
      if (fromStatus === PhotoReviewSetStatus.APPROVED) {
        const activePrintItems: Array<{ status: string }> = await manager.query(
          `SELECT status FROM print_items
              WHERE set_id = $1 AND status IN ('EXPORTED', 'PRINTED')
              LIMIT 1`,
          [setId],
        );
        if (activePrintItems.length > 0) {
          throw new CustomException(
            'Ảnh đã được đưa vào đợt in (Chờ in/Đã in) — không thể từ chối. Vui lòng gỡ thẻ khỏi đợt in trước.',
            PHOTO_REVIEW_ERROR_CODE.PRINT_ITEM_ALREADY_EXPORTED,
            HttpStatus.CONFLICT,
          );
        }
      }
      lockedSet.status = status;
      await manager.getRepository(SubjectPhotoSet).save(lockedSet);
      await this.writeEvent(manager, {
        setId,
        action,
        actorUserId,
        payload: dto.note ? { note: dto.note } : null,
      });
      await this.reviewStats.recordDecision(
        manager,
        set.campaignId,
        actorUserId,
        status === PhotoReviewSetStatus.APPROVED ? 'APPROVED' : 'REJECTED',
        set.createdAt,
        new Date(),
      );
      await this.raiseStatusChangeEvent(
        manager,
        setId,
        lockedSet.campaignId,
        fromStatus,
        lockedSet.status,
      );
    });

    return this.getSetDetail(setId, apiBaseUrl);
  }

  // ── GET /v1/review/sets/:id/events ──────────────────────────────────

  async listEvents(
    setId: string,
    query: ListEventsQueryDto,
    actorUserId: string | null = null,
  ): Promise<Pagination<ReviewEventDao>> {
    const set = await this.findSetEntityOrFail(setId);
    await this.reviewAssignments.assertInScope(actorUserId, set);
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const offset = (page - 1) * limit;

    const countRows: Array<{ count: number }> = await this.dataSource.query(
      `SELECT COUNT(*)::int AS count FROM photo_review_events WHERE set_id = $1`,
      [setId],
    );
    const totalItems = countRows[0]?.count ?? 0;

    const rows: Array<Record<string, unknown>> = await this.dataSource.query(
      `SELECT e.id, e.set_id, e.variant_id, e.action, e.actor_user_id, e.payload, e.at,
              COALESCE(u.display_name, u.email) AS actor_name
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
        actorName: e.actor_name ?? undefined,
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
  async exportApproved(
    campaignId: string,
    status: PhotoReviewSetStatus,
  ): Promise<Buffer> {
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

    const tenantMap = await this.batchResolveTenants([
      ...new Set(rows.map((r) => r.source_session_id)),
    ]);

    const archive = archiver('zip', { zlib: { level: 9 } });
    const output = new PassThrough();
    const chunks: Buffer[] = [];
    output.on('data', (chunk: Buffer) => chunks.push(chunk));
    const done = new Promise<Buffer>((resolve, reject) => {
      output.on('end', () => resolve(Buffer.concat(chunks)));
      archive.on('error', reject);
    });
    archive.pipe(output);

    const manifestLines = [
      'subject_code,subject_name,status,updated_at,exported',
    ];
    // Quoting alone does not stop Excel/Sheets from evaluating a cell that
    // STARTS with `=`, `+`, `-`, `@`, a tab or a CR as a formula —
    // `subject_code`/`subject_name` can carry attacker-controlled text
    // (kiosk input, roster import, external student API). Prefixing with
    // `'` neutralizes it, same fix as `PrintPackageService`'s own
    // `csvField`.
    const csvField = (value: string) => {
      const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
      return `"${safe.replace(/"/g, '""')}"`;
    };
    // `archiver`'s path normalization only strips a LEADING `../`/`/`, so a
    // `..` in the MIDDLE of a free-text `subject_code` survives into the
    // zip entry name unchanged (zip-slip) — same issue and fix as
    // `PrintPackageService`'s own helper.
    const safeZipBaseName = (code: string, fallback: string): string => {
      const cleaned = code
        .normalize('NFC')
        .replace(/[\\/]/g, '_')
        .replace(/[^\p{L}\p{N}._-]/gu, '_')
        .replace(/^\.+/, '');
      return cleaned || fallback;
    };

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
            archive.append(buf, {
              name: `${safeZipBaseName(row.subject_code, row.id)}.${this.extForMime(contentType)}`,
            });
            exported = 'OK';
          } else {
            exported = `DOWNLOAD_FAILED_${res.status}`;
          }
        } catch (error) {
          this.logger.warn(
            `export download failed for set ${row.id}: ${(error as Error).message}`,
          );
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
    // Denormalization + due_at, cms-8-screens-api-plan.md §2.4/P4: one query
    // pulling the session's own fields plus a `campaign_subjects` roster
    // match (device-management, P3 — LEFT JOIN, so a subject with no roster
    // row just gets null class/major/faculty/citizenId, never a guess) and
    // the campaign's `processing_sla_hours` (device-management, P3) for
    // `dueAt`. Cross-module raw SQL, same convention this class's own top
    // comment already establishes for every other boundary read here.
    const sessionRows: Array<{
      subject_code: string | null;
      subject_name: string | null;
      campaign_id: string | null;
      completed_at: Date | null;
      processing_sla_hours: number | null;
      class_name: string | null;
      major: string | null;
      faculty: string | null;
      citizen_id: string | null;
    }> = await this.dataSource.query(
      `SELECT s.subject_code, s.subject_name, s.campaign_id, s.completed_at,
              c.processing_sla_hours,
              cs.class_name, cs.major, cs.faculty, cs.citizen_id
         FROM sessions s
         LEFT JOIN campaigns c ON c.id = s.campaign_id
         LEFT JOIN campaign_subjects cs
           ON cs.campaign_id = s.campaign_id AND cs.subject_code = s.subject_code AND cs.status = 'VALID'
        WHERE s.id = $1`,
      [sessionId],
    );
    const session = sessionRows[0];
    if (!session?.subject_code || !session.campaign_id) {
      this.logger.warn(
        `ensureSetForApprovedSession: session ${sessionId} has no subject_code/campaign_id — skipping`,
      );
      return null;
    }
    // Captured into locals: used again below, after several `await`s —
    // TypeScript cannot keep a property access narrowed across a call it
    // can't prove is side-effect free.
    const subjectCode = session.subject_code;
    const campaignId = session.campaign_id;
    const subjectName = session.subject_name;
    const dueAt =
      session.completed_at && session.processing_sla_hours
        ? new Date(
            session.completed_at.getTime() +
              session.processing_sla_hours * 3_600_000,
          )
        : null;
    const rosterFields = {
      className: session.class_name,
      major: session.major,
      faculty: session.faculty,
      citizenId: session.citizen_id,
    };

    const kind = await this.photoKindRepository.findOne({
      where: { code: 'STUDENT_CARD' },
    });
    if (!kind) {
      this.logger.warn(
        'ensureSetForApprovedSession: STUDENT_CARD photo kind not found — did the seed migration run?',
      );
      return null;
    }

    const existing = await this.setRepository.findOne({
      where: { campaignId, subjectCode, kindId: kind.id },
    });

    if (existing) {
      // Whether genuinely NEW photo bytes landed for this session since the
      // set was last updated — the same signal the (pre-existing) APPROVED
      // branch below already uses to tell an explicit retake apart from a
      // benign duplicate delivery of the same SESSION_REPORT (2026-09-21,
      // "chụp lại ghi đè ảnh cũ"). Computed once here and reused by both
      // branches (2026-09-29): without this, EVERY non-APPROVED status
      // (READY, IN_REVIEW, REJECTED — not just PENDING_AUTO/AUTO_FAILED)
      // was reset back to PENDING_AUTO on every delivery carrying the same
      // sessionId, even a benign resend with nothing new. The kiosk has no
      // in-flight guard on its own stats-push loop, so it resends an
      // un-acked batch every ~15s — each resend used to re-lock an
      // already-processed set and re-trigger a full (and, with an AI_EDIT
      // pipeline step, potentially multi-minute) reprocess() for no reason
      // at all.
      const newerPhotoRows: Array<{ count: string }> =
        await this.dataSource.query(
          `SELECT count(*) FROM photos WHERE session_id = $1 AND created_at > $2`,
          [sessionId, existing.updatedAt],
        );
      const hasNewerCapture = Number(newerPhotoRows[0]?.count ?? 0) > 0;

      if (existing.status !== PhotoReviewSetStatus.APPROVED) {
        const isBenignDuplicateDelivery =
          existing.sourceSessionId === sessionId &&
          existing.status !== PhotoReviewSetStatus.PENDING_AUTO &&
          existing.status !== PhotoReviewSetStatus.AUTO_FAILED &&
          !hasNewerCapture;
        if (isBenignDuplicateDelivery) {
          return { setId: existing.id, pendingAuto: false };
        }
        existing.sourceSessionId = sessionId;
        existing.status = PhotoReviewSetStatus.PENDING_AUTO;
        if (subjectName) existing.subjectName = subjectName;
        Object.assign(existing, rosterFields, { dueAt });
        await this.setRepository.save(existing);
        return { setId: existing.id, pendingAuto: true };
      }

      // Item 11 override (2026-09-21, "chụp lại ghi đè ảnh cũ"): an
      // EXPLICIT retake reuses the SAME sessionId on purpose — see the
      // kiosk-side `RunScopedCaptureSession.resume()`'s own doc comment —
      // so this session id being reported a second time cannot be told
      // apart from a benign duplicate SESSION_REPORT delivery by sessionId
      // alone. The signal used instead: did genuinely NEW photo bytes land
      // for this session after the set was already reviewed? A duplicate
      // delivery re-reports the exact same rows with no `photos.created_at`
      // past that point; a real retake's newly captured/approved photos
      // always do. R-Q10's original "giữ bản đã duyệt, để cán bộ tự quyết"
      // behavior (below) still applies to every OTHER reason a newer
      // session id might show up here (a different kind of reprocessing,
      // not this feature) — this only narrows R-Q10 for the one case the
      // product decision explicitly asked to change, not replace it.
      if (hasNewerCapture) {
        // Unlike the rest of this method (best-effort, outside any
        // transaction — see this method's own doc comment), THIS branch is
        // specifically a `APPROVED -> PENDING_AUTO` transition, so it must
        // raise `PhotoSetStatusChangedEvent` for `PrintModule`'s handler to
        // withdraw the now-stale active print item (task brief rule 2) —
        // and that dispatch has to run in the SAME transaction as this
        // status write, or a crash between the two could leave a print item
        // referencing a photo that was just retaken. A small dedicated
        // transaction, scoped to only this one write, is the minimal change
        // that gets that atomicity without touching this method's other
        // (still deliberately non-transactional) branches.
        const fromStatus = existing.status;
        existing.sourceSessionId = sessionId;
        existing.status = PhotoReviewSetStatus.PENDING_AUTO;
        if (subjectName) existing.subjectName = subjectName;
        Object.assign(existing, rosterFields, { dueAt });
        await this.dataSource.transaction(async (manager) => {
          await manager.getRepository(SubjectPhotoSet).save(existing);
          await this.raiseStatusChangeEvent(
            manager,
            existing.id,
            existing.campaignId,
            fromStatus,
            existing.status,
          );
        });
        return { setId: existing.id, pendingAuto: true };
      }

      // Keep the approved variant current; just record that a newer
      // session exists so a reviewer can decide (R-Q10). Roster/due_at left
      // untouched too — an already-reviewed set's "when was this due"
      // snapshot should not silently shift under a reviewer's feet.
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
        ...rosterFields,
        dueAt,
      }),
    );

    // Best-effort, same non-transactional nature as this whole method (see
    // its own doc comment) — `dataSource.manager` is a plain EntityManager
    // not bound to any transaction, so this is a normal, immediately-
    // committed statement, not a hanging transaction.
    await this.reviewStats
      .recordSetCreated(this.dataSource.manager, campaignId, created.createdAt)
      .catch((err) =>
        this.logger.warn(
          `stats recordSetCreated failed: ${(err as Error).message}`,
        ),
      );

    return { setId: created.id, pendingAuto: true };
  }

  /**
   * "Đã có hồ sơ ảnh trong đợt chụp này chưa?" — 2026-09-15, kiosk pre-
   * capture warning: right after a student-code/CCCD lookup resolves FOUND,
   * the kiosk calls this (via `CampaignSubjectPhotoStatusController`) before
   * starting a brand-new session, so the operator can be warned and shown
   * the existing photo instead of silently recapturing over a set that
   * already exists. Deliberately lighter than `getSetDetail` (no variants
   * list, no events, no video rows) — the kiosk only needs enough to render
   * one warning banner plus one preview image.
   *
   * Same `(campaignId, subjectCode, kindId)` uniqueness `ensureSet
   * ForApprovedSession` relies on, and the SAME "STUDENT_CARD kind" default
   * — this is intentionally read-only and side-effect-free (unlike that
   * method), so a kiosk calling this before every single lookup can never
   * create or mutate a set.
   */
  async findExistingSetForSubject(
    campaignId: string,
    subjectCode: string,
    apiBaseUrl: string,
  ): Promise<{
    exists: boolean;
    status?: PhotoReviewSetStatus;
    capturedAt?: Date;
    viewUrl?: string;
  }> {
    const kind = await this.photoKindRepository.findOne({
      where: { code: 'STUDENT_CARD' },
    });
    if (!kind) return { exists: false };

    const existing = await this.setRepository.findOne({
      where: { campaignId, subjectCode, kindId: kind.id },
    });
    if (!existing) return { exists: false };

    let viewUrl: string | undefined;
    if (existing.currentCardVariantId) {
      const variant = await this.variantRepository.findOne({
        where: { id: existing.currentCardVariantId },
      });
      if (variant) {
        const link = await this.resolveCurrentCardViewUrl(
          variant.id,
          variant.fsFileId,
          variant.fsStatus,
          apiBaseUrl,
        );
        viewUrl = link.url;
      }
    }

    return {
      exists: true,
      status: existing.status,
      capturedAt: existing.createdAt,
      viewUrl,
    };
  }
}
