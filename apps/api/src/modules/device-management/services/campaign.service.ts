import { toDao } from '@app/shared/http/to-dao.helper';
import { CustomException, ERROR_CODE } from '@app/shared/errors/legacy';
import { CommonService } from '@app/shared/common/common.service';
import { Pagination } from '@app/shared/http/pagination';
import { SessionService } from '@app/modules/capture/services/session.service';
import { FileStorageService } from '@app/modules/file-storage/services/file-storage.service';
import { WorkflowCatalogReadRepository } from '@app/modules/workflow/infrastructure/read/workflow-catalog.read-repository';
import {
  BadRequestException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import archiver from 'archiver';
import { randomUUID } from 'node:crypto';
import { PassThrough } from 'node:stream';
import { DataSource, Repository } from 'typeorm';
import { CampaignDao } from '../dao';
import { CreateCampaignDto, UpdateCampaignDto } from '../dto';
import { ListCampaignsQueryDto } from '../dto/list-campaigns-query.dto';
import { Campaign, CampaignPurpose } from '../entities/campaign.entity';
import { Device } from '../entities/device.entity';
import {
  reconcileEligibilityCredential,
  sanitizeEligibilityCredential,
} from '../domain/campaign-eligibility-credential.util';
import {
  DEFAULT_ELIGIBILITY_CONFIG,
  validateEligibilityConfigShape,
} from '../domain/eligibility-config.schema';
import type { EligibilityMode } from '../domain/eligibility-config.schema';
import { computeEffectiveStatus } from '../utils/campaign-status.util';
import {
  computeRequiredCameraCount,
  validateCaptureAngles,
} from '../validation/capture-angles.validator';
import { AdvisoryLockService } from '@app/shared/database/advisory-lock.service';

/** Postgres unique_violation SQLSTATE — used to turn a raw duplicate-`code` insert/update failure into a clear 409. */
const UNIQUE_VIOLATION = '23505';

@Injectable()
export class CampaignService extends CommonService<Campaign> {
  private readonly logger = new Logger(CampaignService.name);

  constructor(
    @InjectRepository(Campaign)
    repository: Repository<Campaign>,
    @InjectRepository(Device)
    private readonly deviceRepository: Repository<Device>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly sessionService: SessionService,
    private readonly workflowCatalog: WorkflowCatalogReadRepository,
    private readonly fileStorage: FileStorageService,
    private readonly advisoryLock: AdvisoryLockService,
  ) {
    super(repository);
  }

  async createCampaign(dto: CreateCampaignDto): Promise<CampaignDao> {
    const simultaneousCapture = dto.simultaneousCapture ?? false;
    const captureAnglesCheck = validateCaptureAngles(dto.captureAngles);
    if (!captureAnglesCheck.ok) {
      throw new BadRequestException(captureAnglesCheck.reason);
    }

    const eligibilityCheck = validateEligibilityConfigShape(
      dto.eligibilityConfig ?? DEFAULT_ELIGIBILITY_CONFIG,
    );
    if (!eligibilityCheck.valid) {
      throw new BadRequestException(eligibilityCheck.errors.join('; '));
    }
    // No previous config to preserve a credential from — brand new campaign.
    const eligibilityConfig = reconcileEligibilityCredential(
      dto.eligibilityConfig ?? DEFAULT_ELIGIBILITY_CONFIG,
      null,
    );

    const workflowId = await this.resolveWorkflowId(dto.workflowVersionId);

    let campaign: Campaign;
    try {
      campaign = await this.create({
        name: dto.name,
        description: dto.description,
        purpose: dto.purpose ?? CampaignPurpose.STUDENT_CARD,
        // See CreateCampaignDto.code's own doc comment for why an omitted
        // code falls back to a generated one instead of a 400.
        code: dto.code ?? this.generateFallbackCode(),
        cohort: dto.cohort ?? null,
        startsAt: dto.startsAt ? new Date(dto.startsAt) : null,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
        quotaPlanned: dto.quotaPlanned ?? null,
        manualStatus: dto.manualStatus ?? null,
        recordVideoRoles: dto.recordVideoRoles ?? null,
        cardSpec: dto.cardSpec ?? null,
        // A campaign created with consent text already set starts at version 1,
        // not 0 — 0 is reserved for "never configured, using the built-in
        // generic default" (see the entity's own doc comment).
        consentContent: dto.consentContent ?? null,
        consentVersion: dto.consentContent ? 1 : 0,
        captureAngles: dto.captureAngles ?? null,
        captureMode: dto.captureMode ?? null,
        autoHoldMs: dto.autoHoldMs ?? null,
        simultaneousCapture,
        recordVideo: dto.recordVideo ?? false,
        requiresEmbedding: dto.requiresEmbedding ?? true,
        workflowId,
        workflowVersionId: dto.workflowVersionId ?? null,
        processingSlaHours: dto.processingSlaHours ?? null,
        location: dto.location ?? null,
        eligibilityConfig,
      });
    } catch (error) {
      throw this.mapCodeUniqueViolation(error);
    }

    // Fire-and-forget: never lets a slow/failed auto-pull enqueue affect
    // the create response — see `maybeEnqueuePull`'s own doc comment.
    void this.maybeEnqueuePull(campaign, 'NONE').catch((err) =>
      this.logger.warn(
        `auto-enqueue subject pull failed for new campaign ${campaign.id}: ${(err as Error).message}`,
      ),
    );

    return this.toCampaignResponse(campaign);
  }

  /** Resolves+validates a `workflowVersionId` — throws 400 if it does not exist or is not (yet) published. Returns `null` for `undefined`/no pin. */
  private async resolveWorkflowId(
    versionId: string | null | undefined,
  ): Promise<string | null> {
    if (!versionId) return null;
    const ref = await this.workflowCatalog.getVersionRef(versionId);
    if (!ref) {
      throw new BadRequestException(
        `workflowVersionId "${versionId}" không tồn tại hoặc chưa publish.`,
      );
    }
    return ref.workflowId;
  }

  async findAllCampaigns(): Promise<CampaignDao[]> {
    const campaigns = await this.findAll({ order: { createdAt: 'DESC' } });
    return Promise.all(campaigns.map((c) => this.toCampaignResponse(c)));
  }

  /**
   * Every campaign not manually `CLOSED` — the "campaign picker" list for
   * `GET /v1/me/campaigns` (§3.2.2). `manual_status IS DISTINCT FROM
   * 'CLOSED'` also matches NULL (dates decide), which a plain `!=` would
   * silently exclude in SQL's three-valued logic.
   */
  async findCampaignsNotClosed(): Promise<Campaign[]> {
    return this.repository
      .createQueryBuilder('campaign')
      .where("campaign.manual_status IS DISTINCT FROM 'CLOSED'")
      .orderBy('campaign.created_at', 'DESC')
      .getMany();
  }

  /**
   * `toDao(CampaignDao, campaign)` plus the three derived, never-stored
   * fields (§3.1.2/§3.1.1): `effectiveStatus`, `quotaReached`
   * (approved/completed session count vs `quotaPlanned` — a warning only,
   * never a hard block, per Q6), and `requiredCameraCount` (a non-blocking
   * hint from `captureAngles`). Every read path that returns a `CampaignDao`
   * to a *new* caller (list/get/create/update/`GET /v1/me/campaigns`) goes
   * through this — the one exception is `DeviceSelfController.getMyConfig`
   * (the old, unmodified `GET /v1/devices/config` kiosk path), which still
   * calls `toDao(CampaignDao, campaign)` directly and so never populates
   * these three fields; that is deliberate, not an oversight — see this
   * module's task brief on why that path is untouched this pass.
   */
  async toCampaignResponse(campaign: Campaign): Promise<CampaignDao> {
    const dao = toDao(CampaignDao, campaign);
    const completedSessions = await this.countCompletedSessions(campaign.id);
    dao.effectiveStatus = computeEffectiveStatus(campaign);
    dao.quotaReached =
      campaign.quotaPlanned != null &&
      completedSessions >= campaign.quotaPlanned;
    dao.eligibilityConfig = sanitizeEligibilityCredential(
      campaign.eligibilityConfig,
    );

    // cms-8-screens-api-plan.md §2.2/P2 — "gộp config cho … campaigns/:id/config".
    // When a workflow is pinned, its config fills in `captureAngles`/
    // `cardSpec` ONLY where the campaign's own columns are still null
    // (override semantics: an explicit campaign-level value always wins).
    // `requiredCameraCount` is computed AFTER this merge so a campaign
    // that only sets angles via its workflow still gets a real hint
    // instead of the "no angles" default.
    let effectiveCaptureAngles = campaign.captureAngles;
    if (campaign.workflowVersionId) {
      const ref = await this.workflowCatalog.getVersionRef(
        campaign.workflowVersionId,
      );
      if (ref) {
        dao.workflow = {
          id: ref.workflowId,
          code: ref.workflowCode,
          versionId: campaign.workflowVersionId,
          version: ref.version,
        };
        if (!campaign.captureAngles) {
          effectiveCaptureAngles = ref.config.capture
            .angles as unknown as Campaign['captureAngles'];
          dao.captureAngles = effectiveCaptureAngles;
        }
        if (!campaign.cardSpec) {
          dao.cardSpec = ref.config.output.cardSpec;
        }
      }
    }

    dao.requiredCameraCount = computeRequiredCameraCount(
      effectiveCaptureAngles,
    );
    return dao;
  }

  /**
   * "Approved-session count" for `quotaReached` — a plain `COUNT` against
   * `sessions` (status `COMPLETED`, i.e. approved), same raw-SQL-against-
   * `sessions` pattern `DeviceEventService.campaignStats` already uses in
   * this module. Deliberately not a call into `SessionService` (capture
   * module, out of scope for this pass) — `sessions.campaign_id` is a plain
   * column any module can read, and `sessions` is nullable-FK'd, not owned
   * exclusively by capture's own service layer.
   */
  private async countCompletedSessions(campaignId: string): Promise<number> {
    const rows: Array<{ count: number }> = await this.dataSource.query(
      `SELECT COUNT(*)::int AS count FROM sessions WHERE campaign_id = $1 AND status = 'COMPLETED'`,
      [campaignId],
    );
    return rows[0]?.count ?? 0;
  }

  /** `CMP-<8 hex chars>` — always fits the 20-char column, always regex-valid. See `CreateCampaignDto.code`'s own doc comment for why this exists. */
  private generateFallbackCode(): string {
    return `CMP-${randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()}`;
  }

  /** Turns a raw Postgres unique_violation on `campaigns.code` into a clear 409 instead of a raw DB error leaking to the client. */
  private mapCodeUniqueViolation(error: unknown): unknown {
    const dbError = error as { code?: string; constraint?: string } | undefined;
    if (dbError?.code === UNIQUE_VIOLATION) {
      return new CustomException(
        'Campaign code already in use',
        ERROR_CODE.CAMPAIGN_CODE_TAKEN,
        HttpStatus.CONFLICT,
      );
    }
    return error;
  }

  async findCampaignEntityOrFail(id: string): Promise<Campaign> {
    const campaign = await this.findById(id);
    if (!campaign) {
      throw new CustomException(
        'Campaign not found',
        ERROR_CODE.CAMPAIGN_NOT_FOUND,
        HttpStatus.NOT_FOUND,
      );
    }
    return campaign;
  }

  async findCampaignOrFail(id: string): Promise<CampaignDao> {
    return this.toCampaignResponse(await this.findCampaignEntityOrFail(id));
  }

  /**
   * Extend/renew, edit consent, or change capture config — all campaign-level
   * settings, so this affects every device registered under the campaign at
   * once (see docs/plans/multi-camera-device-management-discussion.md §3.2's
   * "gia hạn 1 campaign tự động gia hạn mọi thiết bị" decision — there is
   * nothing to update per-device, since none of these fields live there).
   */
  async updateCampaign(
    id: string,
    dto: UpdateCampaignDto,
  ): Promise<CampaignDao> {
    const campaign = await this.findCampaignEntityOrFail(id);
    const previousMode: EligibilityMode =
      campaign.eligibilityConfig?.mode ?? 'NONE';

    const mergedCaptureAngles =
      dto.captureAngles !== undefined
        ? dto.captureAngles
        : campaign.captureAngles;
    const captureAnglesCheck = validateCaptureAngles(mergedCaptureAngles);
    if (!captureAnglesCheck.ok) {
      throw new BadRequestException(captureAnglesCheck.reason);
    }

    if (dto.eligibilityConfig !== undefined) {
      const eligibilityCheck = validateEligibilityConfigShape(
        dto.eligibilityConfig,
      );
      if (!eligibilityCheck.valid) {
        throw new BadRequestException(eligibilityCheck.errors.join('; '));
      }
      // Preserves the campaign's already-stored credential when this save
      // doesn't touch it — see `reconcileEligibilityCredential`'s own doc
      // comment for why that's needed (GET never echoes the ciphertext back).
      campaign.eligibilityConfig = reconcileEligibilityCredential(
        dto.eligibilityConfig,
        campaign.eligibilityConfig,
      );
    }

    if (dto.name !== undefined) campaign.name = dto.name;
    if (dto.description !== undefined) campaign.description = dto.description;
    if (dto.code !== undefined) campaign.code = dto.code;
    if (dto.cohort !== undefined) campaign.cohort = dto.cohort;
    if (dto.startsAt !== undefined) {
      campaign.startsAt = dto.startsAt === null ? null : new Date(dto.startsAt);
    }
    if (dto.expiresAt !== undefined) {
      campaign.expiresAt =
        dto.expiresAt === null ? null : new Date(dto.expiresAt);
    }
    if (dto.quotaPlanned !== undefined)
      campaign.quotaPlanned = dto.quotaPlanned;
    if (dto.manualStatus !== undefined)
      campaign.manualStatus = dto.manualStatus;
    if (dto.recordVideoRoles !== undefined) {
      campaign.recordVideoRoles = dto.recordVideoRoles;
    }
    if (dto.cardSpec !== undefined) {
      campaign.cardSpec = dto.cardSpec;
    }
    if (dto.captureAngles !== undefined) {
      campaign.captureAngles =
        dto.captureAngles as unknown as Campaign['captureAngles'];
    }
    if (dto.captureMode !== undefined) campaign.captureMode = dto.captureMode;
    if (dto.autoHoldMs !== undefined) campaign.autoHoldMs = dto.autoHoldMs;
    if (dto.simultaneousCapture !== undefined) {
      campaign.simultaneousCapture = dto.simultaneousCapture;
    }
    if (dto.recordVideo !== undefined) {
      campaign.recordVideo = dto.recordVideo;
    }
    if (dto.requiresEmbedding !== undefined) {
      campaign.requiresEmbedding = dto.requiresEmbedding;
    }
    if (dto.workflowVersionId !== undefined) {
      if (dto.workflowVersionId === null) {
        campaign.workflowId = null;
        campaign.workflowVersionId = null;
      } else {
        campaign.workflowId = await this.resolveWorkflowId(
          dto.workflowVersionId,
        );
        campaign.workflowVersionId = dto.workflowVersionId;
      }
    }
    if (dto.processingSlaHours !== undefined) {
      campaign.processingSlaHours = dto.processingSlaHours;
    }
    if (dto.location !== undefined) campaign.location = dto.location;

    // Bump only on an actual change — a no-op PATCH (or one that only
    // touches other fields) must not invalidate every device's already-shown
    // consent version for nothing.
    if (
      dto.consentContent !== undefined &&
      dto.consentContent !== campaign.consentContent
    ) {
      campaign.consentContent = dto.consentContent;
      campaign.consentVersion += 1;
    }

    try {
      await this.save(campaign);
    } catch (error) {
      throw this.mapCodeUniqueViolation(error);
    }

    void this.maybeEnqueuePull(campaign, previousMode).catch((err) =>
      this.logger.warn(
        `auto-enqueue subject pull failed for campaign ${campaign.id}: ${(err as Error).message}`,
      ),
    );

    return this.toCampaignResponse(campaign);
  }

  /**
   * Auto-enqueues a subject pull when a save transitions a campaign's
   * `eligibilityConfig.mode` INTO `EXTERNAL_API`/`ROSTER_AND_API`
   * (13-features-and-2-blockers-plan-2026-09-18.md §3.1's own "Tự động kéo
   * khi TẠO campaign"). Only inserts the `campaign_subject_imports` row at
   * `PENDING_FETCH` — `CampaignSubjectPullFetchWorker` picks it up on its
   * own next tick, same as a manual `POST .../subjects/pulls`; this method
   * itself does no HTTP call and is never awaited by its callers (both
   * `createCampaign`/`updateCampaign` fire it with `void … .catch(...)`),
   * so a failure here can never surface as a failed campaign save.
   *
   * For `updateCampaign`, ALSO requires the campaign to have no `VALID`
   * roster row yet — a campaign with real existing data should not get an
   * unrelated background pull silently started by an unrelated field edit;
   * a human who wants a fresh pull on an already-populated campaign uses
   * the explicit route (optionally with `force: true`).
   * `createCampaign` always passes `previousMode: 'NONE'`, so a brand new
   * `EXTERNAL_API`/`ROSTER_AND_API` campaign always qualifies (it can't
   * have any roster rows yet either way).
   */
  private async maybeEnqueuePull(
    campaign: Campaign,
    previousMode: EligibilityMode,
  ): Promise<void> {
    const mode = campaign.eligibilityConfig?.mode ?? 'NONE';
    const becameEligible =
      (mode === 'EXTERNAL_API' || mode === 'ROSTER_AND_API') &&
      previousMode !== 'EXTERNAL_API' &&
      previousMode !== 'ROSTER_AND_API';
    if (!becameEligible || !campaign.eligibilityConfig?.api) return;

    // Same advisory-lock key `CampaignSubjectService.requestPull` uses
    // (helper duplicated there, see its own doc comment) — without it, this
    // fire-and-forget auto-enqueue can race a manual `POST
    // .../subjects/pulls` fired right after this same create/update (both
    // read zero VALID rows, both insert their own PENDING_FETCH row for the
    // same campaign). If the lock is already held, a pull is already being
    // set up for this campaign, so this auto-enqueue simply no-ops instead
    // of inserting a second one.
    await this.advisoryLock.withLock(
      `campaign-subject-pull:${campaign.id}`,
      async () => {
        const [{ count }] = await this.dataSource.query<
          Array<{ count: number }>
        >(
          `SELECT COUNT(*)::int AS count FROM campaign_subjects WHERE campaign_id = $1 AND status = 'VALID'`,
          [campaign.id],
        );
        if (count > 0) return;

        await this.dataSource.query(
          `INSERT INTO campaign_subject_imports (campaign_id, source, file_name, status)
           VALUES ($1, 'EXTERNAL_API', $2, 'PENDING_FETCH')`,
          [campaign.id, `external-api-${new Date().toISOString()}.json`],
        );
      },
    );
  }

  /**
   * Hard-deletes a campaign row — refused with a 409 when the campaign
   * still has devices or capture sessions attached (see docs/ROADMAP.md's
   * 2026-09-07 entry for the full write-up):
   *
   * - `devices.campaign_id` was `ON DELETE CASCADE` (device.entity.ts);
   *   **2026-09-08**: changed to `ON DELETE SET NULL` as part of making the
   *   column nullable for self-enroll (§3.3) — a campaign delete detaching a
   *   self-enrolled device that "isn't really that campaign's" is fine, but
   *   this guard still refuses the delete outright while ANY device (self-
   *   enrolled or admin-registered) still references the campaign, so an
   *   admin remains in control of when devices are actually detached rather
   *   than it happening as a surprise side effect of deleting the campaign.
   * - `sessions.campaign_id`/`device_id` are `ON DELETE SET NULL`
   *   (migration `CaptureRecords1787900000000`) — capture history survives
   *   a delete, but becomes permanently unattributable to any campaign,
   *   which is still a surprising silent side effect for an admin who only
   *   meant to remove an unused campaign row.
   *
   * Both are surprising enough to refuse rather than cascade through: an
   * admin must remove every device under a campaign (there is currently no
   * device-delete endpoint, so in practice this only ever succeeds for a
   * campaign that was created but never used to register a kiosk) before
   * the campaign itself can be deleted.
   */
  async deleteCampaign(id: string): Promise<void> {
    await this.findCampaignEntityOrFail(id);

    const [deviceCount, sessionCount] = await Promise.all([
      this.deviceRepository.count({ where: { campaignId: id } }),
      this.sessionService.countByCampaign(id),
    ]);

    if (deviceCount > 0 || sessionCount > 0) {
      throw new CustomException(
        `Cannot delete campaign: it still has ${deviceCount} device(s) and ${sessionCount} session(s) attached. Remove its devices first.`,
        ERROR_CODE.CAMPAIGN_HAS_DEPENDENCIES,
        HttpStatus.CONFLICT,
      );
    }

    await this.delete(id);
  }

  /**
   * `GET /v1/campaigns?page&limit&status&workflowId&from&to&q` —
   * cms-8-screens-api-plan.md §2.3/P3. Only reached when the caller
   * actually supplies `page` (see `ListCampaignsQueryDto`'s own doc comment
   * for the §9.1 rule 6 backward-compat reasoning) — `findAllCampaigns()`
   * above stays the legacy, unfiltered, unpaginated path.
   *
   * `status` filters on `effectiveStatus`, which is derived, never stored —
   * replicated here as a SQL `CASE` mirroring `computeEffectiveStatus()`
   * exactly, so the two can never silently disagree. `from`/`to` filter on
   * the campaign's own active window (`startsAt`/`expiresAt`), matching the
   * screen's "thời gian diễn ra – kết thúc" wording — a campaign whose
   * window merely overlaps `[from, to]` matches, not one that starts and
   * ends fully inside it.
   */
  async listCampaignsPaginated(
    query: ListCampaignsQueryDto,
  ): Promise<Pagination<CampaignDao>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;

    const effectiveStatusExpr = `(
      CASE
        WHEN c.manual_status IN ('PAUSED', 'CLOSED') THEN c.manual_status
        WHEN c.starts_at IS NOT NULL AND now() < c.starts_at THEN 'UPCOMING'
        WHEN c.expires_at IS NOT NULL AND now() >= c.expires_at THEN 'EXPIRED'
        ELSE 'OPEN'
      END
    )`;

    const qb = this.repository.createQueryBuilder('c');
    if (query.workflowId) {
      qb.andWhere('c.workflow_id = :workflowId', {
        workflowId: query.workflowId,
      });
    }
    if (query.q) {
      qb.andWhere('(c.name ILIKE :q OR c.code ILIKE :q)', {
        q: `%${query.q}%`,
      });
    }
    if (query.status) {
      qb.andWhere(`${effectiveStatusExpr} = :status`, { status: query.status });
    }
    if (query.from) {
      qb.andWhere('(c.expires_at IS NULL OR c.expires_at >= :from)', {
        from: new Date(query.from),
      });
    }
    if (query.to) {
      qb.andWhere('(c.starts_at IS NULL OR c.starts_at <= :to)', {
        to: new Date(query.to),
      });
    }
    qb.orderBy('c.created_at', 'DESC');

    const result = await this.paginateQueryBuilder(qb, { page, limit });
    const campaignIds = result.items.map((c) => c.id);
    const [capturedByCampaign, approvedByCampaign, validSubjectsByCampaign] =
      await Promise.all([
        this.bulkCapturedCounts(campaignIds),
        this.bulkApprovedSetCounts(campaignIds),
        this.bulkValidSubjectCounts(campaignIds),
      ]);

    const items = await Promise.all(
      result.items.map(async (campaign) => {
        const dao = await this.toCampaignResponse(campaign);
        dao.workflowName = dao.workflow?.code ?? null;

        const captured = capturedByCampaign.get(campaign.id) ?? 0;
        const approved = approvedByCampaign.get(campaign.id) ?? 0;
        const quota =
          campaign.quotaPlanned ??
          validSubjectsByCampaign.get(campaign.id) ??
          null;
        dao.progress = {
          captured,
          approved,
          quota,
          percent: quota ? Math.round((captured / quota) * 100) : null,
        };
        return dao;
      }),
    );

    return new Pagination(items, result.meta);
  }

  private async bulkCapturedCounts(
    campaignIds: string[],
  ): Promise<Map<string, number>> {
    if (campaignIds.length === 0) return new Map();
    const rows: Array<{ campaign_id: string; count: number }> =
      await this.dataSource.query(
        `SELECT campaign_id, COUNT(DISTINCT COALESCE(subject_code, id::text))::int AS count
           FROM sessions
          WHERE campaign_id = ANY($1) AND status = 'COMPLETED'
          GROUP BY campaign_id`,
        [campaignIds],
      );
    return new Map(rows.map((r) => [r.campaign_id, r.count]));
  }

  /** `subject_photo_sets` is photo-review's table — a plain column any module can read, same convention `countCompletedSessions` above already relies on for `sessions`. */
  private async bulkApprovedSetCounts(
    campaignIds: string[],
  ): Promise<Map<string, number>> {
    if (campaignIds.length === 0) return new Map();
    const rows: Array<{ campaign_id: string; count: number }> =
      await this.dataSource.query(
        `SELECT campaign_id, COUNT(*)::int AS count
           FROM subject_photo_sets
          WHERE campaign_id = ANY($1) AND status = 'APPROVED'
          GROUP BY campaign_id`,
        [campaignIds],
      );
    return new Map(rows.map((r) => [r.campaign_id, r.count]));
  }

  /** Fallback `quota` when `quotaPlanned` is unset — "số dòng roster hợp lệ" (§2.1). */
  private async bulkValidSubjectCounts(
    campaignIds: string[],
  ): Promise<Map<string, number>> {
    if (campaignIds.length === 0) return new Map();
    const rows: Array<{ campaign_id: string; count: number }> =
      await this.dataSource.query(
        `SELECT campaign_id, COUNT(*)::int AS count
           FROM campaign_subjects
          WHERE campaign_id = ANY($1) AND status = 'VALID'
          GROUP BY campaign_id`,
        [campaignIds],
      );
    return new Map(rows.map((r) => [r.campaign_id, r.count]));
  }

  /**
   * `GET /v1/campaigns/:id/export-approved-photos` — Phase F.4 of
   * docs/plans/card-photo-export-and-filters-plan-2026-09-17.md. Builds a
   * zip with the full roster (`campaign_subjects`, every row regardless of
   * status — a roster list, not a photo list), a CSV of only the
   * `subject_photo_sets` rows that are `APPROVED` for this campaign, and one
   * `${subjectCode}.jpg` per approved set (bytes fetched via
   * `current_card_variant_id` → `photo_variants.fs_file_id` → file-storage).
   *
   * `subject_photo_sets`/`photo_variants`/`photo_review_events` belong to
   * the `photo-review` module — read here via raw SQL against their plain
   * table names, same cross-module-read convention `bulkApprovedSetCounts`
   * above already uses for `subject_photo_sets` (that module deliberately
   * has no structural dependency back onto this one, see that module's own
   * top comment).
   *
   * `approvedAt` has no dedicated column on `subject_photo_sets` — it is
   * read off the most recent `photo_review_events` row with
   * `action = 'APPROVED'` for that set (a set can be approved more than
   * once across its history, e.g. re-approved after a reject), which is a
   * more accurate signal than `subject_photo_sets.updated_at` (that column
   * can move for unrelated reasons, e.g. `SET_CURRENT`).
   *
   * Same `archiver` + `PassThrough` zip-building shape as
   * `PrintPackageService.buildPackage` (built fresh on every call, not
   * cached, for the same "an approval can happen after the zip was last
   * downloaded" reason).
   */
  async exportApprovedPhotos(
    id: string,
  ): Promise<{ zip: Buffer; filename: string }> {
    const campaign = await this.findCampaignEntityOrFail(id);

    const rosterRows: Array<{
      subject_code: string;
      full_name: string;
      citizen_id: string | null;
      class_name: string | null;
      faculty: string | null;
      major: string | null;
      status: string;
    }> = await this.dataSource.query(
      `SELECT subject_code, full_name, citizen_id, class_name, faculty, major, status
         FROM campaign_subjects
        WHERE campaign_id = $1
        ORDER BY subject_code ASC`,
      [id],
    );

    const approvedRows: Array<{
      subject_code: string;
      full_name: string | null;
      class_name: string | null;
      faculty: string | null;
      approved_at: Date | null;
      fs_file_id: string | null;
    }> = await this.dataSource.query(
      `SELECT s.subject_code, s.subject_name AS full_name, s.class_name, s.faculty,
              ev.approved_at, pv.fs_file_id
         FROM subject_photo_sets s
         LEFT JOIN photo_variants pv ON pv.id = s.current_card_variant_id
         LEFT JOIN LATERAL (
           SELECT MAX(e.at) AS approved_at
             FROM photo_review_events e
            WHERE e.set_id = s.id AND e.action = 'APPROVED'
         ) ev ON true
        WHERE s.campaign_id = $1 AND s.status = 'APPROVED'
        ORDER BY s.subject_code ASC`,
      [id],
    );

    const archive = archiver('zip', { zlib: { level: 9 } });
    const output = new PassThrough();
    const chunks: Buffer[] = [];
    output.on('data', (chunk: Buffer) => chunks.push(chunk));
    const done = new Promise<Buffer>((resolve, reject) => {
      output.on('end', () => resolve(Buffer.concat(chunks)));
      archive.on('error', reject);
    });
    archive.pipe(output);

    const csvField = (value: string) => `"${value.replace(/"/g, '""')}"`;

    const rosterLines = [
      'subjectCode,fullName,citizenId,className,faculty,major,status',
    ];
    for (const r of rosterRows) {
      rosterLines.push(
        [
          csvField(r.subject_code),
          csvField(r.full_name ?? ''),
          csvField(r.citizen_id ?? ''),
          csvField(r.class_name ?? ''),
          csvField(r.faculty ?? ''),
          csvField(r.major ?? ''),
          r.status,
        ].join(','),
      );
    }
    archive.append(rosterLines.join('\n'), {
      name: 'danh-sach-sinh-vien.csv',
    });

    const approvedLines = [
      'subjectCode,fullName,className,faculty,approvedAt,fileName',
    ];
    for (const r of approvedRows) {
      const fileName = `${r.subject_code}.jpg`;
      approvedLines.push(
        [
          csvField(r.subject_code),
          csvField(r.full_name ?? ''),
          csvField(r.class_name ?? ''),
          csvField(r.faculty ?? ''),
          r.approved_at ? new Date(r.approved_at).toISOString() : '',
          csvField(fileName),
        ].join(','),
      );

      if (r.fs_file_id) {
        await this.appendApprovedPhoto(archive, r.fs_file_id, fileName);
      }
    }
    archive.append(approvedLines.join('\n'), {
      name: 'danh-sach-anh-da-duyet.csv',
    });

    await archive.finalize();
    const zip = await done;
    return { zip, filename: `campaign-${campaign.code}-approved-photos.zip` };
  }

  /** Same fetch-by-`fsFileId`-and-append pattern as `PrintPackageService.appendSide` — logs and skips on failure rather than failing the whole export for one missing/unreachable file. */
  private async appendApprovedPhoto(
    archive: archiver.Archiver,
    fsFileId: string,
    fileName: string,
  ): Promise<void> {
    try {
      const link = await this.fileStorage.issueViewLink(
        fsFileId,
        'campaign-export',
      );
      const response = await fetch(link.url);
      if (!response.ok) {
        this.logger.warn(
          `export-approved-photos download failed for ${fileName}: HTTP ${response.status}`,
        );
        return;
      }
      const buf = Buffer.from(await response.arrayBuffer());
      archive.append(buf, { name: fileName });
    } catch (error) {
      this.logger.warn(
        `export-approved-photos download failed for ${fileName}: ${(error as Error).message}`,
      );
    }
  }
}
