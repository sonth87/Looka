import { CustomException } from '@app/shared/errors/legacy';
import { runBulk } from '@app/shared/http/bulk-item-error';
import { toDao } from '@app/shared/http/to-dao.helper';
import { FileStorageService } from '@app/modules/file-storage/services/file-storage.service';
import { ReviewStatsService } from '@app/modules/stats/services/review-stats.service';
import { Pagination } from '@app/shared/http/pagination';
import { DomainEventDispatcher } from '@app/shared/cqrs/domain-event.dispatcher';
import { TransactionContext } from '@app/shared/database/transaction-context';
import { InjectQueue } from '@nestjs/bullmq';
import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import archiver from 'archiver';
import type { Queue } from 'bullmq';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { PassThrough } from 'node:stream';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import {
  BulkReviewDecisionResultDao,
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
  BulkApproveRejectDto,
  ListEventsQueryDto,
  ListSetsQueryDto,
} from '../dto';
import { PhotoKind } from '../entities/photo-kind.entity';
import { PhotoReviewEvent } from '../entities/photo-review-event.entity';
import { PhotoVariant } from '../entities/photo-variant.entity';
import { SubjectPhotoSet } from '../entities/subject-photo-set.entity';
import {
  AI_EDIT_BACKGROUND_QUEUE_NAME,
  AI_EDIT_MAX_ATTEMPTS,
  AI_EDIT_MAX_IN_FLIGHT_PER_SET,
  AI_EDIT_QUEUE_NAME,
  AI_EDIT_RECOVERY_BATCH_LIMIT,
  AI_EDIT_RECOVERY_BOOT_GRACE_MS,
  AI_EDIT_RECOVERY_MIN_AGE_MS,
  AI_EDIT_RECOVERY_PROCESSING_STALE_MS,
  AiEditJobKind,
  AiEditJobOrigin,
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
import {
  AI_EDIT_JOB_OPTS,
  AI_EDIT_LIVE_JOB_STATES,
  aiEditJobId,
  aiEditJobKindFor,
  laneForOrigin,
} from './ai-edit.job';
import type { AiEditJobData, AiEditLane } from './ai-edit.job';
import { resolveAiJobFailureStatus } from './ai-edit-failure.policy';
import { PhotoKindService } from './photo-kind.service';
import { SidecarError } from './photo-review-sidecar.service';
import sharp from 'sharp';
import {
  outOfScopeError,
  ReviewAssignmentService,
} from './review-assignment.service';
import type { ScopeTarget } from './review-assignment.service';
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

/** The 404 for a review set that does not exist — one factory for every lookup path (single-set routes, the row lock, the raw detail query, the bulk decision path). */
function setNotFoundError(): CustomException {
  return new CustomException(
    'Photo review set not found',
    PHOTO_REVIEW_ERROR_CODE.SET_NOT_FOUND,
    HttpStatus.NOT_FOUND,
  );
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
 * Strips a `host:port`/URL authority out of an infra error message before
 * it is persisted to `photo_variants.note` — 2026-09-30 fix (confirmed
 * audit finding, low-impact hardening): `note` is exposed as-is to every
 * in-scope reviewer (`PhotoVariantDao.note`, `ReviewSetDao.failReason`), and
 * a raw Redis/ioredis connection error (e.g. `connect ECONNREFUSED
 * 10.20.15.x:6379`) can name an internal host that has no business
 * reaching a browser. Deliberately narrow — this only redacts an
 * authority after `://` or after `@`/before a bare `:<port>`, and leaves
 * the rest of the message (which this module's reviewers are meant to see,
 * per `ReviewSetDao.failReason`'s own doc comment) untouched.
 */
function redactInternalHost(message: string): string {
  return message
    .replace(/(:\/\/)[^\s/]+/g, '$1[redacted-host]')
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}:\d{1,5}\b/g, '[redacted-host]');
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
    @InjectQueue(AI_EDIT_QUEUE_NAME)
    private readonly aiEditQueue: Queue<AiEditJobData>,
    // The background lane (2026-09-29, user-priority-preemption rework) —
    // kiosk auto-runs and `AiEditRecoveryService` requeues go here instead;
    // see `AI_EDIT_BACKGROUND_QUEUE_NAME`'s own doc comment.
    @InjectQueue(AI_EDIT_BACKGROUND_QUEUE_NAME)
    private readonly aiEditBackgroundQueue: Queue<AiEditJobData>,
  ) {}

  /** `input.origin` (via `laneForOrigin`) → the actual `Queue` to enqueue onto — see `enqueueAiEditJob`'s own doc comment. */
  private queueForLane(lane: AiEditLane): Queue<AiEditJobData> {
    return lane === 'user' ? this.aiEditQueue : this.aiEditBackgroundQueue;
  }

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
    if (!set) throw setNotFoundError();
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
  private batchResolveTenants(
    sessionIds: string[],
  ): Promise<Map<string, string | undefined>> {
    const map = new Map<string, string | undefined>();
    for (const id of sessionIds) map.set(id, undefined);
    return Promise.resolve(map);
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
    const stored = this.hashVariantBytes(input.data);
    await this.insertVariantOutboxContent(manager, input);
    return stored;
  }

  /** Pure size/hash computation, no DB call — split out of `storeVariantBytesLocalFirst` (2026-09-29 fix, see `insertVariantOutboxContent`'s own doc comment) so a caller that needs the hash for an attempt-guarded UPDATE can compute it BEFORE deciding whether the outbox INSERT should happen at all. */
  private hashVariantBytes(data: Buffer): StoredVariantBytesResult {
    return {
      bytes: data.byteLength,
      sha256: createHash('sha256').update(data).digest('hex'),
    };
  }

  /**
   * The actual `variant_upload_outbox` INSERT, split out of
   * `storeVariantBytesLocalFirst` (2026-09-29 outbox-idempotency fix).
   *
   * `processReprocessJob`/`processAiEditJob` used to call
   * `storeVariantBytesLocalFirst` (insert unconditionally) BEFORE their own
   * attempt-guarded `DONE` UPDATE, so a superseded/discarded attempt that
   * happened to finish its pipeline/`/edit` call first would still win the
   * fixed `idem_key` (`ON CONFLICT DO NOTHING` silently drops whichever
   * attempt's insert comes second) even though the LATER attempt's own
   * UPDATE — the one that actually flips the row to `DONE` — is the one
   * whose `sha256`/`identity_similarity`/etc the row ends up describing.
   * Both call sites now run their guarded UPDATE FIRST and only call this
   * once that UPDATE has confirmed THIS attempt is the one that actually
   * won the transition — the fixed `idem_key` is then safe again, because
   * only the winning attempt (status can only move `PROCESSING → DONE`
   * once) ever reaches this call for a given variant.
   */
  private async insertVariantOutboxContent(
    manager: EntityManager,
    input: {
      variantId: string;
      tenantName?: string;
      virtualPath: string;
      mimeType: string;
      data: Buffer;
      idempotencyKey: string;
    },
  ): Promise<void> {
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
   * against the other even though both share the same
   * `security.viewLinkSigningSecret`) is simpler and keeps this module's
   * existing "duplicate small things rather than couple modules" convention
   * (see `resolveSessionContext` etc.).
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
    const now = Math.floor(Date.now() / 1000);
    const valid =
      Number.isFinite(exp) &&
      exp >= now &&
      // 2026-09-30 fix (confirmed audit finding): see PhotoService's
      // matching fix — without this upper bound a far-future `exp` verified
      // forever, defeating the short-TTL design.
      exp <= now + LOCAL_VARIANT_VIEW_TTL_SECONDS &&
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
    // 2026-09-30 fix (confirmed audit finding): was `security.apiKey`, the
    // same static secret apps/web ships to every browser client — anyone
    // holding it could forge a valid signature for any variant id,
    // bypassing SSO/ReviewerRoleGuard/reviewAssignments scoping entirely.
    // See `security.ts`'s own doc comment on `viewLinkSigningSecret`.
    const secret =
      this.configService.get<string>('security.viewLinkSigningSecret') ?? '';
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
    if (!set) throw setNotFoundError();
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
    if (!row) throw setNotFoundError();
    await this.reviewAssignments.assertInScope(actorUserId, {
      campaignId: row.campaign_id as string,
      className: row.class_name as string | null,
      faculty: row.faculty as string | null,
      major: row.major as string | null,
    });

    const sessionId = row.source_session_id as string;
    const tenantMap = await this.batchResolveTenants([sessionId]);
    const tenantName = tenantMap.get(sessionId);

    const [photoRows, videoRows, variantRows, eventRows] = await Promise.all([
      this.dataSource.query<Array<Record<string, unknown>>>(
        `SELECT id, step_id, step_type, camera_role, attempt, mime_type, fs_file_id, fs_status, captured_at
           FROM photos WHERE session_id = $1 ORDER BY step_id, attempt`,
        [sessionId],
      ),
      this.dataSource.query<Array<Record<string, unknown>>>(
        `SELECT id, camera_role, mime_type, duration_ms, fs_file_id, fs_status
           FROM session_videos WHERE session_id = $1 ORDER BY camera_role`,
        [sessionId],
      ),
      this.variantRepository.find({
        where: { setId: id },
        order: { version: 'DESC' },
      }),
      this.dataSource.query<Array<Record<string, unknown>>>(
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

  /**
   * Claims a variant (guarded UPDATE: `status` must be one of
   * `input.claimFrom` — and, when retrying/re-claiming a specific known
   * attempt, `ai_attempts` must still match `input.expectedAttempts` — see
   * `promoteToUserLane`'s own use of that guard) onto whichever BullMQ
   * queue `input.origin` picks (via `laneForOrigin` — see that function's
   * own doc comment), instead of running the real `/edit`-calling
   * work inline — 2026-09-29 user request (original), rewritten 2026-09-29
   * (user-priority-preemption follow-up) to add the lane split, the
   * `ai_attempts` claim/guard, and a durable "row is the source of truth,
   * Redis is disposable" story (`AiEditRecoveryService` can always
   * reconstruct a lost job from the row alone).
   *
   * `job.name` is `input.kind` (`AiEditJobKind.REPROCESS`/`AI_EDIT`) —
   * `AiEditProcessor`/`AiEditBackgroundProcessor` (via
   * `runQueuedAiEditJob`) switch on it to pick
   * `processReprocessJob`/`processAiEditJob`. `actorUserId` is still
   * intentionally NOT part of the job data — the audit trail for WHO
   * requested the job is the `REPROCESS`/`AI_REQUESTED` `photo_review_events`
   * row written synchronously before this is ever called.
   *
   * Returns `{enqueued: false}` (never throws) when the guarded UPDATE
   * matched zero rows — the variant already moved on (e.g. a concurrent
   * caller already claimed it, or it was discarded) — same "no-op, not an
   * error" contract this module already uses for every other
   * lost-the-race guarded write (see `processReprocessJob`'s own
   * `appliedToReady`-style checks).
   *
   * If `queue.add` itself throws or hangs (Redis down/slow — bounded to
   * ~5s here so a caller never hangs indefinitely on this) the claim's OWN
   * `ai_attempts` bump is undone (`attemptDelta: -1`, attempt-guarded so a
   * slower-but-eventually-successful `add` racing this walk-back can never
   * leave the row stuck) and a `note` is recorded, but `status` stays
   * `PROCESSING` — there is no separate `PENDING`/failed-to-enqueue status
   * (see `PhotoVariantStatus`'s own doc comment). `AiEditRecoveryService`'s
   * sweep picks this row up the same way it recovers a crashed run: once it
   * has been stale (no live job) for `AI_EDIT_RECOVERY_PROCESSING_STALE_MS`.
   */
  private async enqueueAiEditJob(input: {
    kind: AiEditJobKind;
    variantId: string;
    setId: string;
    origin: AiEditJobOrigin;
    claimFrom: PhotoVariantStatus[];
    expectedAttempts?: number;
  }): Promise<{ enqueued: boolean; attempt?: number }> {
    const [claimedRows]: [Array<{ ai_attempts: number }>, number] =
      await this.dataSource.query(
        `UPDATE photo_variants
            SET status = $2, ai_attempts = ai_attempts + 1, updated_at = now()
          WHERE id = $1 AND status = ANY($3::text[])
            AND ($4::int IS NULL OR ai_attempts = $4)
          RETURNING ai_attempts`,
        [
          input.variantId,
          PhotoVariantStatus.PROCESSING,
          input.claimFrom,
          input.expectedAttempts ?? null,
        ],
      );
    if (claimedRows.length === 0) {
      this.logger.warn(
        `enqueueAiEditJob: variant ${input.variantId} did not match claimFrom=[${input.claimFrom.join(',')}] (expectedAttempts=${input.expectedAttempts ?? 'any'}) — not enqueued`,
      );
      return { enqueued: false };
    }
    const attempt = claimedRows[0].ai_attempts;
    // Lane derived from origin (2026-09-29 simplification fix) — see
    // `laneForOrigin`'s own doc comment for why a separate `input.lane`
    // field used to be able to disagree with `input.origin`.
    const lane = laneForOrigin(input.origin);

    const addPromise = this.queueForLane(lane).add(
      input.kind,
      {
        setId: input.setId,
        variantId: input.variantId,
        origin: input.origin,
        attempt,
      },
      { jobId: aiEditJobId(input.variantId, attempt), ...AI_EDIT_JOB_OPTS },
    );

    try {
      await this.withTimeout(addPromise, 5_000, 'enqueueAiEditJob: queue.add');
    } catch (error) {
      const message = (error as Error).message;
      // 2026-09-30 fix (confirmed audit finding): `withTimeout` never
      // cancels `addPromise` — it is only this caller that stops waiting.
      // The old code walked `ai_attempts` back (`attemptDelta: -1`)
      // unconditionally right here, on a MERE TIMEOUT as much as on a real
      // failure. If `addPromise` then went on to actually land, its job
      // (`pv-<variantId>-<attempt>`) already existed in Redis under this
      // same attempt number — and the very next claim (recovery sweep or a
      // fresh reprocess/aiEdit call) reuses that SAME walked-back attempt
      // number for its own `queue.add`, whose job id collides with the
      // late-landing one. BullMQ silently no-ops a duplicate job id, so
      // that later, real enqueue attempt was dropped on the floor.
      //
      // Only walk the attempt back once we are CERTAIN no job was created
      // under this attempt's job id. A synchronous/immediate rejection from
      // `add()` itself gives us that certainty right away. A bare timeout
      // does not — so for a timeout, defer the walk-back until
      // `addPromise` itself finally settles: if it resolves, the job is
      // live and nothing else need happen; if it eventually rejects for
      // real, walk the attempt back then, when doing so can no longer
      // collide with anything.
      const timedOut = message.includes('timed out after');
      if (timedOut) {
        this.logger.error(
          `enqueueAiEditJob: queue.add timed out for variant ${input.variantId} (attempt ${attempt}) — leaving the claim in place until the add itself settles, to avoid reusing this attempt's job id for a still-possibly-pending add: ${message}`,
        );
        addPromise.then(
          () => {
            this.logger.warn(
              `enqueueAiEditJob: queue.add for variant ${input.variantId} (attempt ${attempt}) landed after its own timeout — the job is live, no walk-back needed`,
            );
          },
          (bgError: unknown) => {
            // `attemptDelta: -1` (2026-09-29 fix) — undoes the
            // `ai_attempts + 1` the claim UPDATE above did. Without this, a
            // Redis outage that fails every `queue.add` call burns through
            // `AI_EDIT_MAX_ATTEMPTS` on enqueue failures alone (never an
            // actual AI run). `to` stays `PROCESSING` (same as `from`) — no
            // separate PENDING status.
            void this.transitionVariantStatus(this.dataSource, {
              variantId: input.variantId,
              from: PhotoVariantStatus.PROCESSING,
              to: PhotoVariantStatus.PROCESSING,
              attempt,
              note: `enqueue failed: ${redactInternalHost((bgError as Error).message)}`,
              attemptDelta: -1,
            }).catch((walkBackError: unknown) => {
              this.logger.error(
                `enqueueAiEditJob: deferred walk-back failed for variant ${input.variantId} (attempt ${attempt}): ${(walkBackError as Error).message}`,
              );
            });
          },
        );
      } else {
        this.logger.error(
          `enqueueAiEditJob: queue.add failed for variant ${input.variantId} (attempt ${attempt}) — walking the attempt back, leaving it PROCESSING for the recovery sweep: ${message}`,
        );
        await this.transitionVariantStatus(this.dataSource, {
          variantId: input.variantId,
          from: PhotoVariantStatus.PROCESSING,
          to: PhotoVariantStatus.PROCESSING,
          attempt,
          note: `enqueue failed: ${redactInternalHost(message)}`,
          attemptDelta: -1,
        });
      }
      return { enqueued: false, attempt };
    }
    return { enqueued: true, attempt };
  }

  /**
   * Shared attempt-guarded status transition for `photo_variants`
   * (2026-09-29 dedup fix) — every place that walks a claimed row forward
   * to a terminal/retry status used to copy-paste this same
   * `WHERE status = $x AND ai_attempts = $y` guarded UPDATE, and the copies
   * had already drifted (the recovery sweep's CARD_AI attempts-exhausted
   * branch had silently lost the `ai_attempts` guard its siblings kept).
   * Returns whether the UPDATE actually matched a row, same contract every
   * inline `RETURNING id`/`readyRows.length > 0` check already used —
   * callers must skip any further side effect (event, stats, set
   * demotion/promotion) when this is `false`, since it means a newer
   * attempt (or a discard) already moved the row on.
   */
  private async transitionVariantStatus(
    runner: DataSource | EntityManager,
    input: {
      variantId: string;
      from: PhotoVariantStatus;
      to: PhotoVariantStatus;
      attempt: number;
      note?: string | null;
      /** Added to `ai_attempts` in the same UPDATE — only the enqueue walk-back (undoing its own claim's `+1`) passes a non-zero value here. */
      attemptDelta?: number;
    },
  ): Promise<boolean> {
    const [rows]: [Array<{ id: string }>, number] = await runner.query(
      `UPDATE photo_variants
          SET status = $2, note = $3, ai_attempts = ai_attempts + $6, updated_at = now()
        WHERE id = $1 AND status = $4 AND ai_attempts = $5
        RETURNING id`,
      [
        input.variantId,
        input.to,
        input.note ?? null,
        input.from,
        input.attempt,
        input.attemptDelta ?? 0,
      ],
    );
    return rows.length > 0;
  }

  /** Rejects with `label` if `promise` has not settled within `ms` — the promise itself is left running (BullMQ's `add` is not cancellable), only this caller stops waiting on it. */
  private withTimeout<T>(
    promise: Promise<T>,
    ms: number,
    label: string,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`${label} timed out after ${ms}ms`)),
        ms,
      );
      promise.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (error) => {
          clearTimeout(timer);
          reject(error as Error);
        },
      );
    });
  }

  // ── POST /v1/review/sets/:id/reprocess ──────────────────────────────

  /**
   * Allowed even when locked — this is how a set gets OUT of `PENDING_AUTO`
   * (first ever card) or `AUTO_FAILED` (retry), per plan §4/R-Q1.
   *
   * `origin` (2026-09-29, user-priority-preemption rework) picks the LANE a
   * freshly-created variant's job goes to: `USER` (a reviewer's own
   * "Tạo lại ảnh 4x6" click, via `ReviewController.reprocess`) always uses
   * the high-priority `ai-edit` queue; `AUTO` (the default — the kiosk's
   * own best-effort post-approval trigger, `DeviceEventService`) uses
   * `ai-edit-background`. See `AiEditJobOrigin`'s own doc comment.
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
    origin: AiEditJobOrigin = AiEditJobOrigin.AUTO,
  ): Promise<ReviewSetDetailDao> {
    const set = await this.findSetEntityOrFail(setId);
    // Not covered by `assertUnlocked` (deliberately, per R-Q1) but still a
    // per-record write action — plan §5.2's scope guard applies here too,
    // otherwise a scoped-out reviewer could bypass every other restriction
    // through this one route.
    await this.reviewAssignments.assertInScope(actorUserId, set);

    // Single-flight guard (2026-09-29, widened in the same-day
    // priority-preemption follow-up to cover DRAFT too, not just
    // PROCESSING — a retryable failure awaiting the sweep is also just
    // `PROCESSING`, see `PhotoVariantStatus`'s own doc comment): with the
    // `ai_pipeline_steps` executor wired up, one run can now take minutes
    // (an `AI_EDIT` step's `/edit` call queues on a single-worker GPU
    // service). Before this guard, two overlapping runs for the same set —
    // the kiosk's own no-in-flight-guard resend loop re-POSTing the same
    // un-acked SESSION_REPORT batch every ~15s is one source, a reviewer's
    // manual "Tạo lại ảnh 4x6" click landing mid-auto-run is another — would
    // each create their own variant and queue their own AI request on top of
    // whatever is already running.
    //
    // An `AUTO` caller finding one already in flight just skips (unchanged
    // behavior — F10, only the USER path may re-claim a stuck/retrying row).
    // A `USER` caller instead RE-CLAIMS the existing variant rather than
    // creating a new one — see below — which is also what makes "click
    // gen-by-AI again" able to promote an already-queued background
    // (kiosk-auto) run into the user lane instead of stacking a second
    // request behind it.
    const inFlight = await this.variantRepository.findOne({
      where: [
        {
          setId,
          kind: PhotoVariantKind.CARD_AUTO,
          status: PhotoVariantStatus.DRAFT,
        },
        {
          setId,
          kind: PhotoVariantKind.CARD_AUTO,
          status: PhotoVariantStatus.PROCESSING,
        },
      ],
      order: { createdAt: 'DESC' },
    });
    if (inFlight) {
      if (origin !== AiEditJobOrigin.USER) {
        this.logger.warn(
          `reprocess: set ${setId} already has an in-flight CARD_AUTO variant (${inFlight.id}, status=${inFlight.status}) — skipping duplicate ${origin} run`,
        );
        return this.getSetDetail(setId, apiBaseUrl);
      }
      // Refresh the promotion snapshot to the set's CURRENT card at click
      // time (under the set lock) — a USER re-claim explicitly means "run
      // this again, right now", so it should promote against whatever a
      // reviewer has done since the ORIGINAL run started, not that
      // original run's own stale snapshot. Guarded by `status = ANY(...)`
      // (2026-09-29 fix) — matching the same statuses `inFlight`'s own
      // lookup above used — so a variant that settled between that lookup
      // and this transaction is left alone rather than having its snapshot
      // rewritten for no reason. Also writes the `REPROCESS` audit event
      // for this click (2026-09-29 fix): this branch used to record no
      // event and no actor at all, breaking the module's own "every
      // state-changing action gets an event" rule — a USER re-claim can
      // promote a regenerated card over whatever another reviewer has since
      // chosen as current (see `processReprocessJob`'s `safeToPromote`),
      // exactly the kind of action this module's audit trail must attribute.
      const reclaimed = await this.dataSource.transaction(async (manager) => {
        const lockedSet = await this.lockSet(manager, setId);
        const [reclaimedRows]: [Array<{ id: string }>, number] =
          await manager.query(
            `UPDATE photo_variants
                SET ai_request_params = coalesce(ai_request_params, '{}'::jsonb)
                      || jsonb_build_object('snapshotCurrentVariantId', $2::uuid),
                    updated_at = now()
              WHERE id = $1 AND status = ANY($3::text[])
              RETURNING id`,
            [
              inFlight.id,
              lockedSet.currentCardVariantId ?? null,
              [PhotoVariantStatus.DRAFT, PhotoVariantStatus.PROCESSING],
            ],
          );
        if (reclaimedRows.length === 0) return false;
        await this.writeEvent(manager, {
          setId,
          variantId: inFlight.id,
          action: PhotoReviewAction.REPROCESS,
          actorUserId,
          payload: { reclaim: true, fromStatus: inFlight.status },
        });
        return true;
      });

      if (!reclaimed) {
        this.logger.warn(
          `reprocess: variant ${inFlight.id} already settled (no longer DRAFT/PROCESSING) before this USER re-claim could run — no-op`,
        );
        return this.getSetDetail(setId, apiBaseUrl);
      }

      if (inFlight.status === PhotoVariantStatus.PROCESSING) {
        await this.promoteToUserLane(inFlight);
      } else {
        await this.enqueueAiEditJob({
          kind: AiEditJobKind.REPROCESS,
          variantId: inFlight.id,
          setId,
          origin: AiEditJobOrigin.USER,
          claimFrom: [PhotoVariantStatus.DRAFT],
        });
      }
      return this.getSetDetail(setId, apiBaseUrl);
    }

    // Only validated here (fail fast, before creating a variant at all) —
    // `processReprocessJob` re-fetches its own `kind`/`cardSpec` once the
    // job actually runs, rather than threading it through the queue.
    await this.photoKindService.findKindEntityOrFail(set.kindId);
    const frontPhoto = await this.findFrontSourcePhoto(set.sourceSessionId);
    if (!frontPhoto) {
      throw new CustomException(
        "No original photo found for this set's source session",
        PHOTO_REVIEW_ERROR_CODE.SOURCE_PHOTO_NOT_FOUND,
        HttpStatus.NOT_FOUND,
      );
    }

    const variant = await this.dataSource.transaction(async (manager) => {
      const lockedSet = await this.lockSet(manager, setId);
      const version = await this.nextVersion(manager, setId);
      const repo = manager.getRepository(PhotoVariant);
      const created = await repo.save(
        repo.create({
          setId,
          version,
          kind: PhotoVariantKind.CARD_AUTO,
          status: PhotoVariantStatus.DRAFT,
          sourcePhotoId: frontPhoto.id,
          createdByUserId: actorUserId,
          // Captured NOW (variant creation), not re-read at job-run time any
          // more (2026-09-29 priority-preemption follow-up) — a retry
          // (`ai_attempts > 1`, via the recovery sweep or a USER re-claim
          // hours later) reads THIS stored value back rather than
          // re-snapshotting against whatever the set's current card
          // happens to be by then; see `processReprocessJob`'s own
          // `safeToPromote` doc comment for why a stale re-snapshot would
          // be wrong.
          aiRequestParams: {
            snapshotCurrentVariantId: lockedSet.currentCardVariantId ?? null,
          },
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

    // 2026-09-29 user request ("đẩy vào queue, lock lại chỉ cho 1 tiến
    // trình chạy") — the actual AI pipeline run (the slow part, up to
    // minutes) no longer happens inline here. It is enqueued and picked up
    // by `AiEditProcessor`/`AiEditBackgroundProcessor` (lane picked by
    // `origin`), which is what fixes the kiosk-request-blocking bug the
    // 2026-09-29 audit found (device-event.service.ts awaiting this method
    // inline). The FE polls `GET /v1/review/jobs/:id` (`getJob`, unchanged)
    // to see the variant move PROCESSING → DONE/PENDING/FAILED — see
    // `enqueueAiEditJob`'s own doc comment.
    await this.enqueueAiEditJob({
      kind: AiEditJobKind.REPROCESS,
      variantId: variant.id,
      setId,
      origin,
      claimFrom: [PhotoVariantStatus.DRAFT],
    });

    return this.getSetDetail(setId, apiBaseUrl);
  }

  /**
   * Moves an already-`PROCESSING` variant's job from the background lane
   * to the user lane (2026-09-29, priority-preemption rework) — the "click
   * gen-by-AI again while the kiosk's own background run is still going"
   * case `reprocess()`'s single-flight guard routes here. Never touches
   * `photo_variants.status`/`ai_attempts` (still `PROCESSING` either way —
   * moving queues is not a new claim) — only which BullMQ queue holds the
   * job, so `AiEditSlotGate` picks it up ahead of any OTHER still-waiting
   * background job the next time a slot frees.
   *
   * bullmq 6.3.9's `Queue.remove(jobId)` returns 1 only if it actually
   * removed a job that was `waiting`/`prioritized`/`delayed` (never a job
   * already `active` — see that method's own doc comment); this is exactly
   * the race-free check this needs:
   * - Still waiting in the background queue (`remove` → 1): re-add the SAME
   *   job data/id to the user queue — nothing was running, nothing lost.
   * - Already `active` (`remove` → 0, i.e. `AiEditBackgroundProcessor`
   *   claimed it between this method's own lookup and the `remove` call):
   *   leave it running there. Its slot is already held; forcibly moving a
   *   RUNNING job is exactly the "abort a live GPU call" trade-off this
   *   rework's own plan chose not to attempt (see `AiEditSlotGate`'s doc
   *   comment) — the user's own new job will still jump every OTHER
   *   waiting job via the gate once a slot frees.
   * - Not found in the background queue at all (already completed/failed,
   *   or this is the FIRST claim — no prior job ever existed): fall back to
   *   a normal `claimFrom: [PROCESSING]` re-claim, attempt-guarded by
   *   `expectedAttempts` so a stale/already-superseded call is a safe no-op
   *   rather than double-claiming.
   */
  private async promoteToUserLane(variant: PhotoVariant): Promise<void> {
    const jobId = aiEditJobId(variant.id, variant.aiAttempts);
    const kind = aiEditJobKindFor(variant.kind);
    const job = await this.aiEditBackgroundQueue.getJob(jobId);
    if (job) {
      const state = await job.getState();
      if (state === 'active') {
        this.logger.log(
          `promoteToUserLane: variant ${variant.id}'s job ${jobId} is already active in the background lane — leaving it running`,
        );
        return;
      }
      // Deliberately its own, narrower list — NOT `AI_EDIT_LIVE_JOB_STATES`
      // — this is the set of states bullmq's `Queue.remove()` can actually
      // act on (`active` is handled above, `waiting-children` cannot be
      // removed either).
      if (
        state === 'waiting' ||
        state === 'prioritized' ||
        state === 'delayed'
      ) {
        const removed = await this.aiEditBackgroundQueue.remove(jobId);
        if (removed === 1) {
          await this.aiEditQueue.add(
            kind,
            {
              setId: variant.setId,
              variantId: variant.id,
              origin: AiEditJobOrigin.USER,
              attempt: variant.aiAttempts,
            },
            { jobId, ...AI_EDIT_JOB_OPTS },
          );
          this.logger.log(
            `promoteToUserLane: moved variant ${variant.id}'s job ${jobId} from background to user lane`,
          );
          return;
        }
        // `removed === 0` — it became active between `getState()` and
        // `remove()` (a real, narrow race). Same as the `state === 'active'`
        // branch above: leave it running.
        return;
      }
      // `completed`/`failed`/`unknown` — fall through to the re-claim below.
    }

    const userQueueJob = await this.aiEditQueue.getJob(jobId);
    if (userQueueJob) {
      const state = await userQueueJob.getState();
      // 2026-09-29 fix: was missing `delayed`/`waiting-children` — a live
      // job in either state would have been invisible here, so this method
      // would fall through and re-claim/re-enqueue a SECOND job for the
      // same attempt. `AI_EDIT_JOB_OPTS` sets no delay/backoff today so this
      // was latent, not yet triggered, but the two queue-liveness checks in
      // this module (this one and the recovery sweep's) must agree on what
      // "live" means.
      if ((AI_EDIT_LIVE_JOB_STATES as readonly string[]).includes(state)) {
        return;
      }
    }

    await this.enqueueAiEditJob({
      kind,
      variantId: variant.id,
      setId: variant.setId,
      origin: AiEditJobOrigin.USER,
      claimFrom: [PhotoVariantStatus.PROCESSING],
      expectedAttempts: variant.aiAttempts,
    });
  }

  /**
   * Dispatch shared by both `AiEditProcessor` and `AiEditBackgroundProcessor`
   * (2026-09-29, priority-preemption rework — previously each processor
   * called `processReprocessJob`/`processAiEditJob` directly). Re-checks the
   * row against `data.attempt` BEFORE doing any real work: a job can outlive
   * its own usefulness (e.g. `promoteToUserLane` re-claimed the same variant
   * at a new attempt while this exact job was still sitting `waiting`, or a
   * stale job survived a Redis hiccup) — running it anyway would either
   * waste a GPU call or, worse, race a newer attempt's own terminal write.
   * `data.attempt` is `?? 0` for a legacy job enqueued before this field
   * existed.
   */
  async runQueuedAiEditJob(
    kind: AiEditJobKind,
    data: AiEditJobData,
  ): Promise<void> {
    const attempt = data.attempt ?? 0;
    const rows: Array<{
      status: PhotoVariantStatus;
      ai_attempts: number;
      set_id: string;
      kind: PhotoVariantKind;
    }> = await this.dataSource.query(
      `SELECT status, ai_attempts, set_id, kind FROM photo_variants WHERE id = $1`,
      [data.variantId],
    );
    const row = rows[0];
    if (!row) {
      this.logger.warn(
        `runQueuedAiEditJob: variant ${data.variantId} no longer exists — skipping`,
      );
      return;
    }
    if (row.status !== PhotoVariantStatus.PROCESSING) {
      this.logger.warn(
        `runQueuedAiEditJob: variant ${data.variantId} is ${row.status}, not PROCESSING — skipping stale job (attempt=${attempt})`,
      );
      return;
    }
    if (row.ai_attempts !== attempt) {
      this.logger.warn(
        `runQueuedAiEditJob: variant ${data.variantId} is now at attempt ${row.ai_attempts}, this job was for attempt ${attempt} — skipping superseded job`,
      );
      return;
    }
    // 2026-09-30 fix (confirmed audit finding): the trust-boundary rule just
    // below ("the row is the source of truth, Redis is disposable") used to
    // stop at `set_id` — `kind` (the BullMQ job name/`AiEditJobKind` this
    // method's caller passed in) was still taken straight from Redis with
    // no matching check against `row.kind`. A corrupted/replayed/hand-edited
    // Redis job whose name disagrees with the variant's actual kind would
    // run the WRONG pipeline against it — most importantly, a `REPROCESS`
    // name against a `CARD_AI` variant would run `processReprocessJob`, which
    // can auto-promote its result to `currentCardVariantId`, bypassing the
    // "AI output is never auto-set as current, a reviewer must accept it"
    // rule `processAiEditJob` enforces for real `CARD_AI` variants.
    if (kind !== aiEditJobKindFor(row.kind)) {
      this.logger.warn(
        `runQueuedAiEditJob: variant ${data.variantId} is kind ${row.kind} (expects job name ${aiEditJobKindFor(row.kind)}), but this job is named ${kind} — skipping mismatched job`,
      );
      return;
    }

    // `row.set_id` — the variant's OWN set, read fresh from the row itself
    // — never `data.setId` (2026-09-29 trust-boundary fix). This rework's
    // whole design is "the row is the source of truth, Redis is
    // disposable" (see `enqueueAiEditJob`'s own doc comment); trusting a
    // job-data field that duplicates what the row already knows means a
    // corrupted/replayed/hand-edited Redis entry could point a variant's
    // generated result — and, for `processReprocessJob`, its promotion to
    // `currentCardVariantId` — at a completely different set.
    if (kind === AiEditJobKind.REPROCESS) {
      await this.processReprocessJob(row.set_id, data.variantId, attempt);
    } else {
      await this.processAiEditJob(
        row.set_id,
        data.variantId,
        data.payload ?? {},
        attempt,
      );
    }
  }

  /**
   * The actual AI pipeline run for one `reprocess()` job — called by
   * `runQueuedAiEditJob` (which `AiEditProcessor`/`AiEditBackgroundProcessor`
   * both dispatch through), never directly by a controller. Extracted
   * 2026-09-29 out of `reprocess()` itself (see that method's own comment)
   * so it can run from the queue instead of inline inside the original HTTP
   * request. Re-resolves `set`/`kind`/`sessionContext`/`frontPhoto` fresh
   * rather than threading them through the job's `payload` — cheap DB
   * reads, and guarantees this always sees the CURRENT `photo_kinds`/
   * `campaigns` config even if the job sat queued for a while before a
   * worker claimed it.
   *
   * `snapshotCurrentVariantId` (2026-09-29, priority-preemption rework;
   * 2026-09-30 fix — confirmed audit finding): always reads back the value
   * `reprocess()` (creation, or a USER re-claim) already stored on
   * `variant.aiRequestParams` under the set lock, whatever the attempt
   * number. This used to re-snapshot fresh from `set.currentCardVariantId`
   * for every attempt 1 run instead (`enqueueAiEditJob`'s claim bumps
   * `ai_attempts` to 1 at claim time, so EVERY first run hit this) — a job
   * can sit queued behind `AiEditSlotGate` for minutes, and a reviewer's own
   * `setCurrent()` landing during that wait was silently adopted as "the"
   * snapshot the instant this pipeline run finally started, letting this
   * variant clobber that very choice once it finished. Falling back to
   * `set.currentCardVariantId` only when the field is genuinely absent
   * (a legacy row predating this feature) keeps old rows working the same
   * as before.
   *
   * Defensive by design, same as `reprocess()` always was: any failure —
   * missing source photo, unreachable AI service, non-2xx, timeout — must
   * resolve to a clean `PENDING`/`FAILED` variant (see
   * `resolveAiJobFailureStatus`), never an unhandled rejection that would
   * leave the caller's own outer `catch` as the only thing marking the job
   * failed while the `photo_variants` row (what the FE actually polls)
   * stays stuck `PROCESSING` forever.
   *
   * Every terminal write below is guarded by `AND ai_attempts = $attempt`
   * as well as `AND status = 'PROCESSING'` (C1) — without the attempt
   * guard, a stale/superseded run (this exact scenario: a recovery sweep
   * requeues attempt 1, then a user re-claims to attempt 2 before attempt
   * 1's own slow pipeline call finally returns) could clobber the NEWER
   * attempt's own in-progress or already-finished result.
   */
  async processReprocessJob(
    setId: string,
    variantId: string,
    attempt = 0,
  ): Promise<void> {
    const set = await this.findSetEntityOrFail(setId);
    const variant = await this.findVariantEntityOrFail(variantId);
    const snapshotCurrentVariantId =
      variant.aiRequestParams?.snapshotCurrentVariantId !== undefined
        ? (variant.aiRequestParams.snapshotCurrentVariantId ?? null)
        : (set.currentCardVariantId ?? null);

    try {
      const kind = await this.photoKindService.findKindEntityOrFail(set.kindId);
      const sessionContext = await this.resolveSessionContext(
        set.sourceSessionId,
      );
      const frontPhoto = await this.findFrontSourcePhoto(set.sourceSessionId);
      if (!frontPhoto) {
        // reprocess() already validated a front photo existed before
        // enqueuing this job — reaching here means it vanished in the
        // meantime, which should not happen in practice. Handled as an
        // ordinary pipeline failure (falls into the catch below) rather
        // than a special case.
        throw new PhotoAiError(
          "No original photo found for this set's source session",
          'Terminal',
        );
      }

      const sourceBytes = await this.readSourcePhotoBytes(
        frontPhoto,
        sessionContext.tenantName,
      );
      const aiSteps = await this.resolveAiProcessingSteps(set.campaignId);
      const effectiveCardSpec = await this.resolveEffectiveCardSpec(
        set.campaignId,
        kind.cardSpec,
      );
      // 2026-09-30 (user decision, "Fallback ảnh gốc"): a TERMINAL pipeline
      // failure — `resolveAiJobFailureStatus` says 'FAILED', i.e. the AI
      // service is unreachable/unavailable, a non-retryable rejection, or a
      // retryable failure that already used up `AI_EDIT_MAX_ATTEMPTS` — no
      // longer demotes the set to the LOCKED `AUTO_FAILED` state. That state
      // blocked approve/ai-edit/upload entirely, and with `services/python-ai`
      // deleted (2026-09-28) it is where EVERY campaign without a working
      // `AI_EDIT` step landed. Instead the untouched original FRONT capture
      // becomes this variant's image (`READY` set, warning attached) so a
      // reviewer can still approve it, run "Sửa bằng AI", or upload a
      // replacement. A `'retry'`-class failure is re-thrown unchanged — the
      // recovery sweep still gets its chance before this ever applies.
      //
      // ONLY when the set had no current card when this run was requested
      // (`snapshotCurrentVariantId` null — a first-ever run, or a retry out of
      // `PENDING_AUTO`/`AUTO_FAILED`): a failed regeneration on a set that
      // already HAS a card (possibly an AI-edited or uploaded one) must keep
      // its long-standing behavior — variant marked FAILED, set and current
      // card left exactly as they were (`recordReprocessFailure`'s
      // `safeToFail`). Without this guard the raw original would be promoted
      // over a good card whenever a reviewer clicks "Tạo lại ảnh 4x6" while
      // the AI service is down (found in the 2026-09-30 re-test).
      let fallbackReason: string | null = null;
      let result: {
        imageBase64: string;
        mimeType: string;
        width: number | null;
        height: number | null;
        dpi: number | null;
        warnings: string[];
      };
      try {
        result = await this.runAiProcessingPipeline({
          steps: aiSteps,
          initialImageBase64: sourceBytes.toString('base64'),
          cardSpec: effectiveCardSpec,
          mirror: true,
        });
      } catch (pipelineError) {
        if (
          resolveAiJobFailureStatus(pipelineError, variant.aiAttempts) !==
            'FAILED' ||
          snapshotCurrentVariantId
        ) {
          throw pipelineError;
        }
        fallbackReason = redactInternalHost(
          extractSidecarFailureMessage(pipelineError),
        );
        this.logger.warn(
          `reprocess: AI pipeline failed terminally for set ${setId} (attempt ${attempt}) — falling back to the unprocessed original photo: ${fallbackReason}`,
        );
        result = {
          imageBase64: sourceBytes.toString('base64'),
          mimeType: frontPhoto.mimeType,
          width: null,
          height: null,
          dpi: null,
          warnings: [
            'Xử lý ảnh thẻ tự động không khả dụng — đang dùng ẢNH GỐC CHƯA XỬ LÝ (chưa cắt/căn khuôn mặt, chưa lật gương, chưa xử lý nền). Hãy kiểm tra kỹ trước khi Duyệt, hoặc dùng "Sửa bằng AI" / "Thay bằng ảnh tải lên".',
          ],
        };
      }

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
        // Hash computed up front (pure, no DB call) so the guarded UPDATE
        // below can run BEFORE the outbox write — see
        // `insertVariantOutboxContent`'s own doc comment for why this order
        // matters (2026-09-29 outbox-idempotency fix): only once this
        // attempt has actually won the `DONE` transition do we write its
        // bytes to `variant_upload_outbox`.
        const stored = this.hashVariantBytes(data);

        // Guarded UPDATE, not a blind `save(variant)` on the in-memory
        // entity fetched BEFORE the (now potentially minutes-long) pipeline
        // run above — same stale-entity fix `aiEdit()` already uses (see
        // its own comment): a concurrent `discardVariant()` on this same
        // PROCESSING variant is legal, and without `WHERE status =
        // 'PROCESSING'` this would silently revert it back to DONE. `AND
        // ai_attempts = $12` (2026-09-29, C1) additionally makes this a
        // no-op if a NEWER attempt has since re-claimed this variant — see
        // this method's own top doc comment, and `note` is explicitly
        // cleared so a stale PENDING/FAILED note from an earlier attempt
        // never lingers on a now-successful row.
        const [readyRows]: [Array<{ id: string }>, number] =
          await manager.query(
            `UPDATE photo_variants
                SET status = $2, virtual_path = $3, bytes = $4, sha256 = $5,
                    width = $6, height = $7, dpi = $8, quality_report = $9,
                    algorithm_version = $10, note = NULL, updated_at = now()
              WHERE id = $1 AND status = $11 AND ai_attempts = $12
              RETURNING id`,
            [
              variant.id,
              PhotoVariantStatus.DONE,
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
              attempt,
            ],
          );
        const appliedToReady = readyRows.length > 0;
        if (!appliedToReady) {
          this.logger.warn(
            `reprocess: variant ${variant.id} was discarded (or superseded by a newer attempt) while its pipeline run was still in flight — result dropped, not resurrected`,
          );
          return;
        }

        // Only written now that this attempt has confirmed it won the
        // `DONE` transition above — see this transaction's own top comment.
        await this.insertVariantOutboxContent(manager, {
          variantId: variant.id,
          tenantName: sessionContext.tenantName,
          virtualPath,
          mimeType: result.mimeType,
          data,
          idempotencyKey: `photo-review:${variant.id}:auto`,
        });

        await this.writeEvent(manager, {
          setId,
          variantId: variant.id,
          action: PhotoReviewAction.AUTO_GENERATED,
          actorUserId: null,
          payload: fallbackReason
            ? { fallback: 'ORIGINAL_PHOTO', reason: fallbackReason }
            : null,
        });
        if (fallbackReason) {
          // The AI step still failed — keep counting it in `auto_failed` so
          // ops can see the failure rate even though the set is no longer
          // demoted to `AUTO_FAILED` (see the fallback comment above).
          await this.reviewStats.recordAutoFailed(
            manager,
            lockedSet.campaignId,
            new Date(),
          );
        }

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
          ...(fallbackReason ? { fallback: 'ORIGINAL_PHOTO' } : {}),
        },
      });
    } catch (error) {
      const message = extractSidecarFailureMessage(error);
      const nextStatus = resolveAiJobFailureStatus(error, variant.aiAttempts);
      this.logger.warn(
        `reprocess failed for set ${setId} (attempt ${attempt}, → ${nextStatus}): ${message}`,
      );
      await this.recordReprocessFailure(
        setId,
        variantId,
        attempt,
        message,
        nextStatus,
      );
    }
  }

  /**
   * Shared failure handler for `processReprocessJob` (2026-09-29,
   * priority-preemption rework — extracted so the retry-vs-FAILED branch
   * only needs writing once; simplified same-day per user request "bỏ
   * PENDING đi"). `nextStatus` is `resolveAiJobFailureStatus`'s own
   * decision, passed in rather than recomputed here.
   *
   * `'retry'`: attempt-guarded variant UPDATE only — `status` stays
   * `expectedStatus` (normally `PROCESSING`; only `note`/`updated_at`
   * change) — deliberately does NOT write a `photo_review_events` row, does
   * NOT call `reviewStats.recordAutoFailed`, and does NOT touch the SET's
   * own status at all. This is a transient, about-to-be-auto-retried state
   * (by `AiEditRecoveryService`'s sweep), not a reportable failure —
   * recording it as one would double-count `AUTO_FAILED` stats/events for
   * what is, to every human involved, still "in progress".
   *
   * `'FAILED'`: unchanged from before this rework — the existing
   * `AUTO_FAILED` event + "only demote the SET when it has no valid current
   * card" (`safeToFail`) logic, now inside this shared helper.
   *
   * `expectedStatus` (default `PROCESSING`, the normal job-path case) is
   * what the guarded UPDATE's `WHERE status = …` checks against — also
   * called from `requeueStuckAiEditVariants` for an attempts-exhausted
   * `DRAFT` row (never `PROCESSING` there), so it must not be hardcoded.
   */
  private async recordReprocessFailure(
    setId: string,
    variantId: string,
    attempt: number,
    message: string,
    nextStatus: 'retry' | 'FAILED',
    expectedStatus: PhotoVariantStatus = PhotoVariantStatus.PROCESSING,
  ): Promise<void> {
    if (nextStatus === 'retry') {
      await this.transitionVariantStatus(this.dataSource, {
        variantId,
        from: expectedStatus,
        to: expectedStatus,
        attempt,
        note: message,
      });
      return;
    }

    await this.dataSource.transaction(async (manager) => {
      const lockedSet = await this.lockSet(manager, setId);
      const fromStatus = lockedSet.status;
      // Guarded UPDATE — same stale-entity/attempt reasoning as the success
      // path above: a concurrent discardVariant() on this PROCESSING
      // variant is legal while the pipeline was running, and a newer
      // attempt may have already re-claimed this row. 2026-09-29 fix: the
      // result is now checked (`updated`) — this used to be fire-and-forget,
      // so a 0-row match (this attempt already superseded/discarded) still
      // wrote the `AUTO_FAILED` event and could still demote the SET below,
      // even while a NEWER attempt was still legitimately running.
      const updated = await this.transitionVariantStatus(manager, {
        variantId,
        from: expectedStatus,
        to: PhotoVariantStatus.FAILED,
        attempt,
        note: message,
      });
      if (!updated) {
        this.logger.warn(
          `recordReprocessFailure: variant ${variantId} was discarded (or superseded by a newer attempt) before this failure (attempt ${attempt}) could be recorded — skipping event/stats/set-demotion`,
        );
        return;
      }

      await this.writeEvent(manager, {
        setId,
        variantId,
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
          lockedSet.campaignId,
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

  // ── POST /v1/review/sets/:id/ai-edit ────────────────────────────────

  /**
   * Creates the `CARD_AI` variant (`DRAFT`, then immediately claimed to
   * `PROCESSING` by `enqueueAiEditJob`) and enqueues the actual `/edit`
   * call onto the USER lane (always — a reviewer clicking "Sửa bằng AI" in
   * the CMS is, by definition, the direct-user-action case this whole
   * priority rework exists for) — returns as soon as that's durable,
   * without waiting for the AI service (2026-09-29 user request, same
   * queue split `reprocess()` uses; see `enqueueAiEditJob`'s own doc
   * comment). The `PhotoVariantDao` this returns is a `PROCESSING`
   * snapshot — unchanged contract from before this queue existed, since
   * `GET /v1/review/jobs/:id` (`getJob`) was already documented and built
   * for exactly this "poll for the real result" case.
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

    // Validated here only (fail fast, before creating a variant at all) —
    // `processAiEditJob` re-fetches its own `kind`/`cardSpec` once the job
    // actually runs (2026-09-29, queue), rather than threading it through.
    await this.photoKindService.findKindEntityOrFail(set.kindId);
    const sessionContext = await this.resolveSessionContext(
      set.sourceSessionId,
    );

    const variant = await this.dataSource.transaction(async (manager) => {
      await this.lockSet(manager, setId);

      // In-flight cap (2026-09-29 hardening, see `AI_EDIT_MAX_IN_FLIGHT_PER_SET`'s
      // own doc comment; 2026-09-30 fix — confirmed audit finding): moved
      // inside the transaction, AFTER `lockSet`'s pessimistic write lock on
      // this set, so the count and the variant insert below are serialised
      // against every other concurrent `aiEdit()` call for the SAME set.
      // Checking this before the transaction (the original placement) was a
      // check-then-act race — every concurrent request read the same
      // pre-insert count and passed, since nothing yet held any lock; a
      // scripted/compromised reviewer token firing many requests at once
      // could blow straight through the cap, which existed specifically to
      // stop that.
      const inFlightCountRows: Array<{ count: number }> = await manager.query(
        `SELECT count(*)::int AS count FROM photo_variants
          WHERE set_id = $1 AND kind = $2 AND status = ANY($3::text[])`,
        [
          setId,
          PhotoVariantKind.CARD_AI,
          [PhotoVariantStatus.DRAFT, PhotoVariantStatus.PROCESSING],
        ],
      );
      const inFlightCount = inFlightCountRows[0]?.count ?? 0;
      if (inFlightCount >= AI_EDIT_MAX_IN_FLIGHT_PER_SET) {
        throw new CustomException(
          `Too many AI-edit requests already in flight for this set (max ${AI_EDIT_MAX_IN_FLIGHT_PER_SET}) — wait for one to finish before requesting another`,
          PHOTO_REVIEW_ERROR_CODE.AI_EDIT_IN_FLIGHT_LIMIT,
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      const version = await this.nextVersion(manager, setId);
      const repo = manager.getRepository(PhotoVariant);
      const created = await repo.save(
        repo.create({
          setId,
          version,
          kind: PhotoVariantKind.CARD_AI,
          status: PhotoVariantStatus.DRAFT,
          derivedFromVariantId: fromVariant?.id ?? null,
          sourcePhotoId: sourcePhoto?.id ?? null,
          prompt: dto.prompt,
          regionMode: dto.region ?? null,
          createdByUserId: actorUserId,
          // Durable copy (2026-09-29, priority-preemption rework) of what
          // used to live ONLY in the BullMQ job's own `data.payload` — a
          // lost/crashed job can now always be reconstructed from this row
          // alone by `AiEditRecoveryService`. `undefined` fields collapse
          // to a bare `{}` rather than `{cfg: undefined, ...}` so an
          // unset field never round-trips as a literal JSON `null`.
          aiRequestParams:
            dto.cfg === undefined &&
            dto.steps === undefined &&
            dto.seed === undefined
              ? null
              : {
                  ...(dto.cfg !== undefined ? { cfg: dto.cfg } : {}),
                  ...(dto.steps !== undefined ? { steps: dto.steps } : {}),
                  ...(dto.seed !== undefined ? { seed: dto.seed } : {}),
                },
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

    // Always the USER lane — see this method's own top doc comment.
    const { attempt } = await this.enqueueAiEditJob({
      kind: AiEditJobKind.AI_EDIT,
      variantId: variant.id,
      setId,
      origin: AiEditJobOrigin.USER,
      claimFrom: [PhotoVariantStatus.DRAFT],
    });
    // Reflected on the in-memory entity BEFORE `toVariantDao` below (F5:
    // the CMS's `AiEditModal` only starts polling `GET /v1/review/jobs/:id`
    // when this response says `PROCESSING`) — `variant` itself still holds
    // whatever `enqueueAiEditJob`'s own claim UPDATE just changed it to on
    // the ROW, which this in-memory object has no idea about.
    variant.status = PhotoVariantStatus.PROCESSING;
    variant.aiAttempts = attempt ?? variant.aiAttempts;

    return this.toVariantDao(variant, apiBaseUrl, sessionContext.tenantName);
  }

  /**
   * The actual `/edit` call for one `aiEdit()` job — called by
   * `runQueuedAiEditJob` (which `AiEditProcessor`/`AiEditBackgroundProcessor`
   * both dispatch through), never directly by a controller. Extracted
   * 2026-09-29 out of `aiEdit()` itself (see that method's own comment) so
   * it can run from the queue instead of inline inside the original HTTP
   * request. Re-resolves `set`/`kind`/`sessionContext`/`fromVariant`/
   * `sourcePhoto` fresh from the already-created `variant` row (its
   * `derivedFromVariantId`/`sourcePhotoId`/`prompt`/`regionMode` columns).
   * `cfg`/`steps`/`seed` come from `variant.aiRequestParams` (durable,
   * 2026-09-29 priority-preemption rework) with the legacy `payload`
   * parameter as a fallback ONLY for a job enqueued before that column
   * existed — every job `enqueueAiEditJob` creates from now on sends no
   * `payload` at all (see `AiEditJobData`'s own doc comment).
   *
   * Every terminal write below is guarded by `AND ai_attempts = $attempt`
   * as well as `AND status = 'PROCESSING'` (C1) — see
   * `processReprocessJob`'s own doc comment for the full reasoning (same
   * stale/superseded-attempt race, same fix).
   */
  async processAiEditJob(
    setId: string,
    variantId: string,
    payload: { cfg?: number; steps?: number; seed?: number },
    attempt = 0,
  ): Promise<void> {
    const set = await this.findSetEntityOrFail(setId);
    const variant = await this.findVariantEntityOrFail(variantId);
    const kind = await this.photoKindService.findKindEntityOrFail(set.kindId);
    const sessionContext = await this.resolveSessionContext(
      set.sourceSessionId,
    );
    const params = variant.aiRequestParams ?? payload ?? {};

    let fromVariant: PhotoVariant | null = null;
    let sourcePhoto: FrontSourcePhoto | null = null;
    if (variant.derivedFromVariantId) {
      fromVariant = await this.findVariantEntityOrFail(
        variant.derivedFromVariantId,
      );
    } else if (variant.sourcePhotoId) {
      sourcePhoto = await this.findPhotoOrFail(
        variant.sourcePhotoId,
        set.sourceSessionId,
      );
    }

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
        variant.prompt ?? undefined,
        effectiveCardSpec,
      );
      const editResult = unwrapPhotoAi(
        await this.photoAi.edit({
          imageBuffer: sourceBytes,
          mimeType: 'image/jpeg',
          prompt: editPrompt,
          cfg: params.cfg,
          steps: params.steps,
          seed: params.seed,
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
        // Hash computed up front (pure, no DB call) — same reorder as
        // `processReprocessJob`'s own transaction, see
        // `insertVariantOutboxContent`'s doc comment (2026-09-29
        // outbox-idempotency fix).
        const stored = this.hashVariantBytes(data);

        // Guarded UPDATE, not a blind `save(variant)` on the in-memory
        // entity this method fetched BEFORE the sidecar call above (which
        // can take up to SIDECAR_TIMEOUT_MS = 30s) — a concurrent
        // `discardVariant()` on this same PROCESSING variant is legal
        // (PROCESSING is neither DISCARDED nor the set's current variant,
        // so nothing blocks it) and, before this fix, would be silently
        // reverted back to DONE the moment this save ran, because the
        // in-memory object has no idea the row changed underneath it.
        // `WHERE status = 'PROCESSING'` makes this a no-op once that race
        // has already happened, instead of overwriting whatever
        // `discardVariant` wrote. `AND ai_attempts = $13` (2026-09-29, C1)
        // additionally no-ops this write if a NEWER attempt has since
        // re-claimed this variant, and `note` is cleared so a stale
        // PENDING/FAILED note never lingers on a now-successful row.
        const [readyRows]: [Array<{ id: string }>, number] =
          await manager.query(
            `UPDATE photo_variants
                SET status = $2, virtual_path = $3, bytes = $4, sha256 = $5,
                    width = $6, height = $7, seed = $8, model_id = $9,
                    algorithm_version = $10, identity_similarity = $11,
                    note = NULL, updated_at = now()
              WHERE id = $1 AND status = $12 AND ai_attempts = $13
              RETURNING id`,
            [
              variant.id,
              PhotoVariantStatus.DONE,
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
              attempt,
            ],
          );
        appliedToReady = readyRows.length > 0;
        if (!appliedToReady) return;

        // Only written now that this attempt has confirmed it won the
        // `DONE` transition above — see this transaction's own top comment.
        await this.insertVariantOutboxContent(manager, {
          variantId: variant.id,
          tenantName: sessionContext.tenantName,
          virtualPath,
          mimeType: result.mimeType,
          data,
          idempotencyKey: `photo-review:${variant.id}:ai`,
        });
        // Not set as current — plan §5.3/§6.2: "con người chấp nhận: không bao
        // giờ tự đặt bản AI làm ảnh hiện tại". A reviewer must call
        // POST /v1/review/variants/:id/accept explicitly.
      });

      if (!appliedToReady) {
        this.logger.warn(
          `aiEdit: variant ${variant.id} was discarded (or superseded by a newer attempt) while its sidecar edit was still in flight — result dropped, not resurrected`,
        );
      } else {
        await this.uploadMetadataBestEffort({
          tenantName: sessionContext.tenantName,
          virtualPath: virtualPath.replace(/\.[^.]+$/, '.json'),
          idempotencyKey: `photo-review:${variant.id}:ai:meta`,
          metadata: {
            prompt: variant.prompt,
            // The prompt ACTUALLY sent to /edit differs from the reviewer's
            // raw prompt whenever the kind's cardSpec has a
            // `backgroundColor` (`appendBackgroundColorInstruction` appends
            // an instruction to it) — recorded separately here (plan §6.2
            // #6 traceability) rather than overwriting `prompt` above, so
            // existing readers of the raw prompt field are unaffected.
            effectivePrompt: editPrompt,
            cfg: params.cfg,
            steps: params.steps,
            region: variant.regionMode,
            modelId: result.modelId,
            seed: result.seed,
            identitySimilarity: result.identitySimilarity,
            algorithmVersion: result.algorithmVersion,
          },
        });
      }
    } catch (error) {
      const message = extractSidecarFailureMessage(error);
      const decision = resolveAiJobFailureStatus(error, variant.aiAttempts);
      // `'retry'` stays PROCESSING (only note/updated_at change) — no
      // separate PENDING status, see `PhotoVariantStatus`'s own doc comment.
      const nextStatus =
        decision === 'retry'
          ? PhotoVariantStatus.PROCESSING
          : PhotoVariantStatus.FAILED;
      this.logger.warn(
        `ai-edit failed for set ${setId} (attempt ${attempt}, → ${decision}): ${message}`,
      );
      // Same guarded-UPDATE fix as the success path above — this catch runs
      // after the same long sidecar await, so the in-memory `variant` can be
      // just as stale here. `AND ai_attempts = $5` (C1) — same reasoning.
      const updated = await this.transitionVariantStatus(this.dataSource, {
        variantId: variant.id,
        from: PhotoVariantStatus.PROCESSING,
        to: nextStatus,
        attempt,
        note: message,
      });
      if (!updated) {
        this.logger.warn(
          `aiEdit: variant ${variant.id} was discarded, or superseded by a newer attempt, before its failed sidecar edit (attempt ${attempt}) could be recorded — no-op`,
        );
      }
    }
  }

  // ── GET /v1/review/jobs/:id ──────────────────────────────────────────

  /**
   * Simplification, documented per the task brief: there is no separate job
   * table in this pass, so `:id` is treated as a `photo_variants.id` and
   * this just returns that variant's current state. `aiEdit`/`reprocess`
   * enqueue onto BullMQ and return immediately (2026-09-29 — see
   * `enqueueAiEditJob`'s own doc comment); this is what the CMS's
   * `AiEditModal` polls to see a `PROCESSING` variant eventually settle
   * into `DONE`/`PENDING`/`FAILED`.
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
    if (variant.status !== PhotoVariantStatus.DONE) {
      throw new CustomException(
        'Variant is not DONE',
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
   * Identity check against the set's original FRONT photo (plan §5.4/R-Q8):
   * a score BELOW `IDENTITY_SIMILARITY_REJECT_THRESHOLD` still rejects the
   * upload outright. What changed 2026-09-30 (user decision, "Cho phép tải
   * lên, không chặn"): when the check simply CANNOT RUN — the identity
   * backend (`services/python-ai`) was deleted 2026-09-28, so every call now
   * fails — the upload used to be refused with a 503, which made "Thay bằng
   * ảnh tải lên" unusable for every campaign. It is now fail-open, exactly
   * like `acceptVariant` already was (2026-09-29): the variant is stored
   * with a `null` score, the `UPLOAD_REPLACED` event records
   * `identityVerified: false`, and the CMS shows "chưa xác minh được danh
   * tính". The same applies to the card-photo step: if it fails, the
   * uploaded image is used as-is (warning attached) instead of failing.
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

    let similarity: number | null = null;
    try {
      // readSourcePhotoBytes prefers upload_outbox.content (Part A) over a
      // file-service round trip — resolved here, inside the try, so a photo
      // with no bytes available anywhere yet (not staged locally, not on
      // fs-core) degrades through the same "check could not run" path as an
      // unreachable sidecar, rather than a second bespoke error path.
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
      // Fail-open (see this method's doc comment): log it, store no score.
      this.logger.warn(
        `uploadVariant: identity check could not run for set ${setId} — accepting the upload UNVERIFIED: ${redactInternalHost(
          extractSidecarFailureMessage(error),
        )}`,
      );
    }

    if (
      similarity !== null &&
      similarity < IDENTITY_SIMILARITY_REJECT_THRESHOLD
    ) {
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
    // Fail-open (see this method's doc comment): when the card-photo step
    // fails, the image the operator picked IS the card image — unprocessed
    // (no crop/background/dpi), with a reviewer-visible warning.
    let cardFallbackReason: string | null = null;
    let cardResult: {
      imageBase64: string;
      mimeType: string;
      width: number | null;
      height: number | null;
      dpi: number | null;
      warnings: string[];
    };
    if (cardOutcome.kind === 'Success') {
      cardResult = cardOutcome.value;
    } else {
      cardFallbackReason = redactInternalHost(cardOutcome.reason);
      this.logger.warn(
        `uploadVariant: card-photo step failed for set ${setId} — using the uploaded image as-is: ${cardFallbackReason}`,
      );
      cardResult = {
        imageBase64: file.buffer.toString('base64'),
        mimeType: file.mimetype,
        width: null,
        height: null,
        dpi: null,
        warnings: [
          'Xử lý ảnh thẻ tự động không khả dụng — đang dùng ẢNH TẢI LÊN NGUYÊN BẢN (chưa cắt/căn khuôn mặt, chưa lật gương, chưa xử lý nền). Hãy kiểm tra kỹ trước khi Duyệt.',
        ],
      };
    }

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
          // Never touches the AI-edit queue at all (no `enqueueAiEditJob`
          // call anywhere in this method) — created directly at its final
          // status, same as before this rework's DRAFT/PROCESSING claim
          // dance, which only applies to a variant that actually goes
          // through `ai-edit`/`ai-edit-background`.
          status: PhotoVariantStatus.DONE,
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
          ...(cardFallbackReason ? { fallback: 'ORIGINAL_UPLOAD' } : {}),
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
        // Same audit convention `acceptVariant` uses: an unverified upload
        // must be distinguishable from "checked and passed".
        payload: {
          ...(similarity === null
            ? { identityVerified: false }
            : { identityVerified: true, identitySimilarity: similarity }),
          ...(cardFallbackReason
            ? { fallback: 'ORIGINAL_UPLOAD', reason: cardFallbackReason }
            : {}),
        },
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
      identitySimilarity: similarity ?? undefined,
      identityWarning:
        similarity !== null && similarity < IDENTITY_SIMILARITY_WARN_THRESHOLD,
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
    if (variant.status !== PhotoVariantStatus.DONE) {
      throw new CustomException(
        'Only a DONE variant can be set as current',
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

    await this.applySetDecision(set, status, action, dto, actorUserId);

    return this.getSetDetail(setId, apiBaseUrl);
  }

  // ── POST /v1/review/sets/approve, /reject (1-n) ──────────────────────

  async approveMany(
    dto: BulkApproveRejectDto,
    actorUserId: string | null,
  ): Promise<BulkReviewDecisionResultDao> {
    return this.decideMany(
      dto,
      PhotoReviewSetStatus.APPROVED,
      PhotoReviewAction.APPROVED,
      actorUserId,
    );
  }

  async rejectMany(
    dto: BulkApproveRejectDto,
    actorUserId: string | null,
  ): Promise<BulkReviewDecisionResultDao> {
    return this.decideMany(
      dto,
      PhotoReviewSetStatus.REJECTED,
      PhotoReviewAction.REJECTED,
      actorUserId,
    );
  }

  /**
   * The 1-n form of `transitionSetStatus`. Deliberately NOT one big
   * transaction and NOT parallel (`runBulk` runs the items sequentially):
   *
   *  - one transaction PER set (`applySetDecision`), so one set failing
   *    (locked, out of scope, already printed, ...) never rolls back the
   *    others — partial success with a per-set result is the contract;
   *  - strictly sequential, because every set's decision has side effects on
   *    shared rows: `ReviewStatsService.recordDecision` upserts one per-day
   *    counter row, and the synchronous `PhotoSetStatusChangedEvent` handler
   *    (print module) increments `print_batches.item_count` — running sets
   *    concurrently would just have them contend for those same rows.
   *
   * Scope is resolved once via `buildScopePredicate` (one query, not N) and
   * used twice per set: here, against the up-front read (a cheap way to skip
   * opening a transaction for a set the actor cannot touch), and again inside
   * `applySetDecision` against the row-locked copy. The lock state is NOT
   * pre-checked here: this call can run for tens of seconds, so a set that
   * was still PENDING_AUTO when the batch began may be unlocked by the time
   * its turn comes — the authoritative `assertUnlocked` runs under the row
   * lock in `applySetDecision`, on fresh data.
   *
   * Ids are compared case-insensitively — Postgres matches a `uuid` column
   * regardless of case but always returns it lower-case, so a JS `Map`/`Set`
   * keyed by the caller's spelling would report an existing set as missing
   * and fail to collapse `ABC..`/`abc..` duplicates. Duplicates are
   * collapsed (first occurrence keeps its position and its spelling in the
   * result) and `requested` reports the de-duplicated count. Every per-set
   * failure — including an unexpected 500 — is caught and reported on that
   * set's own result; only a failure resolving the actor's scope up front
   * fails the whole call.
   */
  private async decideMany(
    dto: BulkApproveRejectDto,
    status: PhotoReviewSetStatus,
    action: PhotoReviewAction,
    actorUserId: string | null,
  ): Promise<BulkReviewDecisionResultDao> {
    // canonical (lower-case) id -> the caller's spelling of its FIRST occurrence
    const requested = new Map<string, string>();
    for (const id of dto.setIds) {
      const key = id.toLowerCase();
      if (!requested.has(key)) requested.set(key, id);
    }
    const items = [...requested].map(([key, setId]) => ({ key, setId }));

    const sets = await this.setRepository.find({
      where: { id: In(items.map((i) => i.key)) },
    });
    const byId = new Map(sets.map((s) => [s.id, s] as const));
    const inScope =
      await this.reviewAssignments.buildScopePredicate(actorUserId);

    return toDao(
      BulkReviewDecisionResultDao,
      await runBulk(items, {
        run: async ({ key, setId }) => {
          const set = byId.get(key);
          if (!set) throw setNotFoundError();
          if (!inScope(set)) throw outOfScopeError();
          const { changed } = await this.applySetDecision(
            set,
            status,
            action,
            dto,
            actorUserId,
            inScope,
          );
          return { setId, status, changed };
        },
        keyOf: ({ setId }) => ({ setId }),
        logLabel: ({ setId }) => `Bulk ${action} of set ${setId}`,
        logger: this.logger,
      }),
    );
  }

  /**
   * The shared write for one set's approve/reject — extracted from
   * `transitionSetStatus` so the single route and `decideMany` run the
   * IDENTICAL transaction. `set` is the caller's pre-lock read (used for
   * `campaignId`/`createdAt`, which never change); status is re-read under
   * the row lock.
   *
   * `assertUnlocked` is checked HERE, under the lock (the single route also
   * pre-checks it as a fast-fail; `decideMany` deliberately does not — see its
   * doc comment): a kiosk retake (`ensureSetForSession`) can flip a set back
   * to PENDING_AUTO between the caller's read and this write, and a bulk call
   * widens that window (sets are read up front, decided one by one). Without
   * the recheck a set that became locked mid-call would be approved anyway.
   *
   * `inScope`, when given (the bulk path), is likewise re-evaluated against
   * the row-locked copy: the scope-relevant roster columns
   * (`class_name`/`faculty`/`major`) can be rewritten by a retake between the
   * up-front read and this write. It is checked BEFORE the lock state so a
   * reviewer outside the set's scope learns nothing about it. The predicate
   * is a snapshot of the actor's assignments taken when the bulk call
   * started, so it does not observe an assignment revoked mid-call (see
   * `ReviewAssignmentService.buildScopePredicate`).
   *
   * Returns `changed: false` for the idempotent no-op (already in the target
   * status) — nothing was written, no event, no stats.
   */
  private async applySetDecision(
    set: SubjectPhotoSet,
    status: PhotoReviewSetStatus,
    action: PhotoReviewAction,
    dto: { note?: string },
    actorUserId: string | null,
    inScope?: (target: ScopeTarget) => boolean,
  ): Promise<{ changed: boolean }> {
    const setId = set.id;
    let changed = true;
    await this.dataSource.transaction(async (manager) => {
      const lockedSet = await this.lockSet(manager, set.id);
      if (inScope && !inScope(lockedSet)) throw outOfScopeError();
      this.assertUnlocked(lockedSet);
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
        changed = false;
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

    return { changed };
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

  // ── AI-edit restart recovery (2026-09-29, priority-preemption rework) ──

  /**
   * Called by `AiEditRecoveryService`'s sweep (boot + every 5 minutes) —
   * finds `photo_variants` rows that fell out of BullMQ (crash/restart
   * between claim and completion, a Redis flush, a job that was never
   * successfully added — see `enqueueAiEditJob`'s own walk-back branch — or
   * simply a retryable failure waiting for its next attempt, see
   * `PhotoVariantStatus`'s own doc comment for why that has no separate
   * status of its own) and either re-enqueues them (background lane — a
   * recovery-sweep requeue is never itself the "user just clicked"
   * priority case, even if the ORIGINAL run was) or, once
   * `AI_EDIT_MAX_ATTEMPTS` is exhausted, resolves them to `FAILED` instead
   * of sweeping forever.
   *
   * "Fell out of BullMQ" is determined by first listing every job still
   * live in EITHER queue (`getJobs(['active','waiting','prioritized',
   * 'delayed','waiting-children'], 0, -1)` — deliberately NOT `'paused'`,
   * which is not a valid `JobType` in bullmq 6.3.9 and neither queue is
   * ever paused) and reading each one's OWN `variantId`/`attempt` straight
   * off `job.data` (2026-09-29 fix) rather than trusting its BullMQ job id
   * to follow the `pv-<id>-<attempt>` format — a legacy job enqueued before
   * this rework (auto-generated numeric id, `attempt` absent — see
   * `AiEditJobData`'s own doc comment on its legacy `payload` field) would
   * otherwise never be recognised as live, so the very first sweep after
   * this rework's deploy would re-claim every legacy in-flight job from
   * scratch, discarding its `cfg`/`steps`/`seed` (only ever carried in that
   * old job's own `payload`) and possibly racing it with a brand-new
   * attempt.
   *
   * Candidate rows (kind `CARD_AUTO`/`CARD_AI` only — `CARD_UPLOAD` never
   * touches this queue at all):
   * - `PROCESSING`: stale for `AI_EDIT_RECOVERY_PROCESSING_STALE_MS` AND not
   *   `id = ANY(<live variant ids>)` — covers BOTH "actually crashed
   *   mid-run" AND "a retryable failure (timeout/transient error) is
   *   sitting here waiting for its next attempt" (there is no separate
   *   status for the latter, see `PhotoVariantStatus`'s own doc comment —
   *   at the DB level the two are indistinguishable, and don't need to be:
   *   both just get re-enqueued). The live-variant exclusion is applied IN
   *   SQL, before `ORDER BY created_at LIMIT AI_EDIT_RECOVERY_BATCH_LIMIT`
   *   runs (2026-09-29 fix): a large, entirely-legitimate background
   *   backlog (`AI_EDIT_BACKGROUND_CONCURRENCY` is 1, so a busy campaign day
   *   can easily queue hundreds of still-live `PROCESSING` rows older than
   *   `AI_EDIT_RECOVERY_PROCESSING_STALE_MS`) used to fill the whole
   *   `LIMIT`-ed batch with rows this loop would immediately skip anyway,
   *   starving a genuinely stuck newer row from ever being reached until
   *   the backlog drained below the batch size. The exclusion is
   *   deliberately broad (any live job for that variant id, any attempt) —
   *   the loop's own per-attempt check below stays the precise, final
   *   arbiter for whatever DOES make it into the batch.
   * - `DRAFT`: stale for `AI_EDIT_RECOVERY_MIN_AGE_MS` — `enqueueAiEditJob`
   *   itself crashed/never ran between the variant's creation and its own
   *   claim UPDATE.
   *
   * `ORDER BY created_at LIMIT AI_EDIT_RECOVERY_BATCH_LIMIT` bounds one
   * sweep tick to a fixed amount of work; a backlog beyond that limit is
   * simply picked up by the NEXT tick (5 minutes later) instead of making
   * one tick run unboundedly long. The `getJobs(..., 0, -1)` listing itself
   * stays unbounded (a per-candidate `queue.getJob(deterministicId)` lookup
   * would be cheaper, but would reintroduce the exact legacy-job blind spot
   * this fix closes, since a legacy job's real id is not derivable from the
   * variant/attempt alone) — `aiEdit()`'s own new per-set in-flight cap
   * (`AI_EDIT_MAX_IN_FLIGHT_PER_SET`) is this module's actual answer to an
   * unbounded queue backlog, rather than optimising this listing.
   */
  async requeueStuckAiEditVariants(options: {
    onBoot: boolean;
  }): Promise<{ requeued: number; failed: number }> {
    const liveJobs = await Promise.all([
      this.aiEditQueue.getJobs([...AI_EDIT_LIVE_JOB_STATES], 0, -1),
      this.aiEditBackgroundQueue.getJobs([...AI_EDIT_LIVE_JOB_STATES], 0, -1),
    ]);
    // Keyed by `variantId` (from each job's own `data`, not its BullMQ job
    // id) — see this method's own top doc comment for why.
    const liveAttemptByVariant = new Map<string, number>();
    for (const job of [...liveJobs[0], ...liveJobs[1]]) {
      if (job.data?.variantId) {
        liveAttemptByVariant.set(job.data.variantId, job.data.attempt ?? 0);
      }
    }
    const liveVariantIds = [...liveAttemptByVariant.keys()];

    // At boot, use `AI_EDIT_RECOVERY_BOOT_GRACE_MS` for both branches instead
    // of the normal, much longer grace periods (2026-09-29, folded in from
    // the removed PENDING branch's own boot handling) — nothing from a
    // PREVIOUS process can still be genuinely in flight right after a fresh
    // start, and anything actually still live shows up in `liveVariantIds`
    // (read fresh from Redis above) regardless of age, so there is no need
    // to wait out the FULL normal grace period here. This still makes a
    // genuine crash recover promptly at boot instead of waiting up to
    // `AI_EDIT_RECOVERY_PROCESSING_STALE_MS`/`AI_EDIT_RECOVERY_MIN_AGE_MS`.
    //
    // NOT age 0, though (2026-09-30 fix — confirmed audit finding): this
    // app's split `command`/`worker` `SERVICE_TYPE` deployment means a
    // `command` host can claim a row (or create a fresh DRAFT one) via
    // `POST .../reprocess`/`ai-edit` at any moment while a `worker` host is
    // still booting — including in the gap between this sweep's own
    // `getJobs` listing above and its candidate SELECT below. Age 0 let the
    // boot sweep re-claim that row as `RECOVERY` before the `command`
    // host's own `queue.add` (bounded to 5s — see `enqueueAiEditJob`) had
    // even landed, stealing it onto the background lane out from under the
    // request that just claimed it. See `AI_EDIT_RECOVERY_BOOT_GRACE_MS`'s
    // own doc comment for why this value is safely past that window.
    const processingStaleMs = options.onBoot
      ? AI_EDIT_RECOVERY_BOOT_GRACE_MS
      : AI_EDIT_RECOVERY_PROCESSING_STALE_MS;
    const draftMinAgeMs = options.onBoot
      ? AI_EDIT_RECOVERY_BOOT_GRACE_MS
      : AI_EDIT_RECOVERY_MIN_AGE_MS;
    const candidates: Array<{
      id: string;
      set_id: string;
      kind: PhotoVariantKind;
      status: PhotoVariantStatus;
      ai_attempts: number;
    }> = await this.dataSource.query(
      `SELECT id, set_id, kind, status, ai_attempts
         FROM photo_variants
        WHERE kind IN ($1, $2)
          AND (
            (
              status = $3 AND updated_at < now() - ($4::text || ' milliseconds')::interval
              AND NOT (id = ANY($8::uuid[]))
            )
            OR (status = $5 AND updated_at < now() - ($6::text || ' milliseconds')::interval)
          )
        ORDER BY created_at ASC
        LIMIT $7`,
      [
        PhotoVariantKind.CARD_AUTO,
        PhotoVariantKind.CARD_AI,
        PhotoVariantStatus.PROCESSING,
        processingStaleMs,
        PhotoVariantStatus.DRAFT,
        draftMinAgeMs,
        AI_EDIT_RECOVERY_BATCH_LIMIT,
        liveVariantIds,
      ],
    );

    let requeued = 0;
    let failed = 0;
    for (const row of candidates) {
      // Precise, per-attempt safety net behind the broader SQL exclusion
      // above — see this method's own top doc comment.
      if (
        row.status === PhotoVariantStatus.PROCESSING &&
        liveAttemptByVariant.get(row.id) === row.ai_attempts
      ) {
        // Genuinely still running/queued in BullMQ — not actually stuck,
        // just old (a slow AI call can legitimately take minutes).
        continue;
      }

      if (row.ai_attempts >= AI_EDIT_MAX_ATTEMPTS) {
        const message = `AI-edit recovery: variant ${row.id} exhausted ${row.ai_attempts} attempts — giving up`;
        this.logger.warn(message);
        if (row.kind === PhotoVariantKind.CARD_AUTO) {
          await this.recordReprocessFailure(
            row.set_id,
            row.id,
            row.ai_attempts,
            message,
            'FAILED',
            row.status,
          );
        } else {
          // 2026-09-29 fix (reuse/drift): this branch had silently lost the
          // `ai_attempts` guard `transitionVariantStatus`'s other callers
          // all keep — a USER re-claim (`promoteToUserLane`) bumping this
          // row's attempt between this method's own SELECT above and this
          // UPDATE could have its now-running newer attempt overwritten to
          // FAILED by this stale one.
          await this.transitionVariantStatus(this.dataSource, {
            variantId: row.id,
            from: row.status,
            to: PhotoVariantStatus.FAILED,
            attempt: row.ai_attempts,
            note: message,
          });
        }
        failed += 1;
        continue;
      }

      const result = await this.enqueueAiEditJob({
        kind: aiEditJobKindFor(row.kind),
        variantId: row.id,
        setId: row.set_id,
        origin: AiEditJobOrigin.RECOVERY,
        claimFrom: [row.status],
        expectedAttempts: row.ai_attempts,
      });
      if (result.enqueued) requeued += 1;
    }

    return { requeued, failed };
  }
}
