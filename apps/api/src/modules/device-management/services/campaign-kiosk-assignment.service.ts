import { toDao } from '@app/shared/http/to-dao.helper';
import { CustomException, ERROR_CODE } from '@app/shared/errors/legacy';
import { User } from '@app/modules/shared/entities/user.entity';
import { CommonService } from '@app/shared/common/common.service';
import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { CampaignKioskAssignmentDao, CampaignKioskSummaryDao } from '../dao';
import { AssignCampaignKioskDto } from '../dto/assign-campaign-kiosk.dto';
import { CampaignKioskAssignment } from '../entities/campaign-kiosk-assignment.entity';
import { CampaignMember } from '../entities/campaign-member.entity';
import { Device } from '../entities/device.entity';
import { CampaignService } from './campaign.service';

const UNIQUE_VIOLATION = '23505';

/**
 * "1 người ↔ 1 kiosk" per campaign — cms-8-screens-api-plan.md §2.3/D-Q4.
 * Injects `Repository<CampaignMember>` directly (not `CampaignMemberService`)
 * to auto-approve membership on assign, and `CampaignMemberService` reads
 * `Repository<CampaignKioskAssignment>` directly right back for
 * `GET /v1/me/campaigns`'s `assignedDevices[]` — two repositories, not two
 * services depending on each other, to avoid a circular DI cycle between
 * them (both entities already live in this same module, so there is no
 * cross-module boundary being crossed either way).
 */
@Injectable()
export class CampaignKioskAssignmentService extends CommonService<CampaignKioskAssignment> {
  constructor(
    @InjectRepository(CampaignKioskAssignment)
    repository: Repository<CampaignKioskAssignment>,
    @InjectRepository(Device)
    private readonly deviceRepository: Repository<Device>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(CampaignMember)
    private readonly campaignMemberRepository: Repository<CampaignMember>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly campaignService: CampaignService,
  ) {
    super(repository);
  }

  private async attachIdentity(
    dao: CampaignKioskAssignmentDao[],
  ): Promise<CampaignKioskAssignmentDao[]> {
    const deviceIds = [...new Set(dao.map((d) => d.deviceId))];
    const userIds = [...new Set(dao.map((d) => d.userId))];
    const [devices, users] = await Promise.all([
      deviceIds.length
        ? this.deviceRepository.find({ where: { id: In(deviceIds) } })
        : [],
      userIds.length
        ? this.userRepository.find({ where: { id: In(userIds) } })
        : [],
    ]);
    const deviceById = new Map(devices.map((d) => [d.id, d]));
    const userById = new Map(users.map((u) => [u.id, u]));
    for (const row of dao) {
      row.deviceName = deviceById.get(row.deviceId)?.name;
      const user = userById.get(row.userId);
      row.userEmail = user?.email;
      row.userDisplayName = user?.displayName ?? null;
    }
    return dao;
  }

  async listAssignments(
    campaignId: string,
  ): Promise<CampaignKioskAssignmentDao[]> {
    await this.campaignService.findCampaignEntityOrFail(campaignId);
    const rows = await this.findAll({
      where: { campaignId },
      order: { assignedAt: 'DESC' },
    });
    return this.attachIdentity(toDao(CampaignKioskAssignmentDao, rows));
  }

  /**
   * `PUT /v1/campaigns/:id/assignments/:deviceId` — idempotent, "thay
   * người": upserts by `(campaignId, deviceId)`. If `dto.userId` is already
   * assigned to a DIFFERENT kiosk in this same campaign, the
   * `UQ_campaign_kiosk_assignments_campaign_user` constraint rejects it —
   * translated to a clear 409 rather than a raw Postgres error, same
   * `mapCodeUniqueViolation` pattern `CampaignService` uses for
   * `campaigns.code`.
   */
  async assign(
    campaignId: string,
    deviceId: string,
    dto: AssignCampaignKioskDto,
    assignedByUserId: string | null,
  ): Promise<CampaignKioskAssignmentDao> {
    await this.campaignService.findCampaignEntityOrFail(campaignId);
    const device = await this.deviceRepository.findOne({
      where: { id: deviceId, campaignId },
    });
    if (!device) {
      throw new CustomException(
        'Device not found in this campaign',
        ERROR_CODE.DEVICE_NOT_FOUND,
        HttpStatus.NOT_FOUND,
      );
    }

    const existing = await this.repository.findOne({
      where: { campaignId, deviceId },
    });

    try {
      let row: CampaignKioskAssignment;
      if (existing) {
        existing.userId = dto.userId;
        existing.note = dto.note ?? existing.note;
        existing.assignedByUserId = assignedByUserId;
        existing.assignedAt = new Date();
        row = await this.save(existing);
      } else {
        row = await this.create({
          campaignId,
          deviceId,
          userId: dto.userId,
          note: dto.note ?? null,
          assignedByUserId,
          assignedAt: new Date(),
        });
      }

      // D-Q4: "gán = tự duyệt" — an assignment always leaves the assignee
      // APPROVED for this campaign, whatever their prior membership state
      // was (mirrors `CampaignMemberService.decide`'s own "no state-machine
      // restriction" reasoning). `note = 'ASSIGNED'` so the CMS can show
      // where an APPROVED row without a manual decision came from (§9.2).
      await this.campaignMemberRepository
        .createQueryBuilder()
        .insert()
        .values({
          campaignId,
          userId: dto.userId,
          status: 'APPROVED',
          requestedAt: new Date(),
          decidedAt: new Date(),
          decidedByUserId: assignedByUserId,
          note: 'ASSIGNED',
        })
        .orUpdate(
          ['status', 'decided_at', 'decided_by_user_id', 'note'],
          ['campaign_id', 'user_id'],
        )
        .execute();

      return (
        await this.attachIdentity([toDao(CampaignKioskAssignmentDao, row)])
      )[0];
    } catch (error) {
      const dbError = error as { code?: string } | undefined;
      if (dbError?.code === UNIQUE_VIOLATION) {
        throw new CustomException(
          'This user is already assigned to a different kiosk in this campaign',
          ERROR_CODE.CAMPAIGN_KIOSK_ASSIGNMENT_CONFLICT,
          HttpStatus.CONFLICT,
        );
      }
      throw error;
    }
  }

