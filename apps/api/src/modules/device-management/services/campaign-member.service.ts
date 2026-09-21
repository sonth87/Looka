import { toDao } from '@app/shared/http/to-dao.helper';
import { CustomException, ERROR_CODE } from '@app/shared/errors/legacy';
import { User } from '@app/modules/shared/entities/user.entity';
import { CommonService } from '@app/shared/common/common.service';
import { Pagination } from '@app/shared/http/pagination';
import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { CampaignMemberDao } from '../dao';
import { MeCampaignDao } from '../dao/me.dao';
import {
  CampaignMemberDecision,
  DecideCampaignMemberDto,
} from '../dto/decide-campaign-member.dto';
import { GrantCampaignMembersDto } from '../dto/grant-campaign-members.dto';
import { ListCampaignMembersQueryDto } from '../dto/list-campaign-members-query.dto';
import {
  CampaignMember,
  CampaignMemberStatus,
} from '../entities/campaign-member.entity';
import { CampaignService } from './campaign.service';

@Injectable()
export class CampaignMemberService extends CommonService<CampaignMember> {
  constructor(
    @InjectRepository(CampaignMember)
    repository: Repository<CampaignMember>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly campaignService: CampaignService,
  ) {
    super(repository);
  }

  /**
   * `CampaignMemberDao.email`/`displayName` are not `campaign_members`
   * columns — merged in from `users` here, in one batched lookup rather
   * than N+1 queries, since every DAO-returning method in this service
   * needs it. `email` falls back to a placeholder rather than throwing if
   * the user row is somehow gone (should not happen — `user_id` has a real
   * FK to `users` — but a display-layer DAO should never 500 over it).
   */
  private async attachIdentity<T extends CampaignMemberDao>(dao: T): Promise<T>;
  private async attachIdentity<T extends CampaignMemberDao>(
    dao: T[],
  ): Promise<T[]>;
  private async attachIdentity<T extends CampaignMemberDao>(
    dao: T | T[],
  ): Promise<T | T[]> {
    const list = Array.isArray(dao) ? dao : [dao];
    const userIds = [...new Set(list.map((m) => m.userId))];
    const users = userIds.length
      ? await this.userRepository.find({ where: { id: In(userIds) } })
      : [];
    const byId = new Map(users.map((u) => [u.id, u]));
    for (const m of list) {
      const user = byId.get(m.userId);
      m.email = user?.email ?? '(người dùng không còn tồn tại)';
      m.displayName = user?.displayName ?? null;
    }
    return dao;
  }

  /**
   * `POST /v1/campaigns/:id/join` — idempotent: an existing row (any
   * status, including an already-decided APPROVED/REJECTED one) is returned
   * unchanged, never reset back to PENDING. Only a genuinely first-time
   * request inserts a new PENDING row. See
   * docs/plans/campaign-config-sso-card-photo-discussion.md §3.2.2.
   */
  async joinCampaign(
    campaignId: string,
    userId: string,
  ): Promise<CampaignMemberDao> {
    await this.campaignService.findCampaignEntityOrFail(campaignId);

    const existing = await this.repository.findOne({
      where: { campaignId, userId },
    });
    if (existing) {
      return this.attachIdentity(toDao(CampaignMemberDao, existing));
    }

    const member = await this.create({
      campaignId,
      userId,
      status: 'PENDING',
      requestedAt: new Date(),
    });
    return this.attachIdentity(toDao(CampaignMemberDao, member));
  }

  async findMembership(
    campaignId: string,
    userId: string,
  ): Promise<CampaignMember | null> {
    return this.repository.findOne({ where: { campaignId, userId } });
  }

  async listMembers(
    campaignId: string,
    query: ListCampaignMembersQueryDto,
  ): Promise<Pagination<CampaignMemberDao>> {
    await this.campaignService.findCampaignEntityOrFail(campaignId);

    const page = query.page ?? 1;
    const limit = query.limit ?? 10;

    // `CommonService.paginate` forwards `searchOptions` straight into
    // `repository.find({ skip, take, ...searchOptions })` (nestjs-typeorm-
    // paginate's own `paginateRepository`) — it must be a `FindManyOptions`
    // shape (a `where` key), not a flat where-conditions object; TypeORM's
    // `find()` silently ignores unrecognized top-level keys rather than
    // erroring, so a flat `{ campaignId, status }` here would compile fine
    // but filter nothing.
    const result = await this.paginate(
      { page, limit },
      {
        where: {
          campaignId,
          ...(query.status ? { status: query.status } : {}),
        },
      },
    );

    return new Pagination(
      await this.attachIdentity(toDao(CampaignMemberDao, result.items)),
      result.meta,
    );
  }

  /**
   * `PATCH /v1/campaigns/:id/members/:userId` — `approve`/`reject`/`revoke`
   * all set `status` + `decidedAt` + `decidedByUserId`; `note` is optional
   * free text for any of the three. No state-machine restriction on which
   * prior status a decision can apply from (an admin can re-approve a
   * REJECTED row, or revoke a PENDING one outright) — the task brief does
   * not ask for one, and a stricter transition table can be added later
   * without an API shape change if CTSV feedback wants it.
   */
  async decide(
    campaignId: string,
    userId: string,
    dto: DecideCampaignMemberDto,
    decidedByUserId: string,
  ): Promise<CampaignMemberDao> {
    const member = await this.repository.findOne({
      where: { campaignId, userId },
    });
    if (!member) {
      throw new CustomException(
        'Campaign membership not found',
        ERROR_CODE.CAMPAIGN_MEMBER_NOT_FOUND,
        HttpStatus.NOT_FOUND,
      );
    }

    member.status = this.statusForDecision(dto.action);
    member.decidedAt = new Date();
    member.decidedByUserId = decidedByUserId;
    if (dto.note !== undefined) member.note = dto.note;

    await this.save(member);
    return this.attachIdentity(toDao(CampaignMemberDao, member));
  }

