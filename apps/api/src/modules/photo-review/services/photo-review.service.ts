import { CustomException } from '@app/common/errors';
import { toDao } from '@app/common/helpers';
import { FileStorageService } from '@app/modules/file-storage/services/file-storage.service';
import { Pagination } from '@app/modules/shared/common/pagination';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import archiver from 'archiver';
import { createHash } from 'node:crypto';
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

/** Bytes + a couple of file-service upload fields, in whichever shape `uploadCardBytes` needs to hand back to its callers. */
interface UploadedBytesResult {
  fsFileId: string;
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

  /** Tenant + year for a session — mirrors `PhotoService.resolveViewContext`'s tenant rule (KIOSK → device id, else the API's own default tenant) exactly, read via plain SQL since `sessions` belongs to the `capture` module. */
  private async resolveSessionContext(sessionId: string): Promise<SessionContext> {
    const rows: Array<{ source: string; device_id: string | null; at: Date }> = await this.dataSource.query(
      `SELECT source, device_id, COALESCE(captured_at, created_at) AS at FROM sessions WHERE id = $1`,
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
      tenantName: row.source === 'KIOSK' && row.device_id ? row.device_id : undefined,
      year: new Date(row.at).getFullYear(),
    };
  }

  /** Batch version of `resolveSessionContext`, tenant only — used by list/export so N rows cost one query instead of N. */
  private async batchResolveTenants(sessionIds: string[]): Promise<Map<string, string | undefined>> {
    const map = new Map<string, string | undefined>();
    if (sessionIds.length === 0) return map;
    const rows: Array<{ id: string; source: string; device_id: string | null }> = await this.dataSource.query(
      `SELECT id, source, device_id FROM sessions WHERE id = ANY($1::uuid[])`,
      [sessionIds],
    );
    for (const row of rows) {
      map.set(row.id, row.source === 'KIOSK' && row.device_id ? row.device_id : undefined);
    }
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

  private buildVirtualPath(sessionId: string, year: number, prefix: string, version: number, ext: string): string {
    return `card/${year}/${sessionId}/${prefix}-v${version}.${ext}`;
  }

  /**
   * Writes bytes to the file-service under the right tenant — kiosk
   * sessions use the device's own tenant (`FileStorageService.clientForTenant`,
   * same mechanism `PhotoController`/`PhotoService` already use for
   * view-links), web sessions use the API's own default tenant
   * (`FileStorageService.uploadRaw`). See `FileStorageService`'s own doc
   * comment — this module does not modify that service, only calls its
   * already-public methods.
   */
  private async uploadCardBytes(input: {
    tenantName?: string;
    virtualPath: string;
    mimeType: string;
    data: Buffer;
    idempotencyKey: string;
  }): Promise<UploadedBytesResult> {
    const sha256 = createHash('sha256').update(input.data).digest('hex');
    const uploadInput = {
      virtualPath: input.virtualPath,
      mimeType: input.mimeType,
      data: input.data,
      idempotencyKey: input.idempotencyKey,
      visibility: 'private' as const,
    };

    const result = input.tenantName
      ? await (await this.fileStorage.clientForTenant(input.tenantName)).uploadRaw(uploadInput)
      : await this.fileStorage.uploadRaw(uploadInput);

    return { fsFileId: result.fileId, bytes: input.data.byteLength, sha256 };
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

  private async toVariantDao(variant: PhotoVariant, tenantName?: string): Promise<PhotoVariantDao> {
    const dao = toDao(PhotoVariantDao, variant);
    if (variant.fsFileId) {
      try {
        const link = await this.fileStorage.issueViewLink(variant.fsFileId, 'photo-review', tenantName);
        dao.viewUrl = link.url;
        dao.viewUrlExpiresAt = link.expiresAt;
      } catch (error) {
        this.logger.warn(`view-link failed for variant ${variant.id}: ${(error as Error).message}`);
      }
    }
    return dao;
  }

  // ── GET /v1/review/sets ─────────────────────────────────────────────

  async listSets(query: ListSetsQueryDto): Promise<Pagination<ReviewSetListItemDao>> {
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
      rows.map(async (row) => {
        const fsFileId = row.current_fs_file_id as string | null;
        if (!fsFileId) return null;
        try {
          return await this.fileStorage.issueViewLink(
            fsFileId,
            'photo-review-list',
            tenantMap.get(row.source_session_id as string),
          );
        } catch (error) {
          this.logger.warn(`list view-link failed for set ${row.id}: ${(error as Error).message}`);
          return null;
        }
      }),
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

  async getSetDetail(id: string): Promise<ReviewSetDetailDao> {
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
    const variants = await Promise.all(nonDiscardedVariants.map((v) => this.toVariantDao(v, tenantName)));

    const currentFsFileId = row.current_card_variant_id
      ? nonDiscardedVariants.find((v) => v.id === row.current_card_variant_id)?.fsFileId
      : undefined;
    let currentCardViewUrl: string | undefined;
    let currentCardViewUrlExpiresAt: string | undefined;
    if (currentFsFileId) {
      try {
        const link = await this.fileStorage.issueViewLink(currentFsFileId, 'photo-review-detail', tenantName);
        currentCardViewUrl = link.url;
        currentCardViewUrlExpiresAt = link.expiresAt;
      } catch (error) {
        this.logger.warn(`detail view-link failed for set ${id}: ${(error as Error).message}`);
      }
    }

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
  async reprocess(setId: string, actorUserId: string | null): Promise<PhotoVariantDao> {
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
      if (!frontPhoto.fsFileId) {
        throw new SidecarError('Source photo has not reached the file-service yet');
      }
      const sourceLink = await this.fileStorage.issueViewLink(
        frontPhoto.fsFileId,
        'photo-review-sidecar',
        sessionContext.tenantName,
      );
      const result = await this.sidecar.cardPhoto({
        sourceImageUrl: sourceLink.url,
        cardSpec: kind.cardSpec,
        kindCode: kind.code,
      });

      const ext = this.extForMime(result.mimeType);
      const virtualPath = this.buildVirtualPath(set.sourceSessionId, sessionContext.year, 'auto', variant.version, ext);
      const data = Buffer.from(result.imageBase64, 'base64');
      const uploaded = await this.uploadCardBytes({
        tenantName: sessionContext.tenantName,
        virtualPath,
        mimeType: result.mimeType,
        data,
        idempotencyKey: `photo-review:${variant.id}:auto`,
      });
      await this.uploadMetadataBestEffort({
        tenantName: sessionContext.tenantName,
        virtualPath: virtualPath.replace(/\.[^.]+$/, '.json'),
        idempotencyKey: `photo-review:${variant.id}:auto:meta`,
        metadata: {
          algorithmVersion: result.algorithmVersion,
          qualityReport: result.qualityReport,
          cardSpec: kind.cardSpec,
        },
      });

      return await this.dataSource.transaction(async (manager) => {
        const lockedSet = await this.lockSet(manager, setId);
        const repo = manager.getRepository(PhotoVariant);
        variant.status = PhotoVariantStatus.READY;
        variant.fsFileId = uploaded.fsFileId;
        variant.virtualPath = virtualPath;
        variant.bytes = uploaded.bytes;
        variant.sha256 = uploaded.sha256;
        variant.width = result.width ?? null;
        variant.height = result.height ?? null;
        variant.dpi = result.dpi ?? null;
        variant.qualityReport = result.qualityReport ?? null;
        variant.algorithmVersion = result.algorithmVersion ?? null;
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
    } catch (error) {
      const message = error instanceof SidecarError ? error.message : (error as Error).message;
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

    return this.toVariantDao(variant, sessionContext.tenantName);
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
  async aiEdit(setId: string, dto: AiEditDto, actorUserId: string | null): Promise<PhotoVariantDao> {
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
    if (fromVariant.status === PhotoVariantStatus.DISCARDED || !fromVariant.fsFileId) {
      throw new CustomException(
        'Source variant is not usable (discarded or not yet uploaded)',
        PHOTO_REVIEW_ERROR_CODE.VARIANT_NOT_READY,
        HttpStatus.CONFLICT,
      );
    }
    // Captured into a local: `fromVariant.fsFileId` is used again below,
    // after an `await` on a transaction — TypeScript cannot keep a property
    // access narrowed across a call it can't prove is side-effect free, so
    // a plain local variable is used instead of re-reading the property.
    const fromVariantFsFileId = fromVariant.fsFileId;

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
      const sourceLink = await this.fileStorage.issueViewLink(
        fromVariantFsFileId,
        'photo-review-sidecar',
        sessionContext.tenantName,
      );
      const result = await this.sidecar.edit({
        sourceImageUrl: sourceLink.url,
        prompt: dto.prompt,
        region: dto.region,
        cardSpec: kind.cardSpec,
      });

      const ext = this.extForMime(result.mimeType);
      const virtualPath = this.buildVirtualPath(set.sourceSessionId, sessionContext.year, 'ai', variant.version, ext);
      const data = Buffer.from(result.imageBase64, 'base64');
      const uploaded = await this.uploadCardBytes({
        tenantName: sessionContext.tenantName,
        virtualPath,
        mimeType: result.mimeType,
        data,
        idempotencyKey: `photo-review:${variant.id}:ai`,
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

      variant.status = PhotoVariantStatus.READY;
      variant.fsFileId = uploaded.fsFileId;
      variant.virtualPath = virtualPath;
      variant.bytes = uploaded.bytes;
      variant.sha256 = uploaded.sha256;
      variant.width = result.width ?? null;
      variant.height = result.height ?? null;
      variant.seed = result.seed ?? null;
      variant.modelId = result.modelId ?? null;
      variant.algorithmVersion = result.algorithmVersion ?? null;
      variant.identitySimilarity = result.identitySimilarity ?? null;
      await this.variantRepository.save(variant);
      // Not set as current — plan §5.3/§6.2: "con người chấp nhận: không bao
      // giờ tự đặt bản AI làm ảnh hiện tại". A reviewer must call
      // POST /v1/review/variants/:id/accept explicitly.
    } catch (error) {
      const message = error instanceof SidecarError ? error.message : (error as Error).message;
      this.logger.warn(`ai-edit failed for set ${setId}: ${message}`);
      variant.status = PhotoVariantStatus.FAILED;
      variant.note = message;
      await this.variantRepository.save(variant);
    }

    return this.toVariantDao(variant, sessionContext.tenantName);
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
  async getJob(variantId: string): Promise<PhotoVariantDao> {
    const variant = await this.findVariantEntityOrFail(variantId);
    const set = await this.findSetEntityOrFail(variant.setId);
    const sessionContext = await this.resolveSessionContext(set.sourceSessionId);
    return this.toVariantDao(variant, sessionContext.tenantName);
  }

  // ── POST /v1/review/variants/:id/accept ─────────────────────────────

  async acceptVariant(variantId: string, actorUserId: string | null): Promise<PhotoVariantDao> {
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
    return this.toVariantDao(variant, sessionContext.tenantName);
  }

  // ── POST /v1/review/variants/:id/discard ────────────────────────────

  async discardVariant(variantId: string, actorUserId: string | null): Promise<PhotoVariantDao> {
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
      return this.toVariantDao(variant, (await this.resolveSessionContext(set.sourceSessionId)).tenantName);
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
    return this.toVariantDao(variant, sessionContext.tenantName);
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
    if (!frontPhoto?.fsFileId) {
      throw new CustomException(
        'Reference (FRONT) photo is not available yet — cannot verify identity',
        PHOTO_REVIEW_ERROR_CODE.SOURCE_PHOTO_NOT_FOUND,
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    const referenceLink = await this.fileStorage.issueViewLink(
      frontPhoto.fsFileId,
      'photo-review-sidecar',
      sessionContext.tenantName,
    );

    let similarity: number;
    try {
      const simResult = await this.sidecar.identitySimilarity({
        referenceImageUrl: referenceLink.url,
        candidateImageBase64: file.buffer.toString('base64'),
      });
      similarity = simResult.similarity;
    } catch (error) {
      const message = error instanceof SidecarError ? error.message : (error as Error).message;
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
        sourceImageBase64: file.buffer.toString('base64'),
        cardSpec: kind.cardSpec,
        kindCode: kind.code,
      })
      .catch((error) => {
        const message = error instanceof SidecarError ? error.message : (error as Error).message;
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
      const uploaded = await this.uploadCardBytes({
        tenantName: sessionContext.tenantName,
        virtualPath,
        mimeType: cardResult.mimeType,
        data,
        idempotencyKey: `photo-review:${setId}:upload:v${version}`,
      });
      // Best-effort: also keep the original file the operator picked, next
      // to the cropped card photo (plan §3 — `upload-vN.source.jpg`).
      await this.uploadMetadataBestEffort({
        tenantName: sessionContext.tenantName,
        virtualPath: this.buildVirtualPath(set.sourceSessionId, sessionContext.year, 'upload', version, 'source.json'),
        idempotencyKey: `photo-review:${setId}:upload:v${version}:meta`,
        metadata: { identitySimilarity: similarity, originalMimeType: file.mimetype },
      });

      const created = await repo.save(
        repo.create({
          setId,
          version,
          kind: PhotoVariantKind.CARD_UPLOAD,
          status: PhotoVariantStatus.READY,
          fsFileId: uploaded.fsFileId,
          virtualPath,
          bytes: uploaded.bytes,
          sha256: uploaded.sha256,
          width: cardResult.width ?? null,
          height: cardResult.height ?? null,
          dpi: cardResult.dpi ?? null,
          identitySimilarity: similarity,
          qualityReport: cardResult.qualityReport ?? null,
          algorithmVersion: cardResult.algorithmVersion ?? null,
          createdByUserId: actorUserId,
        }),
      );

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

    const dao = await this.toVariantDao(variant, sessionContext.tenantName);
    return toDao(UploadVariantResultDao, {
      variant: dao,
      identitySimilarity: similarity,
      identityWarning: similarity < IDENTITY_SIMILARITY_WARN_THRESHOLD,
    });
  }

  // ── POST /v1/review/sets/:id/current ────────────────────────────────

  async setCurrent(setId: string, variantId: string, actorUserId: string | null): Promise<ReviewSetListItemDao> {
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

    return this.toSetListItemDao(setId);
  }

  // ── POST /v1/review/sets/:id/approve, /reject ───────────────────────

  async approve(setId: string, dto: ApproveRejectDto, actorUserId: string | null): Promise<ReviewSetListItemDao> {
    return this.transitionSetStatus(setId, PhotoReviewSetStatus.APPROVED, PhotoReviewAction.APPROVED, dto, actorUserId);
  }

  async reject(setId: string, dto: ApproveRejectDto, actorUserId: string | null): Promise<ReviewSetListItemDao> {
    return this.transitionSetStatus(setId, PhotoReviewSetStatus.REJECTED, PhotoReviewAction.REJECTED, dto, actorUserId);
  }

  private async transitionSetStatus(
    setId: string,
    status: PhotoReviewSetStatus,
    action: PhotoReviewAction,
    dto: ApproveRejectDto,
    actorUserId: string | null,
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

    return this.toSetListItemDao(setId);
  }

  /** Single-row equivalent of one `listSets` result item — used to build the response of every mutating action that returns a set (setCurrent/approve/reject), without a bogus "page 1, limit 1" query that could return the wrong set entirely. */
  private async toSetListItemDao(setId: string): Promise<ReviewSetListItemDao> {
    const rows: Array<Record<string, unknown>> = await this.dataSource.query(
      `SELECT
          s.id, s.campaign_id, s.subject_code, s.subject_name, s.kind_id, k.code AS kind_code,
          s.source_session_id, s.status, s.current_card_variant_id, s.created_at, s.updated_at,
          cv.fs_file_id AS current_fs_file_id,
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

    let currentCardViewUrl: string | undefined;
    let currentCardViewUrlExpiresAt: string | undefined;
    const fsFileId = row.current_fs_file_id as string | null;
    if (fsFileId) {
      const tenantMap = await this.batchResolveTenants([row.source_session_id as string]);
      try {
        const link = await this.fileStorage.issueViewLink(
          fsFileId,
          'photo-review',
          tenantMap.get(row.source_session_id as string),
        );
        currentCardViewUrl = link.url;
        currentCardViewUrlExpiresAt = link.expiresAt;
      } catch (error) {
        this.logger.warn(`view-link failed for set ${setId}: ${(error as Error).message}`);
      }
    }

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
   * **Not wired to any call site by this pass** — the actual trigger point
   * (kiosk session approval in `CaptureReportService.applySessionReport`,
   * or the web path's `POST /v1/sessions/:id/complete` in
   * `SessionService.completeSession`) lives in the `capture` module, which
   * this task explicitly forbids editing (owned/edited by another agent
   * concurrently). Calling this method from either of those two spots is a
   * one-line follow-up for whoever owns that module — see this module's
   * final report for the exact call shape
   * (`photoReviewService.ensureSetForApprovedSession(session.id)`).
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
   * để cán bộ tự quyết". Any other status resets to `PENDING_AUTO`,
   * locking the set until `reprocess` is called again (this pass has no
   * background worker auto-triggering that first `CARD_AUTO` — `reprocess`
   * is the one endpoint that creates it, per the task brief).
   */
  async ensureSetForApprovedSession(sessionId: string): Promise<string | null> {
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
      } else {
        // Keep the approved variant current; just record that a newer
        // session exists so a reviewer can decide (R-Q10).
        existing.sourceSessionId = sessionId;
        await this.setRepository.save(existing);
      }
      return existing.id;
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
    return created.id;
  }
}