  async unassign(campaignId: string, deviceId: string): Promise<void> {
    await this.campaignService.findCampaignEntityOrFail(campaignId);
    await this.repository.delete({ campaignId, deviceId });
  }

  /** `GET /v1/me/assignments?campaignId` (D-Q17). */
  async listForUser(
    userId: string,
    campaignId?: string,
  ): Promise<CampaignKioskAssignmentDao[]> {
    const rows = await this.findAll({
      where: campaignId ? { userId, campaignId } : { userId },
      order: { assignedAt: 'DESC' },
    });
    return this.attachIdentity(toDao(CampaignKioskAssignmentDao, rows));
  }

  /** Batch lookup for `CampaignMemberService.listCampaignsForUser`'s `assignedDevices[]` — one query for every campaign at once, never N+1. */
  async listDevicesByUserAcrossCampaigns(
    userId: string,
    campaignIds: string[],
  ): Promise<Map<string, Device[]>> {
    if (campaignIds.length === 0) return new Map();
    const rows = await this.repository.find({
      where: { userId, campaignId: In(campaignIds) },
    });
    const deviceIds = [...new Set(rows.map((r) => r.deviceId))];
    const devices = deviceIds.length
      ? await this.deviceRepository.find({ where: { id: In(deviceIds) } })
      : [];
    const deviceById = new Map(devices.map((d) => [d.id, d]));

    const map = new Map<string, Device[]>();
    for (const row of rows) {
      const device = deviceById.get(row.deviceId);
      if (!device) continue;
      if (!map.has(row.campaignId)) map.set(row.campaignId, []);
      map.get(row.campaignId)!.push(device);
    }
    return map;
  }

  /**
   * `GET /v1/campaigns/:id/kiosks` — cms-8-screens-api-plan.md §2.1's
   * dashboard detail ("kiosk đang setup cho đợt + người được gán"). Per-kiosk
   * timing has its own dedicated `GET /v1/campaigns/:id/stats/timing`
   * (P4/`modules/stats`) rather than being duplicated here — this stays a
   * device-management-only read (device + assignment + a session count),
   * no new cross-module dependency into `StatsModule` for one extra field.
   */
  async listKiosksForCampaign(
    campaignId: string,
  ): Promise<CampaignKioskSummaryDao[]> {
    await this.campaignService.findCampaignEntityOrFail(campaignId);

    const devices = await this.deviceRepository.find({
      where: { campaignId },
      order: { createdAt: 'DESC' },
    });
    const assignments = await this.repository.find({ where: { campaignId } });
    const sessionCountRows: Array<{ device_id: string; count: number }> =
      await this.dataSource.query(
        `SELECT device_id, COUNT(*)::int AS count FROM sessions
          WHERE campaign_id = $1 AND status = 'COMPLETED' AND device_id IS NOT NULL
          GROUP BY device_id`,
        [campaignId],
      );

    const assignmentByDevice = new Map(assignments.map((a) => [a.deviceId, a]));
    const sessionCountByDevice = new Map(
      sessionCountRows.map((r) => [r.device_id, r.count]),
    );
    const userIds = assignments.map((a) => a.userId);
    const users = userIds.length
      ? await this.userRepository.find({ where: { id: In(userIds) } })
      : [];
    const userById = new Map(users.map((u) => [u.id, u]));

    return devices.map((device) => {
      const assignment = assignmentByDevice.get(device.id);
      const user = assignment ? userById.get(assignment.userId) : undefined;
      const dao = new CampaignKioskSummaryDao();
      dao.deviceId = device.id;
      dao.deviceName = device.name;
      dao.status = device.status;
      dao.assignedUserId = assignment?.userId ?? null;
      dao.assignedUserEmail = user?.email ?? null;
      dao.assignedUserDisplayName = user?.displayName ?? null;
      dao.sessionsCompleted = sessionCountByDevice.get(device.id) ?? 0;
      return dao;
    });
  }
}
