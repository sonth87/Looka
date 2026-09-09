import { ERROR_CODE } from '@app/common/errors';
import { FileStorageService } from '@app/modules/file-storage/services/file-storage.service';
import { PhotoReviewService } from '@app/modules/photo-review/services/photo-review.service';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { DataSource, Repository } from 'typeorm';
import { SnakeNamingStrategy } from 'typeorm-naming-strategies';
import { User } from '../shared/entities/user.entity';
import { Photo } from '../capture/entities/photo.entity';
import { Session } from '../capture/entities/session.entity';
import { UploadOutboxEntry } from '../capture/entities/upload-outbox.entity';
import { CaptureReportService } from '../capture/services/capture-report.service';
import { SessionService } from '../capture/services/session.service';
import { StudentService } from '../capture/services/student.service';
import { Campaign } from './entities/campaign.entity';
import { CampaignMember } from './entities/campaign-member.entity';
import { CaptureAnglePreset } from './entities/capture-angle-preset.entity';
import { Device } from './entities/device.entity';
import { DeviceEvent } from './entities/device-event.entity';
import { CampaignService } from './services/campaign.service';
import { CampaignMemberService } from './services/campaign-member.service';
import { CaptureAnglePresetService } from './services/capture-angle-preset.service';
import { DeviceService } from './services/device.service';
import { DeviceEventService } from './services/device-event.service';
import { ActivationPackageService } from './services/activation-package.service';

/**
 * Runs against a real Postgres — same reasoning as
 * device-management-persistence.spec.ts (real FKs, real unique constraints,
 * `select: false` columns), covering the 2026-09-08 additions that spec
 * predates: campaign `code`/`effectiveStatus`/`quotaReached`, the capture
 * angle preset catalog, campaign_members approve/reject/revoke, and device
 * self-enroll. Skipped when TEST_DATABASE_URL is absent; schema must already
 * be migrated first.
 */
const url = process.env.TEST_DATABASE_URL;
const describeDb = url ? describe : describe.skip;