  /**
   * `POST /v1/campaigns/:id/members/grant` (2026-09-18) — replaces
   * `campaign_kiosk_assignments`' auto-approve side effect (deleted the
   * same day, see that migration's own doc comment): admins used to have
   * to pair a person with a specific kiosk to get the "assigning also
   * approves them" convenience (D-Q4, 2026-09-11); that pairing was never
   * actually needed for anything else (a session's own `device_id`/
   * `operator_user_id` come from the kiosk's device credentials and its
   * locally-logged-in operator, entirely independent of this table — see
   * that migration's doc comment for the full audit). This keeps the
   * one-step convenience without the device pairing: pick N people (from
   * the CMS's existing user list, `CampaignList.tsx`'s "Cấp quyền"),
   * upsert every one of them straight to APPROVED for this campaign.
   *
   * Idempotent per user — safe to call again with the same id (e.g.
   * re-submitting a partially-failed batch), same `orUpdate` upsert
   * pattern the deleted `CampaignKioskAssignmentService.assign()` used.
   * `note: 'GRANTED'` (vs. the old `'ASSIGNED'`) marks where an APPROVED
   * row with no individual `decide()` call came from.
   */
  async grant(
    campaignId: string,
    dto: GrantCampaignMembersDto,
    decidedByUserId: string,
  ): Promise<CampaignMemberDao[]> {
    await this.campaignService.findCampaignEntityOrFail(campaignId);

    // Pre-check every id exists before the bulk insert — without this, a
    // stale/mistyped id in `dto.userIds` hits `FK_campaign_members_user`
    // mid-`orUpdate()` and surfaces as an opaque 500 instead of a readable
    // 400 (plan §1.2, 2026-09-18).
    const existingUsers = await this.userRepository.find({
      where: { id: In(dto.userIds) },
      select: ['id'],
    });
    const existingIds = new Set(existingUsers.map((u) => u.id));
    const missingIds = dto.userIds.filter((id) => !existingIds.has(id));
    if (missingIds.length > 0) {
      throw new CustomException(
        `User id(s) not found: ${missingIds.join(', ')}`,
        ERROR_CODE.CAMPAIGN_MEMBER_GRANT_USER_NOT_FOUND,
        HttpStatus.BAD_REQUEST,
      );
    }

    const now = new Date();
    await this.repository
      .createQueryBuilder()
      .insert()
      .into(CampaignMember)
      .values(
        dto.userIds.map((userId) => ({
          campaignId,
          userId,
          status: 'APPROVED' as const,
          requestedAt: now,
          decidedAt: now,
          decidedByUserId,
          note: 'GRANTED',
        })),
      )
      .orUpdate(
        ['status', 'decided_at', 'decided_by_user_id', 'note'],
        ['campaign_id', 'user_id'],
      )
      .execute();

    const rows = await this.repository.find({
      where: { campaignId, userId: In(dto.userIds) },
    });
    return this.attachIdentity(toDao(CampaignMemberDao, rows));
  }

  private statusForDecision(
    action: CampaignMemberDecision,
  ): CampaignMemberStatus {
    switch (action) {
      case 'approve':
        return 'APPROVED';
      case 'reject':
        return 'REJECTED';
      case 'revoke':
        return 'REVOKED';
    }
  }

  /**
   * `GET /v1/me/campaigns` (§3.2.2): every campaign not manually `CLOSED`,
   * each with `effectiveStatus`/`quotaReached` (via
   * `CampaignService.toCampaignResponse`) and the caller's own
   * `membership.status` — `NONE` when no `campaign_members` row exists for
   * `(campaignId, userId)`, computed in JS from a single membership lookup
   * rather than a SQL left join (campaign counts are small; this keeps the
   * query shape identical to `findCampaignsNotClosed`'s own simple list).
   *
   * `isAdmin` gates a second, non-admin-only filter (assignment pivot,
   * 2026-09-14): admins keep exactly today's behavior — the full
   * not-CLOSED list, with real membership status attached (including
   * `NONE`/`PENDING`). Non-admins only ever get back campaigns where their
   * own membership row is `APPROVED` — plain JS `.filter()` right here,
   * where `campaigns` and `membershipByCampaignId` are already both in
   * scope, rather than pushing the condition into `findCampaignsNotClosed`'s
   * query or a SQL join.
   */
  async listCampaignsForUser(
    userId: string,
    isAdmin: boolean,
  ): Promise<MeCampaignDao[]> {
    const allCampaigns = await this.campaignService.findCampaignsNotClosed();
    const memberships = await this.repository.find({ where: { userId } });
    const membershipByCampaignId = new Map(
      memberships.map((m) => [m.campaignId, m.status]),
    );

    const campaigns = isAdmin
      ? allCampaigns
      : allCampaigns.filter(
          (c) => membershipByCampaignId.get(c.id) === 'APPROVED',
        );

    return Promise.all(
      campaigns.map(async (campaign) => {
        const dao = await this.campaignService.toCampaignResponse(campaign);
        const meDao = toDao(MeCampaignDao, dao);
        meDao.membership = {
          status: membershipByCampaignId.get(campaign.id) ?? 'NONE',
        };
        return meDao;
      }),
    );
  }
}
