import { toDao } from '@app/shared/http/to-dao.helper';
import { CustomException, ERROR_CODE } from '@app/shared/errors/legacy';
import { CommonService } from '@app/shared/common/common.service';
import { Pagination } from '@app/shared/http/pagination';
import { SessionService } from '@app/modules/capture/services/session.service';
import { WorkflowCatalogReadRepository } from '@app/modules/workflow/infrastructure/read/workflow-catalog.read-repository';
import { BadRequestException, HttpStatus, Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { DataSource, Repository } from 'typeorm';
import { CampaignDao } from '../dao';
import { CreateCampaignDto, UpdateCampaignDto } from '../dto';
import { ListCampaignsQueryDto } from '../dto/list-campaigns-query.dto';
import { Campaign, CampaignPurpose } from '../entities/campaign.entity';
import { Device } from '../entities/device.entity';
import { computeEffectiveStatus } from '../utils/campaign-status.util';
import {
  computeRequiredCameraCount,
  validateCaptureAngles,
} from '../validation/capture-angles.validator';

/** Postgres unique_violation SQLSTATE — used to turn a raw duplicate-`code` insert/update failure into a clear 409. */
const UNIQUE_VIOLATION = '23505';

@Injectable()
export class CampaignService extends CommonService<Campaign> {
  constructor(
    @InjectRepository(Campaign)
    repository: Repository<Campaign>,
    @InjectRepository(Device)
    private readonly deviceRepository: Repository<Device>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly sessionService: SessionService,
    private readonly workflowCatalog: WorkflowCatalogReadRepository,
  ) {
    super(repository);
  }

  async createCampaign(dto: CreateCampaignDto): Promise<CampaignDao> {
    const simultaneousCapture = dto.simultaneousCapture ?? false;
    const captureAnglesCheck = validateCaptureAngles(dto.captureAngles);
    if (!captureAnglesCheck.ok) {
      throw new BadRequestException(captureAnglesCheck.reason);
    }

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
      });
    } catch (error) {
      throw this.mapCodeUniqueViolation(error);
    }

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

    const mergedCaptureAngles =
      dto.captureAngles !== undefined
        ? dto.captureAngles
        : campaign.captureAngles;
    const captureAnglesCheck = validateCaptureAngles(mergedCaptureAngles);
    if (!captureAnglesCheck.ok) {
      throw new BadRequestException(captureAnglesCheck.reason);
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
    return this.toCampaignResponse(campaign);
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
}