describeDb('campaign config / SSO membership / self-enroll', () => {
  let campaignService: CampaignService;
  let deviceService: DeviceService;
  let campaignMemberService: CampaignMemberService;
  let captureAnglePresetService: CaptureAnglePresetService;
  let dataSource: DataSource;
  let userRepo: Repository<User>;
  let moduleRef: TestingModule;

  beforeAll(async () => {
    const built = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        TypeOrmModule.forRoot({
          type: 'postgres',
          url,
          entities: [
            Campaign,
            Device,
            DeviceEvent,
            CampaignMember,
            CaptureAnglePreset,
            User,
            Session,
            Photo,
            UploadOutboxEntry,
          ],
          namingStrategy: new SnakeNamingStrategy(),
          synchronize: false,
        }),
        TypeOrmModule.forFeature([
          Campaign,
          Device,
          DeviceEvent,
          CampaignMember,
          CaptureAnglePreset,
          User,
          Session,
          Photo,
          UploadOutboxEntry,
        ]),
      ],
      providers: [
        CampaignService,
        DeviceService,
        DeviceEventService,
        CampaignMemberService,
        CaptureAnglePresetService,
        ActivationPackageService,
        CaptureReportService,
        SessionService,
        StudentService,
        {
          provide: FileStorageService,
          useValue: { deleteFile: jest.fn(), issueViewLink: jest.fn() },
        },
        // Best-effort photo-review hook (2026-09-08, wired into both
        // SessionService and DeviceEventService) — irrelevant to what this
        // file checks; a resolved-no-op stub satisfies DI.
        {
          provide: PhotoReviewService,
          useValue: { ensureSetForApprovedSession: jest.fn().mockResolvedValue(null) },
        },
      ],
    }).compile();

    moduleRef = built;
    campaignService = built.get(CampaignService);
    deviceService = built.get(DeviceService);
    campaignMemberService = built.get(CampaignMemberService);
    captureAnglePresetService = built.get(CaptureAnglePresetService);
    dataSource = built.get(DataSource);
    userRepo = dataSource.getRepository(User);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  /** A throwaway `users` row — campaign_members.user_id is a real FK, so tests need a real row to point at. */
  async function createTestUser(emailPrefix: string): Promise<{ id: string; email: string; displayName: string | null }> {
    const id = randomUUID();
    const saved = await userRepo.save({
      ssoUserCode: `${emailPrefix}-${id.slice(0, 8)}`,
      email: `${emailPrefix}-${id.slice(0, 8)}@example.com`,
      displayName: emailPrefix,
      isAdmin: false,
      roles: [],
    });
    return { id: saved.id, email: saved.email, displayName: saved.displayName ?? null };
  }

  /** Inserts a minimal COMPLETED session row directly - quotaReached only cares about the count, not a full capture flow (capture module is out of scope for this pass). */
  async function insertCompletedSession(campaignId: string): Promise<void> {
    await dataSource.query(
      `INSERT INTO sessions (campaign_id, status) VALUES ($1, 'COMPLETED')`,
      [campaignId],
    );
  }

  describe('campaign code / effectiveStatus / quotaReached', () => {
    test('creating a campaign without a code generates a unique, non-null fallback code', async () => {
      const campaign = await campaignService.createCampaign({
        name: 'No code A',
      });
      expect(campaign.code).toBeTruthy();

      const other = await campaignService.createCampaign({ name: 'No code B' });
      expect(other.code).toBeTruthy();
      expect(other.code).not.toBe(campaign.code);
    });

    test('creating a campaign with an explicit code keeps it, and a duplicate code is rejected with CAMPAIGN_CODE_TAKEN', async () => {
      const code = `E2E-${randomUUID().slice(0, 8).toUpperCase()}`;
      const campaign = await campaignService.createCampaign({
        name: 'Coded A',
        code,
      });
      expect(campaign.code).toBe(code);

      await expect(
        campaignService.createCampaign({ name: 'Coded B', code }),
      ).rejects.toMatchObject({
        payload: { code: ERROR_CODE.CAMPAIGN_CODE_TAKEN },
      });
    });

    test('updating a campaign to a code already used by another campaign is rejected', async () => {
      const codeA = `UPD-${randomUUID().slice(0, 8).toUpperCase()}`;
      const codeB = `UPD-${randomUUID().slice(0, 8).toUpperCase()}`;
      await campaignService.createCampaign({
        name: 'Update collide A',
        code: codeA,
      });
      const campaignB = await campaignService.createCampaign({
        name: 'Update collide B',
        code: codeB,
      });

      await expect(
        campaignService.updateCampaign(campaignB.id, { code: codeA }),
      ).rejects.toMatchObject({
        payload: { code: ERROR_CODE.CAMPAIGN_CODE_TAKEN },
      });
    });

    test('effectiveStatus is OPEN with no manualStatus/startsAt/expiresAt bounds', async () => {
      const campaign = await campaignService.createCampaign({
        name: 'Open by default',
      });
      expect(campaign.effectiveStatus).toBe('OPEN');
    });

    test('effectiveStatus is UPCOMING when startsAt is in the future', async () => {
      const campaign = await campaignService.createCampaign({
        name: 'Upcoming',
        startsAt: new Date(Date.now() + 86_400_000).toISOString(),
      });
      expect(campaign.effectiveStatus).toBe('UPCOMING');
    });

    test('effectiveStatus is EXPIRED when expiresAt is in the past', async () => {
      const campaign = await campaignService.createCampaign({
        name: 'Already expired',
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      });
      expect(campaign.effectiveStatus).toBe('EXPIRED');
    });

    test('manualStatus CLOSED wins over dates that would otherwise read OPEN', async () => {
      const campaign = await campaignService.createCampaign({
        name: 'Manually closed',
        manualStatus: 'CLOSED',
      });
      expect(campaign.effectiveStatus).toBe('CLOSED');

      const reloaded = await campaignService.findCampaignOrFail(campaign.id);
      expect(reloaded.effectiveStatus).toBe('CLOSED');
    });

    test('quotaReached flips true once completed sessions reach quotaPlanned', async () => {
      const campaign = await campaignService.createCampaign({
        name: 'Quota test',
        quotaPlanned: 2,
      });
      expect(campaign.quotaReached).toBe(false);

      await insertCompletedSession(campaign.id);
      let reloaded = await campaignService.findCampaignOrFail(campaign.id);
      expect(reloaded.quotaReached).toBe(false);

      await insertCompletedSession(campaign.id);
      reloaded = await campaignService.findCampaignOrFail(campaign.id);
      expect(reloaded.quotaReached).toBe(true);
    });

    test('quotaReached is always false when quotaPlanned is null', async () => {
      const campaign = await campaignService.createCampaign({
        name: 'No quota',
      });
      await insertCompletedSession(campaign.id);
      const reloaded = await campaignService.findCampaignOrFail(campaign.id);
      expect(reloaded.quotaReached).toBe(false);
    });

    test('requiredCameraCount defaults to 1 and reflects distinct explicit cameraRole values', async () => {
      const noAngles = await campaignService.createCampaign({
        name: 'No angles',
      });
      expect(noAngles.requiredCameraCount).toBe(1);

      const withAngles = await campaignService.createCampaign({
        name: 'With angles',
        captureAngles: [
          {
            id: 's1',
            type: 'FRONT',
            instruction: '',
            capture: { enabled: true },
            isCardSource: true,
            cameraRole: 'CENTER',
          },
          {
            id: 's2',
            type: 'LEFT',
            instruction: '',
            capture: { enabled: true },
            cameraRole: 'LEFT',
          },
          {
            id: 's3',
            type: 'RIGHT',
            instruction: '',
            capture: { enabled: true },
            cameraRole: 'RIGHT',
          },
        ],
      });
      expect(withAngles.requiredCameraCount).toBe(3);
    });
  });

  describe('capture angle preset catalog', () => {
    test('the 5 system presets are seeded, active, and is_system', async () => {
      const presets = await captureAnglePresetService.listPresets(false);
      const codes = presets
        .filter((p) => p.isSystem)
        .map((p) => p.code)
        .sort();
      expect(codes).toEqual(['DOWN', 'FRONT', 'LEFT_30', 'RIGHT_30', 'UP']);
      expect(presets.every((p) => p.active)).toBe(true);
    });

    test('creating a preset with a duplicate code is rejected', async () => {
      await expect(
        captureAnglePresetService.createPreset({
          code: 'FRONT',
          labelVi: 'Trùng mã',
          instructionVi: 'x',
          poseDefault: { yaw: { target: 0, tolerance: 1 } },
          preferredCameraRole: 'CENTER',
        }),
      ).rejects.toMatchObject({
        payload: { code: ERROR_CODE.CAPTURE_ANGLE_PRESET_CODE_TAKEN },
      });
    });

    test('a new API-created preset is always isSystem: false', async () => {
      const code = `CUSTOM-${randomUUID().slice(0, 8).toUpperCase()}`;
      const preset = await captureAnglePresetService.createPreset({
        code,
        labelVi: 'Góc mới',
        instructionVi: 'Quay 45 độ',
        poseDefault: { yaw: { target: 45, tolerance: 5 } },
        preferredCameraRole: 'LEFT',
      });
      expect(preset.isSystem).toBe(false);
      expect(preset.active).toBe(true);
    });

    test("a system preset's label/instruction/pose can be edited, but it can never be truly deleted - only active:false", async () => {
      const presets = await captureAnglePresetService.listPresets(true);
      const front = presets.find((p) => p.code === 'FRONT')!;

      const edited = await captureAnglePresetService.updatePreset(front.id, {
        labelVi: 'Thẳng (đã sửa)',
      });
      expect(edited.labelVi).toBe('Thẳng (đã sửa)');
      expect(edited.isSystem).toBe(true);
      expect(edited.code).toBe('FRONT');

      const deactivated = await captureAnglePresetService.updatePreset(
        front.id,
        { active: false },
      );
      expect(deactivated.active).toBe(false);

      // Restore for other tests / seed-data assumptions elsewhere in this
      // shared database.
      await captureAnglePresetService.updatePreset(front.id, {
        active: true,
        labelVi: 'Thẳng',
      });
    });

    test('listPresets excludes inactive by default, includes them with includeInactive', async () => {
      const code = `INACTIVE-${randomUUID().slice(0, 8).toUpperCase()}`;
      const preset = await captureAnglePresetService.createPreset({
        code,
        labelVi: 'Sẽ ẩn',
        instructionVi: 'x',
        poseDefault: {},
        preferredCameraRole: 'CENTER',
        active: false,
      });

      const activeOnly = await captureAnglePresetService.listPresets(false);
      expect(activeOnly.some((p) => p.id === preset.id)).toBe(false);

      const withInactive = await captureAnglePresetService.listPresets(true);
      expect(withInactive.some((p) => p.id === preset.id)).toBe(true);
    });
  });

  describe('campaign_members join / approve / reject / revoke', () => {
    test('joinCampaign is idempotent - a second call returns the existing row unchanged, never reset to PENDING', async () => {
      const campaign = await campaignService.createCampaign({
        name: 'Join idempotent',
      });
      const user = await createTestUser('join');

      const first = await campaignMemberService.joinCampaign(
        campaign.id,
        user.id,
      );
      expect(first.status).toBe('PENDING');

      await campaignMemberService.decide(
        campaign.id,
        user.id,
        { action: 'approve' },
        user.id,
      );

      const second = await campaignMemberService.joinCampaign(
        campaign.id,
        user.id,
      );
      expect(second.status).toBe('APPROVED');
      expect(second.id).toBe(first.id);
    });

    test('approve sets status/decidedAt/decidedByUserId', async () => {
      const campaign = await campaignService.createCampaign({
        name: 'Approve flow',
      });
      const applicant = await createTestUser('applicant');
      const admin = await createTestUser('admin');

      await campaignMemberService.joinCampaign(campaign.id, applicant.id);
      const decided = await campaignMemberService.decide(
        campaign.id,
        applicant.id,
        { action: 'approve', note: 'ok' },
        admin.id,
      );

      expect(decided.status).toBe('APPROVED');
      expect(decided.decidedByUserId).toBe(admin.id);
      expect(decided.decidedAt).toBeTruthy();
      expect(decided.note).toBe('ok');
    });

    test('reject sets status REJECTED', async () => {
      const campaign = await campaignService.createCampaign({
        name: 'Reject flow',
      });
      const applicant = await createTestUser('applicant');
      const admin = await createTestUser('admin');

      await campaignMemberService.joinCampaign(campaign.id, applicant.id);
      const decided = await campaignMemberService.decide(
        campaign.id,
        applicant.id,
        { action: 'reject' },
        admin.id,
      );
      expect(decided.status).toBe('REJECTED');
    });

    test('revoke sets status REVOKED, even from APPROVED', async () => {
      const campaign = await campaignService.createCampaign({
        name: 'Revoke flow',
      });
      const applicant = await createTestUser('applicant');
      const admin = await createTestUser('admin');

      await campaignMemberService.joinCampaign(campaign.id, applicant.id);
      await campaignMemberService.decide(
        campaign.id,
        applicant.id,
        { action: 'approve' },
        admin.id,
      );
      const revoked = await campaignMemberService.decide(
        campaign.id,
        applicant.id,
        { action: 'revoke' },
        admin.id,
      );
      expect(revoked.status).toBe('REVOKED');
    });

    test('deciding a membership that does not exist throws CAMPAIGN_MEMBER_NOT_FOUND', async () => {
      const campaign = await campaignService.createCampaign({
        name: 'Decide missing',
      });
      const admin = await createTestUser('admin');
      await expect(
        campaignMemberService.decide(
          campaign.id,
          randomUUID(),
          { action: 'approve' },
          admin.id,
        ),
      ).rejects.toMatchObject({
        payload: { code: ERROR_CODE.CAMPAIGN_MEMBER_NOT_FOUND },
      });
    });

    test('listMembers filters by status and paginates', async () => {
      const campaign = await campaignService.createCampaign({
        name: 'List members',
      });
      const admin = await createTestUser('admin');
      const u1 = await createTestUser('m1');
      const u2 = await createTestUser('m2');
      const u3 = await createTestUser('m3');

      await campaignMemberService.joinCampaign(campaign.id, u1.id);
      await campaignMemberService.joinCampaign(campaign.id, u2.id);
      await campaignMemberService.joinCampaign(campaign.id, u3.id);
      await campaignMemberService.decide(
        campaign.id,
        u1.id,
        { action: 'approve' },
        admin.id,
      );
      await campaignMemberService.decide(
        campaign.id,
        u2.id,
        { action: 'reject' },
        admin.id,
      );

      const all = await campaignMemberService.listMembers(campaign.id, {
        page: 1,
        limit: 10,
      });
      expect(all.meta.totalItems).toBe(3);
      // REGRESSION (2026-09-08): the CMS "Cán bộ chụp" tab crashed to a
      // blank screen because CampaignMemberDao carried no email/displayName
      // at all (only campaign_members columns) while the CMS unconditionally
      // read m.email/m.displayName off every row.
      const m1Row = all.items.find((m) => m.userId === u1.id);
      expect(m1Row?.email).toBe(u1.email);
      expect(m1Row?.displayName).toBe(u1.displayName);

      const approvedOnly = await campaignMemberService.listMembers(
        campaign.id,
        {
          page: 1,
          limit: 10,
          status: 'APPROVED',
        },
      );
      expect(approvedOnly.items).toHaveLength(1);
      expect(approvedOnly.items[0].userId).toBe(u1.id);

      const page1 = await campaignMemberService.listMembers(campaign.id, {
        page: 1,
        limit: 2,
      });
      expect(page1.items).toHaveLength(2);
      expect(page1.meta.totalPages).toBe(2);
    });

    test('listCampaignsForUser: NONE when no membership row exists, reflects real status when one does, and excludes manually CLOSED campaigns', async () => {
      const user = await createTestUser('mecampaigns');
      const openCampaign = await campaignService.createCampaign({
        name: 'Me: open, no membership',
      });
      const memberCampaign = await campaignService.createCampaign({
        name: 'Me: member',
      });
      const closedCampaign = await campaignService.createCampaign({
        name: 'Me: closed',
        manualStatus: 'CLOSED',
      });

      await campaignMemberService.joinCampaign(memberCampaign.id, user.id);

      const list = await campaignMemberService.listCampaignsForUser(user.id);
      const byId = new Map(list.map((c) => [c.id, c]));

      expect(byId.get(openCampaign.id)?.membership.status).toBe('NONE');
      expect(byId.get(memberCampaign.id)?.membership.status).toBe('PENDING');
      expect(byId.has(closedCampaign.id)).toBe(false);
    });
  });

  describe('device self-enroll', () => {
    test('a new fingerprint creates a device with campaignId null', async () => {
      const user = await createTestUser('enroll');
      const fingerprint = `fp-${randomUUID()}`;

      const result = await deviceService.selfEnroll(
        { hostname: 'KIOSK-01', fingerprint },
        user.id,
        'https://api.example.com',
      );
      expect(result.deviceId).toBeTruthy();
      expect(result.deviceSecret).toBeTruthy();
      expect(result.apiBaseUrl).toBe('https://api.example.com');

      const device = await deviceService.findDeviceOrFail(result.deviceId);
      expect(device.campaignId ?? null).toBeNull();

      const verified = await deviceService.verifyCredentials(
        result.deviceId,
        result.deviceSecret,
      );
      expect(verified.ok).toBe(true);
    });

    test('an existing fingerprint rotates the secret with overlap and updates lastUserId, keeping the old secret valid until the new one is used', async () => {
      const userA = await createTestUser('enrollA');
      const userB = await createTestUser('enrollB');
      const fingerprint = `fp-${randomUUID()}`;

      const first = await deviceService.selfEnroll(
        { hostname: 'KIOSK-02', fingerprint },
        userA.id,
      );
      // The device must actually be "in use" for the overlap to matter -
      // mirrors reissueDevice's own overlap test setup.
      await deviceService.verifyCredentials(first.deviceId, first.deviceSecret);

      const second = await deviceService.selfEnroll(
        { hostname: 'KIOSK-02', fingerprint },
        userB.id,
      );
      expect(second.deviceId).toBe(first.deviceId);
      expect(second.deviceSecret).not.toBe(first.deviceSecret);

      // Old secret still valid - overlap, not an outright kill.
      const oldStillWorks = await deviceService.verifyCredentials(
        first.deviceId,
        first.deviceSecret,
      );
      expect(oldStillWorks.ok).toBe(true);

      // New secret also works, and using it completes the rotation.
      const newWorks = await deviceService.verifyCredentials(
        second.deviceId,
        second.deviceSecret,
      );
      expect(newWorks.ok).toBe(true);

      const oldNowDead = await deviceService.verifyCredentials(
        first.deviceId,
        first.deviceSecret,
      );
      expect(oldNowDead.ok).toBe(false);

      const device = await deviceService.findDeviceOrFail(second.deviceId);
      expect(device.campaignId ?? null).toBeNull();
    });

    test("self-enrolling against a REVOKED device's fingerprint is refused", async () => {
      const user = await createTestUser('enrollRevoked');
      const fingerprint = `fp-${randomUUID()}`;

      const first = await deviceService.selfEnroll(
        { hostname: 'KIOSK-03', fingerprint },
        user.id,
      );
      await deviceService.revokeDevice(first.deviceId);

      await expect(
        deviceService.selfEnroll(
          { hostname: 'KIOSK-03', fingerprint },
          user.id,
        ),
      ).rejects.toMatchObject({
        payload: { code: ERROR_CODE.DEVICE_FINGERPRINT_REVOKED },
      });
    });
  });
});
