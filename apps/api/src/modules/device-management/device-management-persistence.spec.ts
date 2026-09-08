import { ERROR_CODE } from '@app/common/errors';
import { FileStorageService } from '@app/modules/file-storage/services/file-storage.service';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { SnakeNamingStrategy } from 'typeorm-naming-strategies';
import { SessionListState } from '../capture/capture.constants';
import { Photo } from '../capture/entities/photo.entity';
import { Session } from '../capture/entities/session.entity';
import { UploadOutboxEntry } from '../capture/entities/upload-outbox.entity';
import { CaptureReportService } from '../capture/services/capture-report.service';
import { SessionService } from '../capture/services/session.service';
import { StudentService } from '../capture/services/student.service';
import { Campaign } from './entities/campaign.entity';
import { Device } from './entities/device.entity';
import { DeviceEvent, DeviceEventType } from './entities/device-event.entity';
import { CampaignService } from './services/campaign.service';
import { DeviceService } from './services/device.service';
import { DeviceEventService } from './services/device-event.service';
import { ActivationPackageService } from './services/activation-package.service';

/**
 * Runs against a real Postgres, same reasoning as capture-persistence.spec.ts:
 * what's being checked here is a real foreign key (campaign_id), a real
 * unique/expiry read path, and the actual hashed-secret column having
 * `select: false` — a mock repository would only prove the mock agrees with
 * itself. Skipped when TEST_DATABASE_URL is absent; schema must already be
 * migrated (`pnpm typeorm:run-migrations` against TEST_DATABASE_URL) first.
 */
const url = process.env.TEST_DATABASE_URL;
const describeDb = url ? describe : describe.skip;

describeDb('device management persistence', () => {
  let campaignService: CampaignService;
  let deviceService: DeviceService;
  let deviceEventService: DeviceEventService;
  let activationPackageService: ActivationPackageService;
  let sessionService: SessionService;
  let studentService: StudentService;
  let dataSource: DataSource;
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
          Session,
          Photo,
          UploadOutboxEntry,
        ]),
      ],
      providers: [
        CampaignService,
        DeviceService,
        DeviceEventService,
        ActivationPackageService,
        CaptureReportService,
        SessionService,
        StudentService,
        // SessionService depends on FileStorageService for its best-effort
        // delete on completeSession() - irrelevant to these tests (nothing
        // here calls completeSession) and not reachable in this
        // environment, so a stub is enough to satisfy DI. StudentService's
        // getStudentDetail() calls issueViewLink() per photo/video with an
        // fsFileId — none of the fixtures below ever set one, but the stub
        // still needs the method to exist so a future fixture that does
        // fails loudly instead of hitting "not a function".
        { provide: FileStorageService, useValue: { deleteFile: jest.fn(), issueViewLink: jest.fn() } },
      ],
    }).compile();

    moduleRef = built;
    campaignService = built.get(CampaignService);
    deviceService = built.get(DeviceService);
    deviceEventService = built.get(DeviceEventService);
    activationPackageService = built.get(ActivationPackageService);
    sessionService = built.get(SessionService);
    studentService = built.get(StudentService);
    dataSource = built.get(DataSource);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  /**
   * Reports one finished kiosk session (SESSION_REPORT) with a single photo,
   * then immediately reports that photo's final outcome (PHOTO_STATUS) -
   * the shape every list/stats test below needs, parameterised by the
   * outcome so tests can build ready/pending/failed sessions.
   */
  const reportFinishedSession = async (
    deviceId: string,
    campaignId: string,
    outcome: { localStatus: string; fsStatus: string | null },
  ): Promise<string> => {
    const sessionId = randomUUID();
    const photoId = randomUUID();
    const sha256 = randomUUID().replace(/-/g, '').padEnd(64, '0');
    const at = new Date().toISOString();

    await deviceEventService.recordBatch(deviceId, campaignId, [
      {
        type: DeviceEventType.SESSION_REPORT,
        occurredAt: at,
        metadata: {
          sessionId,
          startedAt: at,
          approvedAt: at,
          workflowId: 'default',
          photos: [
            {
              photoId,
              stepId: 'FRONT',
              stepType: 'FRONT',
              cameraRole: 'CENTER',
              attempt: 1,
              mimeType: 'image/jpeg',
              sizeBytes: 800,
              sha256,
              virtualPath: `face/2026/${sessionId}/FRONT-1.jpg`,
              capturedAt: at,
              localStatus: 'PENDING',
              fsFileId: null,
              fsStatus: null,
            },
          ],
        },
      },
      {
        type: DeviceEventType.PHOTO_STATUS,
        occurredAt: at,
        metadata: {
          sessionId,
          photoId,
          stepId: 'FRONT',
          attempt: 1,
          at,
          localStatus: outcome.localStatus,
          fsFileId: outcome.fsStatus ? randomUUID() : null,
          fsStatus: outcome.fsStatus,
          error: null,
          mimeType: 'image/jpeg',
          sizeBytes: 800,
          sha256,
          virtualPath: `face/2026/${sessionId}/FRONT-1.jpg`,
          stepType: 'FRONT',
          cameraRole: 'CENTER',
        },
      },
    ]);

    return sessionId;
  };

  test('a campaign created with no expiry is permanent (NULL, not a sentinel date)', async () => {
    const campaign = await campaignService.createCampaign({
      name: 'Permanent batch',
    });
    expect(campaign.expiresAt).toBeFalsy();
    expect(campaign.consentVersion).toBe(0);
  });

  test('a campaign created with consent text starts at consentVersion 1, not 0', async () => {
    // 0 is reserved for "never configured" — see the entity's own doc
    // comment. A campaign that sets content on creation has, by definition,
    // already configured it once.
    const campaign = await campaignService.createCampaign({
      name: 'With consent',
      consentContent: 'Chúng tôi thu thập ảnh của bạn để...',
    });
    expect(campaign.consentVersion).toBe(1);
  });

  test('editing consent content bumps the version; a no-op update does not', async () => {
    const campaign = await campaignService.createCampaign({
      name: 'Consent edits',
    });

    const first = await campaignService.updateCampaign(campaign.id, {
      consentContent: 'v1 text',
    });
    expect(first.consentVersion).toBe(1);

    // Same text again - must not bump a second time.
    const second = await campaignService.updateCampaign(campaign.id, {
      consentContent: 'v1 text',
    });
    expect(second.consentVersion).toBe(1);

    const third = await campaignService.updateCampaign(campaign.id, {
      consentContent: 'v2 text',
    });
    expect(third.consentVersion).toBe(2);
  });

  test('simultaneousCapture defaults to false and round-trips through create/update', async () => {
    const campaign = await campaignService.createCampaign({
      name: 'Simultaneous default',
    });
    expect(campaign.simultaneousCapture).toBe(false);

    const updated = await campaignService.updateCampaign(campaign.id, {
      simultaneousCapture: true,
    });
    expect(updated.simultaneousCapture).toBe(true);

    const reloaded = await campaignService.findCampaignOrFail(campaign.id);
    expect(reloaded.simultaneousCapture).toBe(true);
  });

  test('recordVideo defaults to false and round-trips through create/update', async () => {
    const campaign = await campaignService.createCampaign({
      name: 'Record video default',
    });
    expect(campaign.recordVideo).toBe(false);

    const updated = await campaignService.updateCampaign(campaign.id, {
      recordVideo: true,
    });
    expect(updated.recordVideo).toBe(true);

    const reloaded = await campaignService.findCampaignOrFail(campaign.id);
    expect(reloaded.recordVideo).toBe(true);
  });

  test('setting expiresAt to null on an expiring campaign makes it permanent again', async () => {
    const campaign = await campaignService.createCampaign({
      name: 'Renewable',
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    expect(campaign.expiresAt).toBeTruthy();

    const renewed = await campaignService.updateCampaign(campaign.id, {
      expiresAt: null,
    });
    expect(renewed.expiresAt).toBeFalsy();
  });

  test('registering a device issues a secret that verifies once, and activates the device', async () => {
    const campaign = await campaignService.createCampaign({
      name: 'Device batch',
    });
    const { device, plainSecret } = await deviceService.registerDevice(
      campaign.id,
      {
        name: 'Kiosk A',
      },
    );

    const ok = await deviceService.verifyCredentials(device.id, plainSecret);
    expect(ok.ok).toBe(true);

    const wrong = await deviceService.verifyCredentials(
      device.id,
      'not-the-secret',
    );
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) expect(wrong.reason).toBe('INVALID_SECRET');

    // The first successful check above should have flipped REGISTERED -> ACTIVATED.
    const dao = await deviceService.findDeviceOrFail(device.id);
    expect(dao.status).toBe('ACTIVATED');
    expect(dao.activatedAt).toBeTruthy();
  });

  test('reissuing a still-REGISTERED device rotates its secret WITH OVERLAP, and resets status normally (2026-09-08)', async () => {
    const campaignDao = await campaignService.createCampaign({
      name: 'Reissue test (registered)',
    });
    const campaign = await campaignService.findCampaignEntityOrFail(campaignDao.id);
    const { device, plainSecret: originalSecret } = await deviceService.registerDevice(
      campaign.id,
      { name: 'Kiosk Reissue Registered' },
    );

    const { device: reissued, plainSecret: newSecret } = await deviceService.reissueDevice(
      device.id,
      {},
    );
    expect(reissued.id).toBe(device.id);
    expect(newSecret).not.toBe(originalSecret);

    // Secret rotation with overlap (2026-09-08 fix for the "kiosk 3"
    // incident): the old secret stays valid — no time limit — until the
    // new one is used successfully once. `secretRotatedAt` marks that a
    // rotation is pending.
    const oldCheckBeforeNewUsed = await deviceService.verifyCredentials(device.id, originalSecret);
    expect(oldCheckBeforeNewUsed.ok).toBe(true);
    const pendingRotation = await deviceService.findDeviceOrFail(device.id);
    // secretRotatedAt stays set — this success came via the *previous*
    // secret (rotation-with-overlap "old package, loaded late" case), which
    // does not itself resolve the overlap; only using the *new* secret does.
    expect(pendingRotation.secretRotatedAt).toBeTruthy();

    // A successful credential check is what "activation" means regardless
    // of which of the two live secrets was used - this device was still
    // REGISTERED, so it flips to ACTIVATED here, on the old-package login.
    expect(pendingRotation.status).toBe('ACTIVATED');
    expect(pendingRotation.activatedAt).toBeTruthy();

    // The new secret also works - and, since this completes the rotation
    // (it's the *current* hash, with a previous still on file), the overlap
    // window closes: secretRotatedAt clears and the old secret dies.
    const newCheck = await deviceService.verifyCredentials(device.id, newSecret);
    expect(newCheck.ok).toBe(true);
    const activated = await deviceService.findDeviceOrFail(device.id);
    expect(activated.status).toBe('ACTIVATED');
    expect(activated.secretRotatedAt).toBeFalsy();

    const oldCheckAfterNewUsed = await deviceService.verifyCredentials(device.id, originalSecret);
    expect(oldCheckAfterNewUsed.ok).toBe(false);
    if (!oldCheckAfterNewUsed.ok) expect(oldCheckAfterNewUsed.reason).toBe('INVALID_SECRET');

    const zip = await activationPackageService.buildActivationZip(reissued, campaign, newSecret);
    expect(zip.length).toBeGreaterThan(0);
    expect(zip.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  });

  test('reissuing an already-ACTIVATED device rotates its secret WITH OVERLAP and leaves status ACTIVATED (2026-09-07/08)', async () => {
    const campaignDao = await campaignService.createCampaign({
      name: 'Reissue test (activated)',
    });
    const campaign = await campaignService.findCampaignEntityOrFail(campaignDao.id);
    const { device, plainSecret: originalSecret } = await deviceService.registerDevice(
      campaign.id,
      { name: 'Kiosk Reissue Activated' },
    );

    // Activate it first - reissuing an already-ACTIVATED device must still
    // work (DeviceController.reissueDevice's own doc comment: this is
    // intended, not blocked).
    const activated = await deviceService.verifyCredentials(device.id, originalSecret);
    expect(activated.ok).toBe(true);
    const beforeReissue = await deviceService.findDeviceOrFail(device.id);
    expect(beforeReissue.status).toBe('ACTIVATED');

    const { device: reissued, plainSecret: newSecret } = await deviceService.reissueDevice(
      device.id,
      {},
    );
    expect(newSecret).not.toBe(originalSecret);

    // This is the exact "kiosk 3" incident, fixed: a running kiosk on the
    // old secret is NOT locked out by a reissue anymore.
    const oldCheck = await deviceService.verifyCredentials(device.id, originalSecret);
    expect(oldCheck.ok).toBe(true);
    const pendingRotation = await deviceService.findDeviceOrFail(device.id);
    expect(pendingRotation.secretRotatedAt).toBeTruthy();

    // Status stays ACTIVATED across the reissue - "chỉ cần tải gói chứ
    // không cần phải thiết lập lại kích hoạt". Note this means the badge
    // can say ACTIVATED before the *new* secret has actually been used by
    // any kiosk - an acknowledged trade, see DeviceService.reissueDevice's
    // own doc comment.
    expect(pendingRotation.status).toBe('ACTIVATED');

    // The new secret works too, and using it completes the rotation.
    const newCheck = await deviceService.verifyCredentials(device.id, newSecret);
    expect(newCheck.ok).toBe(true);
    const afterNewUsed = await deviceService.findDeviceOrFail(device.id);
    expect(afterNewUsed.secretRotatedAt).toBeFalsy();

    // ... which finally kills the old one.
    const oldCheckAfterNewUsed = await deviceService.verifyCredentials(device.id, originalSecret);
    expect(oldCheckAfterNewUsed.ok).toBe(false);
    if (!oldCheckAfterNewUsed.ok) expect(oldCheckAfterNewUsed.reason).toBe('INVALID_SECRET');

    const zip = await activationPackageService.buildActivationZip(reissued, campaign, newSecret);
    expect(zip.length).toBeGreaterThan(0);
    expect(zip.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  });

  test('revoking a device kills both its current and previous secret immediately, no overlap', async () => {
    const campaign = await campaignService.createCampaign({ name: 'Revoke test' });
    const { device, plainSecret: s1 } = await deviceService.registerDevice(campaign.id, {
      name: 'Kiosk Revoke',
    });
    // Activate on S1, then reissue to S2 so a previous secret is live too -
    // revoke must kill both, not just the current one.
    await deviceService.verifyCredentials(device.id, s1);
    const { plainSecret: s2 } = await deviceService.reissueDevice(device.id, {});

    const revoked = await deviceService.revokeDevice(device.id);
    expect(revoked.status).toBe('REVOKED');
    expect(revoked.revokedAt).toBeTruthy();
    expect(revoked.secretRotatedAt).toBeFalsy();

    const s1Check = await deviceService.verifyCredentials(device.id, s1);
    expect(s1Check.ok).toBe(false);
    if (!s1Check.ok) expect(s1Check.reason).toBe('REVOKED');

    const s2Check = await deviceService.verifyCredentials(device.id, s2);
    expect(s2Check.ok).toBe(false);
    if (!s2Check.ok) expect(s2Check.reason).toBe('REVOKED');
  });

  test('activateDevice refuses a REVOKED device', async () => {
    const campaign = await campaignService.createCampaign({ name: 'Revoke then activate' });
    const { device } = await deviceService.registerDevice(campaign.id, { name: 'Kiosk RA' });
    await deviceService.revokeDevice(device.id);

    await expect(deviceService.activateDevice(device.id)).rejects.toMatchObject({
      payload: { code: ERROR_CODE.DEVICE_REVOKED },
    });
  });

  test('reissuing a REVOKED device returns it to REGISTERED, clears revokedAt, and the new secret works', async () => {
    const campaign = await campaignService.createCampaign({ name: 'Revoke then reissue' });
    const { device, plainSecret: original } = await deviceService.registerDevice(campaign.id, {
      name: 'Kiosk RR',
    });
    await deviceService.verifyCredentials(device.id, original);
    await deviceService.revokeDevice(device.id);

    const { plainSecret: fresh } = await deviceService.reissueDevice(device.id, {});
    const afterReissue = await deviceService.findDeviceOrFail(device.id);
    expect(afterReissue.status).toBe('REGISTERED');
    expect(afterReissue.revokedAt).toBeFalsy();

    const check = await deviceService.verifyCredentials(device.id, fresh);
    expect(check.ok).toBe(true);
  });

  test('double reissue keeps the secret a running kiosk actually uses alive, kills only the never-used intermediate one', async () => {
    const campaign = await campaignService.createCampaign({ name: 'Double reissue' });
    const { device, plainSecret: s1 } = await deviceService.registerDevice(campaign.id, {
      name: 'Kiosk Double',
    });
    // S1 is the secret an actual kiosk loaded and is running on.
    await deviceService.verifyCredentials(device.id, s1);

    // Admin clicks "Tải gói kích hoạt" twice in a row without the kiosk
    // ever loading either new package - reproducing the exact incident.
    const { plainSecret: s2 } = await deviceService.reissueDevice(device.id, {});
    const { plainSecret: s3 } = await deviceService.reissueDevice(device.id, {});

    // S1 (in use) must still work - the whole point of this fix.
    const s1Check = await deviceService.verifyCredentials(device.id, s1);
    expect(s1Check.ok).toBe(true);

    // S2 (intermediate, never used) is dead - it was displaced by S3
    // before anyone ever loaded it.
    const s2Check = await deviceService.verifyCredentials(device.id, s2);
    expect(s2Check.ok).toBe(false);
    if (!s2Check.ok) expect(s2Check.reason).toBe('INVALID_SECRET');

    // S3 (newest) works and completes the rotation.
    const s3Check = await deviceService.verifyCredentials(device.id, s3);
    expect(s3Check.ok).toBe(true);

    // Now that S3 has been used, S1 finally dies.
    const s1CheckAfterS3 = await deviceService.verifyCredentials(device.id, s1);
    expect(s1CheckAfterS3.ok).toBe(false);
    if (!s1CheckAfterS3.ok) expect(s1CheckAfterS3.reason).toBe('INVALID_SECRET');
  });

  test('lastAuthAt/lastAuthFailedAt/lastAuthFailReason are recorded on every credential check', async () => {
    const campaign = await campaignService.createCampaign({ name: 'Auth bookkeeping' });
    const { device, plainSecret } = await deviceService.registerDevice(campaign.id, {
      name: 'Kiosk Bookkeeping',
    });

    const initial = await deviceService.findDeviceOrFail(device.id);
    expect(initial.lastAuthAt).toBeFalsy();
    expect(initial.lastAuthFailedAt).toBeFalsy();

    await deviceService.verifyCredentials(device.id, 'wrong-secret');
    const afterFail = await deviceService.findDeviceOrFail(device.id);
    expect(afterFail.lastAuthFailedAt).toBeTruthy();
    expect(afterFail.lastAuthFailReason).toBe('INVALID_SECRET');
    expect(afterFail.lastAuthAt).toBeFalsy();

    await deviceService.verifyCredentials(device.id, plainSecret);
    const afterSuccess = await deviceService.findDeviceOrFail(device.id);
    expect(afterSuccess.lastAuthAt).toBeTruthy();
  });

  test('reissuing without authApiEndpoint keeps the existing value; supplying one overrides it', async () => {
    const campaign = await campaignService.createCampaign({
      name: 'Reissue endpoint test',
    });
    const { device } = await deviceService.registerDevice(campaign.id, {
      name: 'Kiosk Endpoint',
      authApiEndpoint: 'https://auth.example.com/original',
    });

    const { device: kept } = await deviceService.reissueDevice(device.id, {});
    expect(kept.authApiEndpoint).toBe('https://auth.example.com/original');

    const { device: changed } = await deviceService.reissueDevice(device.id, {
      authApiEndpoint: 'https://auth.example.com/updated',
    });
    expect(changed.authApiEndpoint).toBe('https://auth.example.com/updated');
  });

  test('a device under an expired campaign fails credential checks even with the right secret', async () => {
    const campaign = await campaignService.createCampaign({
      name: 'Already expired',
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    const { device, plainSecret } = await deviceService.registerDevice(
      campaign.id,
      {
        name: 'Kiosk B',
      },
    );

    const result = await deviceService.verifyCredentials(
      device.id,
      plainSecret,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('EXPIRED');

    // The secret check still runs first even on an expired campaign - a
    // wrong secret must read as INVALID_SECRET, not EXPIRED, so an admin
    // isn't misled into thinking "just renew the campaign" would fix a
    // simple typo'd/stale secret.
    const wrongSecretResult = await deviceService.verifyCredentials(device.id, 'not-the-secret');
    expect(wrongSecretResult.ok).toBe(false);
    if (!wrongSecretResult.ok) expect(wrongSecretResult.reason).toBe('INVALID_SECRET');
  });

  test('the activation zip contains activation.json with the plaintext secret, exactly once', async () => {
    const campaignDao = await campaignService.createCampaign({
      name: 'Zip test',
    });
    const campaign = await campaignService.findCampaignEntityOrFail(
      campaignDao.id,
    );
    const { device, plainSecret } = await deviceService.registerDevice(
      campaign.id,
      {
        name: 'Kiosk C',
      },
    );

    const zip = await activationPackageService.buildActivationZip(
      device,
      campaign,
      plainSecret,
    );
    expect(zip.length).toBeGreaterThan(0);
    // A zip's local file header always starts with this 4-byte signature -
    // enough to confirm this is actually a zip, without a zip-reading
    // dependency just for the test.
    expect(zip.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  });

  test('campaign stats count events by type, scoped to that campaign only', async () => {
    const campaignA = await campaignService.createCampaign({ name: 'Stats A' });
    const campaignB = await campaignService.createCampaign({ name: 'Stats B' });
    const { device: deviceA } = await deviceService.registerDevice(
      campaignA.id,
      { name: 'Kiosk A' },
    );
    const { device: deviceB } = await deviceService.registerDevice(
      campaignB.id,
      { name: 'Kiosk B' },
    );

    await deviceEventService.recordBatch(deviceA.id, campaignA.id, [
      {
        type: DeviceEventType.SESSION_COMPLETED,
        occurredAt: new Date().toISOString(),
      },
      {
        type: DeviceEventType.SESSION_COMPLETED,
        occurredAt: new Date().toISOString(),
      },
      {
        type: DeviceEventType.UPLOAD_FAILED,
        occurredAt: new Date().toISOString(),
      },
      {
        type: DeviceEventType.RETAKE,
        occurredAt: new Date().toISOString(),
        metadata: { stepId: 'FRONT' },
      },
    ]);
    // A different campaign's events must never leak into campaignA's stats.
    await deviceEventService.recordBatch(deviceB.id, campaignB.id, [
      {
        type: DeviceEventType.SESSION_COMPLETED,
        occurredAt: new Date().toISOString(),
      },
    ]);

    const stats = await campaignService
      .findCampaignOrFail(campaignA.id)
      .then(() => deviceEventService.campaignStats(campaignA.id));
    expect(stats.deviceCount).toBe(1);
    expect(stats.sessionsCompleted).toBe(2);
    expect(stats.uploadFailed).toBe(1);
    expect(stats.uploadSuccess).toBe(0);
    expect(stats.retakes).toBe(1);
    expect(stats.cbHelpInterventions).toBe(0);
  });

  test('recording an empty batch is a harmless no-op', async () => {
    const campaign = await campaignService.createCampaign({
      name: 'Empty batch',
    });
    const { device } = await deviceService.registerDevice(campaign.id, {
      name: 'Kiosk',
    });

    const accepted = await deviceEventService.recordBatch(
      device.id,
      campaign.id,
      [],
    );
    expect(accepted).toBe(0);
  });

  test('a SESSION_REPORT creates one session with its photos, and re-applying it is a no-op', async () => {
    const campaign = await campaignService.createCampaign({ name: 'Report A' });
    const { device } = await deviceService.registerDevice(campaign.id, {
      name: 'Kiosk R1',
    });

    const sessionId = randomUUID();
    const photoAId = randomUUID();
    const photoBId = randomUUID();
    const approvedAt = new Date().toISOString();
    const metadata = {
      sessionId,
      startedAt: new Date(Date.now() - 60_000).toISOString(),
      approvedAt,
      workflowId: 'default',
      subjectCode: 'SV001',
      subjectName: 'Nguyen Van A',
      photos: [
        {
          photoId: photoAId,
          stepId: 'FRONT',
          stepType: 'FRONT',
          cameraRole: 'CENTER',
          attempt: 1,
          mimeType: 'image/jpeg',
          sizeBytes: 1000,
          sha256: 'a'.repeat(64),
          virtualPath: `face/2026/${sessionId}/FRONT-1.jpg`,
          capturedAt: new Date().toISOString(),
          localStatus: 'PENDING',
          fsFileId: null,
          fsStatus: null,
        },
        {
          photoId: photoBId,
          stepId: 'LEFT',
          stepType: 'LEFT',
          cameraRole: 'LEFT',
          attempt: 2,
          mimeType: 'image/jpeg',
          sizeBytes: 2000,
          sha256: 'b'.repeat(64),
          virtualPath: `face/2026/${sessionId}/LEFT-2.jpg`,
          capturedAt: new Date().toISOString(),
          localStatus: 'PENDING',
          fsFileId: null,
          fsStatus: null,
        },
      ],
    };

    await deviceEventService.recordBatch(device.id, campaign.id, [
      {
        type: DeviceEventType.SESSION_REPORT,
        occurredAt: approvedAt,
        metadata,
      },
    ]);
    // Re-applying the exact same report must change nothing.
    await deviceEventService.recordBatch(device.id, campaign.id, [
      {
        type: DeviceEventType.SESSION_REPORT,
        occurredAt: approvedAt,
        metadata,
      },
    ]);

    const detail = await sessionService.getSessionDetail(sessionId);
    expect(detail.source).toBe('KIOSK');
    expect(detail.status).toBe('COMPLETED');
    expect(detail.deviceId).toBe(device.id);
    expect(detail.campaignId).toBe(campaign.id);
    expect(detail.subjectCode).toBe('SV001');
    expect(detail.photos).toHaveLength(2);

    const sessionRows: Array<{ count: number }> = await dataSource.query(
      'SELECT COUNT(*)::int AS count FROM sessions WHERE id = $1',
      [sessionId],
    );
    expect(sessionRows[0].count).toBe(1);
    const photoRows: Array<{ count: number }> = await dataSource.query(
      'SELECT COUNT(*)::int AS count FROM photos WHERE session_id = $1',
      [sessionId],
    );
    expect(photoRows[0].count).toBe(2);
  });

  test('SESSION_REPORT metadata (className/major/academicYear) merges into sessions.metadata instead of overwriting it', async () => {
    // "Student gallery" feature (2026-09-08): a looked-up student's
    // className/major/academicYear have no dedicated column, so they ride
    // along as free-form metadata — this must merge (jsonb `||`), never
    // overwrite wholesale, same COALESCE-style protection subject_code
    // already has, so a later report that omits a key never erases it.
    const campaign = await campaignService.createCampaign({ name: 'Report Metadata' });
    const { device } = await deviceService.registerDevice(campaign.id, {
      name: 'Kiosk RM1',
    });

    const sessionId = randomUUID();
    const approvedAt = new Date().toISOString();

    await deviceEventService.recordBatch(device.id, campaign.id, [
      {
        type: DeviceEventType.SESSION_REPORT,
        occurredAt: approvedAt,
        metadata: {
          sessionId,
          approvedAt,
          subjectCode: 'SV001',
          metadata: { className: 'CNTT01', major: 'Công nghệ thông tin' },
          photos: [],
        },
      },
    ]);

    const midway: Array<{ metadata: Record<string, unknown> }> = await dataSource.query(
      'SELECT metadata FROM sessions WHERE id = $1',
      [sessionId],
    );
    expect(midway[0].metadata).toEqual({ className: 'CNTT01', major: 'Công nghệ thông tin' });

    // A later report adds academicYear but does not repeat className/major —
    // both must survive the merge, not just the newest key.
    await deviceEventService.recordBatch(device.id, campaign.id, [
      {
        type: DeviceEventType.SESSION_REPORT,
        occurredAt: new Date().toISOString(),
        metadata: {
          sessionId,
          approvedAt: new Date().toISOString(),
          subjectCode: 'SV001',
          metadata: { academicYear: '2025-2026' },
          photos: [],
        },
      },
    ]);

    const after: Array<{ metadata: Record<string, unknown> }> = await dataSource.query(
      'SELECT metadata FROM sessions WHERE id = $1',
      [sessionId],
    );
    expect(after[0].metadata).toEqual({
      className: 'CNTT01',
      major: 'Công nghệ thông tin',
      academicYear: '2025-2026',
    });
  });

  test('a PHOTO_STATUS that arrives before the SESSION_REPORT is not regressed by it', async () => {
    const campaign = await campaignService.createCampaign({ name: 'Report B' });
    const { device } = await deviceService.registerDevice(campaign.id, {
      name: 'Kiosk R2',
    });

    const sessionId = randomUUID();
    const photoId = randomUUID();
    const uploadedAt = new Date().toISOString();
    const sha256 = 'c'.repeat(64);

    await deviceEventService.recordBatch(device.id, campaign.id, [
      {
        type: DeviceEventType.PHOTO_STATUS,
        occurredAt: uploadedAt,
        metadata: {
          sessionId,
          photoId,
          stepId: 'FRONT',
          attempt: 1,
          at: uploadedAt,
          localStatus: 'UPLOADED',
          fsFileId: randomUUID(),
          fsStatus: 'SCANNING',
          error: null,
          mimeType: 'image/jpeg',
          sizeBytes: 1500,
          sha256,
          virtualPath: `face/2026/${sessionId}/FRONT-1.jpg`,
          stepType: 'FRONT',
          cameraRole: 'CENTER',
        },
      },
    ]);

    // Nothing may be dropped for lacking a parent session (A.3) - a minimal
    // one must already exist even though no SESSION_REPORT has arrived yet.
    const midway = await sessionService.getSessionDetail(sessionId);
    expect(midway.status).toBe('IN_PROGRESS');
    expect(midway.photos[0].fsStatus).toBe('SCANNING');
    expect(midway.photos[0].localStatus).toBe('UPLOADED');

    // The SESSION_REPORT's own status snapshot is the pre-upload one - it
    // must not regress what PHOTO_STATUS already recorded.
    await deviceEventService.recordBatch(device.id, campaign.id, [
      {
        type: DeviceEventType.SESSION_REPORT,
        occurredAt: new Date().toISOString(),
        metadata: {
          sessionId,
          startedAt: new Date(Date.now() - 60_000).toISOString(),
          approvedAt: new Date(Date.now() - 30_000).toISOString(),
          workflowId: 'default',
          photos: [
            {
              photoId,
              stepId: 'FRONT',
              stepType: 'FRONT',
              cameraRole: 'CENTER',
              attempt: 1,
              mimeType: 'image/jpeg',
              sizeBytes: 1500,
              sha256,
              virtualPath: `face/2026/${sessionId}/FRONT-1.jpg`,
              capturedAt: new Date().toISOString(),
              localStatus: 'PENDING',
              fsFileId: null,
              fsStatus: null,
            },
          ],
        },
      },
    ]);

    const after = await sessionService.getSessionDetail(sessionId);
    expect(after.status).toBe('COMPLETED');
    expect(after.photos[0].fsStatus).toBe('SCANNING');
    expect(after.photos[0].localStatus).toBe('UPLOADED');
  });

  test('a PHOTO_STATUS that arrives after the SESSION_REPORT updates the photo status', async () => {
    const campaign = await campaignService.createCampaign({ name: 'Report C' });
    const { device } = await deviceService.registerDevice(campaign.id, {
      name: 'Kiosk R3',
    });

    const sessionId = randomUUID();
    const photoId = randomUUID();
    const approvedAt = new Date(Date.now() - 10_000).toISOString();
    const sha256 = 'd'.repeat(64);

    await deviceEventService.recordBatch(device.id, campaign.id, [
      {
        type: DeviceEventType.SESSION_REPORT,
        occurredAt: approvedAt,
        metadata: {
          sessionId,
          startedAt: new Date(Date.now() - 60_000).toISOString(),
          approvedAt,
          workflowId: 'default',
          photos: [
            {
              photoId,
              stepId: 'FRONT',
              stepType: 'FRONT',
              cameraRole: 'CENTER',
              attempt: 1,
              mimeType: 'image/jpeg',
              sizeBytes: 1200,
              sha256,
              virtualPath: `face/2026/${sessionId}/FRONT-1.jpg`,
              capturedAt: new Date(Date.now() - 65_000).toISOString(),
              localStatus: 'PENDING',
              fsFileId: null,
              fsStatus: null,
            },
          ],
        },
      },
    ]);

    const midway = await sessionService.getSessionDetail(sessionId);
    expect(midway.photos[0].localStatus).toBe('PENDING');
    expect(midway.photos[0].fsStatus).toBeUndefined();

    const readyAt = new Date().toISOString();
    await deviceEventService.recordBatch(device.id, campaign.id, [
      {
        type: DeviceEventType.PHOTO_STATUS,
        occurredAt: readyAt,
        metadata: {
          sessionId,
          photoId,
          stepId: 'FRONT',
          attempt: 1,
          at: readyAt,
          localStatus: 'DONE',
          fsFileId: randomUUID(),
          fsStatus: 'READY',
          error: null,
          mimeType: 'image/jpeg',
          sizeBytes: 1200,
          sha256,
          virtualPath: `face/2026/${sessionId}/FRONT-1.jpg`,
          stepType: 'FRONT',
          cameraRole: 'CENTER',
        },
      },
    ]);

    const after = await sessionService.getSessionDetail(sessionId);
    expect(after.photos[0].fsStatus).toBe('READY');
    expect(after.photos[0].localStatus).toBe('DONE');
    expect(after.photos[0].readyAt).toBeTruthy();
  });

  test('a stale PHOTO_STATUS (older "at") is ignored', async () => {
    const campaign = await campaignService.createCampaign({ name: 'Report D' });
    const { device } = await deviceService.registerDevice(campaign.id, {
      name: 'Kiosk R4',
    });

    const sessionId = randomUUID();
    const photoId = randomUUID();
    const newAt = new Date().toISOString();
    const oldAt = new Date(Date.now() - 60_000).toISOString();
    const basePhoto = {
      sessionId,
      photoId,
      stepId: 'FRONT',
      attempt: 1,
      mimeType: 'image/jpeg',
      sizeBytes: 900,
      sha256: 'e'.repeat(64),
      virtualPath: `face/2026/${sessionId}/FRONT-1.jpg`,
      stepType: 'FRONT',
      cameraRole: 'CENTER',
    };

    await deviceEventService.recordBatch(device.id, campaign.id, [
      {
        type: DeviceEventType.PHOTO_STATUS,
        occurredAt: newAt,
        metadata: {
          ...basePhoto,
          at: newAt,
          localStatus: 'DONE',
          fsFileId: randomUUID(),
          fsStatus: 'READY',
          error: null,
        },
      },
    ]);
    // Arrives later over the wire but describes an earlier instant - must
    // not undo the READY status the newer event already recorded.
    await deviceEventService.recordBatch(device.id, campaign.id, [
      {
        type: DeviceEventType.PHOTO_STATUS,
        occurredAt: oldAt,
        metadata: {
          ...basePhoto,
          at: oldAt,
          localStatus: 'SENDING',
          fsFileId: null,
          fsStatus: 'FAILED',
          error: 'stale',
        },
      },
    ]);

    const detail = await sessionService.getSessionDetail(sessionId);
    expect(detail.photos[0].fsStatus).toBe('READY');
    expect(detail.photos[0].localStatus).toBe('DONE');
  });

  test('a VIDEO_STATUS creates its own minimal session and video row, no SESSION_REPORT needed', async () => {
    // Unlike photos, a video is enqueued already-approved (see
    // apps/desktop/src/main/uploads.ts's enqueueSessionVideos) and reports
    // through VIDEO_STATUS alone — there is no VIDEO_REPORT equivalent of
    // SESSION_REPORT, so the very first status event is also its creation.
    const campaign = await campaignService.createCampaign({ name: 'Video A' });
    const { device } = await deviceService.registerDevice(campaign.id, {
      name: 'Kiosk V1',
    });

    const sessionId = randomUUID();
    const videoId = randomUUID();
    const sentAt = new Date().toISOString();

    await deviceEventService.recordBatch(device.id, campaign.id, [
      {
        type: DeviceEventType.VIDEO_STATUS,
        occurredAt: sentAt,
        metadata: {
          sessionId,
          videoId,
          at: sentAt,
          localStatus: 'UPLOADED',
          fsFileId: randomUUID(),
          fsStatus: 'SCANNING',
          error: null,
          mimeType: 'video/webm',
          sizeBytes: 4_500_000,
          sha256: 'f'.repeat(64),
          virtualPath: `video/2026/${sessionId}/${videoId}.webm`,
          cameraRole: 'CENTER',
          durationMs: 12_000,
        },
      },
    ]);

    const detail = await sessionService.getSessionDetail(sessionId);
    expect(detail.status).toBe('IN_PROGRESS');
    expect(detail.videos).toHaveLength(1);
    expect(detail.videos[0].id).toBe(videoId);
    expect(detail.videos[0].cameraRole).toBe('CENTER');
    expect(detail.videos[0].durationMs).toBe(12_000);
    expect(detail.videos[0].localStatus).toBe('UPLOADED');
    expect(detail.videos[0].fsStatus).toBe('SCANNING');
  });

  test('a later VIDEO_STATUS advances the same video to READY, and a stale one is ignored', async () => {
    const campaign = await campaignService.createCampaign({ name: 'Video B' });
    const { device } = await deviceService.registerDevice(campaign.id, {
      name: 'Kiosk V2',
    });

    const sessionId = randomUUID();
    const videoId = randomUUID();
    const uploadedAt = new Date(Date.now() - 10_000).toISOString();
    const baseVideo = {
      sessionId,
      videoId,
      mimeType: 'video/webm',
      sizeBytes: 4_500_000,
      sha256: 'a'.repeat(64),
      virtualPath: `video/2026/${sessionId}/${videoId}.webm`,
      cameraRole: 'LEFT',
      durationMs: 8_000,
    };

    await deviceEventService.recordBatch(device.id, campaign.id, [
      {
        type: DeviceEventType.VIDEO_STATUS,
        occurredAt: uploadedAt,
        metadata: {
          ...baseVideo,
          at: uploadedAt,
          localStatus: 'UPLOADED',
          fsFileId: randomUUID(),
          fsStatus: 'SCANNING',
          error: null,
        },
      },
    ]);

    const readyAt = new Date().toISOString();
    await deviceEventService.recordBatch(device.id, campaign.id, [
      {
        type: DeviceEventType.VIDEO_STATUS,
        occurredAt: readyAt,
        metadata: {
          ...baseVideo,
          at: readyAt,
          localStatus: 'DONE',
          fsFileId: randomUUID(),
          fsStatus: 'READY',
          error: null,
        },
      },
    ]);

    // Arrives later over the wire but describes an earlier instant — must
    // not undo the READY status the newer event already recorded, same
    // high-water-mark rule as PHOTO_STATUS.
    const staleAt = new Date(Date.now() - 60_000).toISOString();
    await deviceEventService.recordBatch(device.id, campaign.id, [
      {
        type: DeviceEventType.VIDEO_STATUS,
        occurredAt: staleAt,
        metadata: {
          ...baseVideo,
          at: staleAt,
          localStatus: 'SENDING',
          fsFileId: null,
          fsStatus: 'FAILED',
          error: 'stale',
        },
      },
    ]);

    const detail = await sessionService.getSessionDetail(sessionId);
    expect(detail.videos[0].fsStatus).toBe('READY');
    expect(detail.videos[0].localStatus).toBe('DONE');
  });

  test('a VIDEO_STATUS missing videoId is rejected with a clear 400', async () => {
    const campaign = await campaignService.createCampaign({ name: 'Video C' });
    const { device } = await deviceService.registerDevice(campaign.id, {
      name: 'Kiosk V3',
    });

    await expect(
      deviceEventService.recordBatch(device.id, campaign.id, [
        {
          type: DeviceEventType.VIDEO_STATUS,
          occurredAt: new Date().toISOString(),
          metadata: {
            sessionId: randomUUID(),
            at: new Date().toISOString(),
            mimeType: 'video/webm',
            sizeBytes: 100,
            sha256: 'b'.repeat(64),
            virtualPath: 'video/2026/x/y.webm',
          },
        },
      ]),
    ).rejects.toMatchObject({
      payload: { code: ERROR_CODE.VIDEO_STATUS_INVALID_PAYLOAD },
    });
  });

  describe('ATTEMPT_SUPERSEDED — post-save retake cleanup (2026-09-08)', () => {
    test('deletes the stale photo row it names, leaving the session and its other photos alone', async () => {
      const campaign = await campaignService.createCampaign({ name: 'Supersede A' });
      const { device } = await deviceService.registerDevice(campaign.id, {
        name: 'Kiosk SA1',
      });

      const sessionId = randomUUID();
      const stalePhotoId = randomUUID();
      const keptPhotoId = randomUUID();
      const at = new Date().toISOString();

      await deviceEventService.recordBatch(device.id, campaign.id, [
        {
          type: DeviceEventType.SESSION_REPORT,
          occurredAt: at,
          metadata: {
            sessionId,
            approvedAt: at,
            photos: [
              {
                photoId: stalePhotoId,
                stepId: 'FRONT',
                attempt: 1,
                mimeType: 'image/jpeg',
                sizeBytes: 500,
                sha256: 'a'.repeat(64),
                virtualPath: `face/2026/${sessionId}/FRONT-1.jpg`,
              },
              {
                photoId: keptPhotoId,
                stepId: 'LEFT',
                attempt: 1,
                mimeType: 'image/jpeg',
                sizeBytes: 500,
                sha256: 'b'.repeat(64),
                virtualPath: `face/2026/${sessionId}/LEFT-1.jpg`,
              },
            ],
          },
        },
      ]);

      await deviceEventService.recordBatch(device.id, campaign.id, [
        {
          type: DeviceEventType.ATTEMPT_SUPERSEDED,
          occurredAt: new Date().toISOString(),
          metadata: { kind: 'photo', id: stalePhotoId },
        },
      ]);

      const detail = await sessionService.getSessionDetail(sessionId);
      const photoIds = detail.photos.map((p) => p.id);
      expect(photoIds).not.toContain(stalePhotoId);
      expect(photoIds).toContain(keptPhotoId);
    });

    test('deletes the stale video row it names', async () => {
      const campaign = await campaignService.createCampaign({ name: 'Supersede B' });
      const { device } = await deviceService.registerDevice(campaign.id, {
        name: 'Kiosk SB1',
      });

      const sessionId = randomUUID();
      const videoId = randomUUID();
      const at = new Date().toISOString();

      await deviceEventService.recordBatch(device.id, campaign.id, [
        {
          type: DeviceEventType.VIDEO_STATUS,
          occurredAt: at,
          metadata: {
            sessionId,
            videoId,
            at,
            mimeType: 'video/webm',
            sizeBytes: 1000,
            sha256: 'c'.repeat(64),
            virtualPath: `video/2026/${sessionId}/${videoId}.webm`,
          },
        },
      ]);

      let detail = await sessionService.getSessionDetail(sessionId);
      expect(detail.videos).toHaveLength(1);

      await deviceEventService.recordBatch(device.id, campaign.id, [
        {
          type: DeviceEventType.ATTEMPT_SUPERSEDED,
          occurredAt: new Date().toISOString(),
          metadata: { kind: 'video', id: videoId },
        },
      ]);

      detail = await sessionService.getSessionDetail(sessionId);
      expect(detail.videos).toHaveLength(0);
    });

    test('superseding an id that does not exist (or was already removed) is a harmless no-op', async () => {
      const campaign = await campaignService.createCampaign({ name: 'Supersede C' });
      const { device } = await deviceService.registerDevice(campaign.id, {
        name: 'Kiosk SC1',
      });

      await expect(
        deviceEventService.recordBatch(device.id, campaign.id, [
          {
            type: DeviceEventType.ATTEMPT_SUPERSEDED,
            occurredAt: new Date().toISOString(),
            metadata: { kind: 'photo', id: randomUUID() },
          },
        ]),
      ).resolves.toBe(1);
    });

    test('an ATTEMPT_SUPERSEDED with an invalid kind is rejected with a clear 400', async () => {
      const campaign = await campaignService.createCampaign({ name: 'Supersede D' });
      const { device } = await deviceService.registerDevice(campaign.id, {
        name: 'Kiosk SD1',
      });

      await expect(
        deviceEventService.recordBatch(device.id, campaign.id, [
          {
            type: DeviceEventType.ATTEMPT_SUPERSEDED,
            occurredAt: new Date().toISOString(),
            metadata: { kind: 'not-a-real-kind', id: randomUUID() },
          },
        ]),
      ).rejects.toMatchObject({
        payload: { code: ERROR_CODE.ATTEMPT_SUPERSEDED_INVALID_PAYLOAD },
      });
    });
  });

  test('a SESSION_REPORT missing sessionId is rejected with a clear 400', async () => {
    const campaign = await campaignService.createCampaign({ name: 'Report E' });
    const { device } = await deviceService.registerDevice(campaign.id, {
      name: 'Kiosk R5',
    });

    await expect(
      deviceEventService.recordBatch(device.id, campaign.id, [
        {
          type: DeviceEventType.SESSION_REPORT,
          occurredAt: new Date().toISOString(),
          metadata: { approvedAt: new Date().toISOString(), photos: [] },
        },
      ]),
    ).rejects.toMatchObject({
      payload: { error: expect.stringMatching(/sessionId/i) },
    });
  });

  test('listSessions filters by campaign, device, and derived state, and paginates', async () => {
    const campaign = await campaignService.createCampaign({
      name: 'List campaign',
    });
    const otherCampaign = await campaignService.createCampaign({
      name: 'Other campaign',
    });
    const { device: deviceA } = await deviceService.registerDevice(
      campaign.id,
      { name: 'List device A' },
    );
    const { device: deviceB } = await deviceService.registerDevice(
      campaign.id,
      { name: 'List device B' },
    );
    const { device: otherDevice } = await deviceService.registerDevice(
      otherCampaign.id,
      { name: 'Other device' },
    );

    const readySession = await reportFinishedSession(deviceA.id, campaign.id, {
      localStatus: 'DONE',
      fsStatus: 'READY',
    });
    const failedSession = await reportFinishedSession(deviceA.id, campaign.id, {
      localStatus: 'DONE',
      fsStatus: 'QUARANTINED',
    });
    const pendingSession = await reportFinishedSession(
      deviceB.id,
      campaign.id,
      { localStatus: 'UPLOADED', fsStatus: 'SCANNING' },
    );
    await reportFinishedSession(otherDevice.id, otherCampaign.id, {
      localStatus: 'DONE',
      fsStatus: 'READY',
    });

    const allForCampaign = await sessionService.listSessions({
      campaignId: campaign.id,
      page: 1,
      limit: 20,
    });
    expect(allForCampaign.items.map((i) => i.id).sort()).toEqual(
      [readySession, failedSession, pendingSession].sort(),
    );
    expect(
      allForCampaign.items.every((i) => i.campaignId === campaign.id),
    ).toBe(true);

    const forDeviceA = await sessionService.listSessions({
      campaignId: campaign.id,
      deviceId: deviceA.id,
      page: 1,
      limit: 20,
    });
    expect(forDeviceA.items.map((i) => i.id).sort()).toEqual(
      [readySession, failedSession].sort(),
    );

    const failedOnly = await sessionService.listSessions({
      campaignId: campaign.id,
      state: SessionListState.FAILED,
      page: 1,
      limit: 20,
    });
    expect(failedOnly.items.map((i) => i.id)).toEqual([failedSession]);

    const completedOnly = await sessionService.listSessions({
      campaignId: campaign.id,
      state: SessionListState.COMPLETED,
      page: 1,
      limit: 20,
    });
    expect(completedOnly.items.map((i) => i.id)).toEqual([readySession]);

    const pendingOnly = await sessionService.listSessions({
      campaignId: campaign.id,
      state: SessionListState.PENDING,
      page: 1,
      limit: 20,
    });
    expect(pendingOnly.items.map((i) => i.id)).toEqual([pendingSession]);

    const page1 = await sessionService.listSessions({
      campaignId: campaign.id,
      page: 1,
      limit: 2,
    });
    expect(page1.items).toHaveLength(2);
    expect(page1.meta.totalItems).toBe(3);
    expect(page1.meta.totalPages).toBe(2);
    expect(page1.meta.currentPage).toBe(1);

    const page2 = await sessionService.listSessions({
      campaignId: campaign.id,
      page: 2,
      limit: 2,
    });
    expect(page2.items).toHaveLength(1);
  });

  test('campaignStats aggregates sessions, photos, byDevice, and byDay', async () => {
    const campaign = await campaignService.createCampaign({
      name: 'Stats campaign',
    });
    const { device } = await deviceService.registerDevice(campaign.id, {
      name: 'Stats device',
    });

    await reportFinishedSession(device.id, campaign.id, {
      localStatus: 'DONE',
      fsStatus: 'READY',
    });
    await reportFinishedSession(device.id, campaign.id, {
      localStatus: 'DONE',
      fsStatus: 'READY',
    });
    await reportFinishedSession(device.id, campaign.id, {
      localStatus: 'DONE',
      fsStatus: 'QUARANTINED',
    });

    const stats = await deviceEventService.campaignStats(campaign.id);
    expect(stats.sessions).toBe(3);
    expect(stats.photos.total).toBe(3);
    expect(stats.photos.ready).toBe(2);
    expect(stats.photos.failed).toBe(1);
    expect(stats.photos.pending).toBe(0);

    expect(stats.byDevice).toHaveLength(1);
    expect(stats.byDevice[0].deviceId).toBe(device.id);
    expect(stats.byDevice[0].sessions).toBe(3);
    expect(stats.byDevice[0].photosReady).toBe(2);
    expect(stats.byDevice[0].photosFailed).toBe(1);
    expect(stats.byDevice[0].lastCaptureAt).toBeTruthy();

    expect(stats.byDay.length).toBeGreaterThanOrEqual(1);
    const today = stats.byDay.reduce((sum, d) => sum + d.sessions, 0);
    expect(today).toBe(3);

    // allCampaignsStats must fold this campaign's numbers into its totals
    // without needing a second, per-campaign call (see the service's own
    // doc comment on why that matters).
    const campaigns = await campaignService.findAllCampaigns();
    const all = await deviceEventService.allCampaignsStats(
      campaigns.map((c) => ({ id: c.id, name: c.name })),
    );
    expect(all.totalSessions).toBeGreaterThanOrEqual(3);
    expect(all.totalPhotos.total).toBeGreaterThanOrEqual(3);
    const summaryItem = all.campaigns.find((c) => c.campaignId === campaign.id);
    expect(summaryItem?.sessions).toBe(3);
    expect(summaryItem?.photos.ready).toBe(2);
    expect(summaryItem?.byDevice).toHaveLength(1);
  });

  test('campaignsTimeseries buckets SESSION_COMPLETED/UPLOAD_SUCCESS/UPLOAD_FAILED/RETAKE events by day across every campaign', async () => {
    const campaign = await campaignService.createCampaign({
      name: 'Timeseries campaign',
    });
    const { device } = await deviceService.registerDevice(campaign.id, {
      name: 'Timeseries device',
    });

    const now = new Date().toISOString();
    await deviceEventService.recordBatch(device.id, campaign.id, [
      { type: DeviceEventType.SESSION_COMPLETED, occurredAt: now },
      { type: DeviceEventType.SESSION_COMPLETED, occurredAt: now },
      { type: DeviceEventType.UPLOAD_SUCCESS, occurredAt: now },
      { type: DeviceEventType.UPLOAD_FAILED, occurredAt: now },
      { type: DeviceEventType.RETAKE, occurredAt: now },
      { type: DeviceEventType.RETAKE, occurredAt: now },
      { type: DeviceEventType.RETAKE, occurredAt: now },
    ]);

    const series = await deviceEventService.campaignsTimeseries(14);
    // Every requested day is present, even ones with zero events — no gaps.
    expect(series.points).toHaveLength(14);

    // Other tests in this file also record events "now", for other
    // campaigns — same reasoning as allCampaignsStats' own assertions above,
    // this is a global (cross-campaign) aggregate, so today's bucket can only
    // be checked with a floor, not an exact count.
    const today = series.points[series.points.length - 1];
    expect(today.sessionsCompleted).toBeGreaterThanOrEqual(2);
    expect(today.uploadsSuccess).toBeGreaterThanOrEqual(1);
    expect(today.uploadsFailed).toBeGreaterThanOrEqual(1);
    expect(today.retakes).toBeGreaterThanOrEqual(3);

    const dates = series.points.map((p) => p.date);
    expect(new Set(dates).size).toBe(dates.length);
    expect(dates).toEqual([...dates].sort());
  });

  test('deleting a campaign with no devices or sessions succeeds', async () => {
    const campaign = await campaignService.createCampaign({
      name: 'Delete me - empty',
    });

    await campaignService.deleteCampaign(campaign.id);

    await expect(
      campaignService.findCampaignOrFail(campaign.id),
    ).rejects.toMatchObject({
      payload: { code: ERROR_CODE.CAMPAIGN_NOT_FOUND },
    });
  });

  test('deleting a campaign that still has a device is refused with CAMPAIGN_HAS_DEPENDENCIES', async () => {
    const campaign = await campaignService.createCampaign({
      name: 'Delete me - has device',
    });
    await deviceService.registerDevice(campaign.id, { name: 'Kiosk D1' });

    await expect(
      campaignService.deleteCampaign(campaign.id),
    ).rejects.toMatchObject({
      payload: { code: ERROR_CODE.CAMPAIGN_HAS_DEPENDENCIES },
    });

    // Refused, not partially applied - the campaign must still exist.
    const stillThere = await campaignService.findCampaignOrFail(campaign.id);
    expect(stillThere.id).toBe(campaign.id);
  });

  test('deleting a campaign that still has a capture session (device already gone) is refused too', async () => {
    const campaign = await campaignService.createCampaign({
      name: 'Delete me - has session only',
    });
    const { device } = await deviceService.registerDevice(campaign.id, {
      name: 'Kiosk D2',
    });
    await reportFinishedSession(device.id, campaign.id, {
      localStatus: 'DONE',
      fsStatus: 'READY',
    });

    // Deleting the device itself isn't exercised here (no device-delete
    // endpoint exists yet - see deleteCampaign's own doc comment) - this
    // test only needs a session to exist under the campaign, which
    // `reportFinishedSession` already guarantees regardless of the device.
    await expect(
      campaignService.deleteCampaign(campaign.id),
    ).rejects.toMatchObject({
      payload: { code: ERROR_CODE.CAMPAIGN_HAS_DEPENDENCIES },
    });
  });

  describe('StudentService — "sinh viên đã chụp" (2026-09-08)', () => {
    test('listStudents groups sessions by subjectCode across campaigns, excluding sessions with none', async () => {
      const campaignA = await campaignService.createCampaign({ name: 'Student List A' });
      const campaignB = await campaignService.createCampaign({ name: 'Student List B' });
      const { device: deviceA } = await deviceService.registerDevice(campaignA.id, { name: 'Kiosk SLA' });
      const { device: deviceB } = await deviceService.registerDevice(campaignB.id, { name: 'Kiosk SLB' });

      const reportSession = async (deviceId: string, campaignId: string, subjectCode: string | null) => {
        const sessionId = randomUUID();
        const at = new Date().toISOString();
        await deviceEventService.recordBatch(deviceId, campaignId, [
          {
            type: DeviceEventType.SESSION_REPORT,
            occurredAt: at,
            metadata: {
              sessionId,
              approvedAt: at,
              subjectCode: subjectCode ?? undefined,
              subjectName: subjectCode ? 'Nguyễn Văn An' : undefined,
              photos: [
                {
                  photoId: randomUUID(),
                  stepId: 'FRONT',
                  attempt: 1,
                  mimeType: 'image/jpeg',
                  sizeBytes: 500,
                  sha256: randomUUID().replace(/-/g, '').padEnd(64, '0'),
                  virtualPath: `face/2026/${sessionId}/FRONT-1.jpg`,
                },
              ],
            },
          },
        ]);
        return sessionId;
      };

      // Same student, two campaigns — must be counted as one row with
      // sessionCount 2 across both, not two separate rows.
      await reportSession(deviceA.id, campaignA.id, 'SV_LIST_01');
      await reportSession(deviceB.id, campaignB.id, 'SV_LIST_01');
      // A different student, only in campaign A.
      await reportSession(deviceA.id, campaignA.id, 'SV_LIST_02');
      // No subjectCode at all — must never appear in the list.
      await reportSession(deviceA.id, campaignA.id, null);

      const allResults = await studentService.listStudents({ page: 1, limit: 50 });
      const codes = allResults.items.map((i) => i.subjectCode);
      expect(codes).toContain('SV_LIST_01');
      expect(codes).toContain('SV_LIST_02');

      const sv1 = allResults.items.find((i) => i.subjectCode === 'SV_LIST_01')!;
      expect(sv1.sessionCount).toBe(2);
      expect(sv1.totalPhotos).toBe(2);
      expect(sv1.campaignIds.sort()).toEqual([campaignA.id, campaignB.id].sort());

      // Filtered to campaign A only: SV_LIST_01's aggregate narrows to just
      // that campaign's one session, not its global total of 2.
      const filteredA = await studentService.listStudents({ page: 1, limit: 50, campaignId: campaignA.id });
      const sv1FilteredA = filteredA.items.find((i) => i.subjectCode === 'SV_LIST_01')!;
      expect(sv1FilteredA.sessionCount).toBe(1);
      expect(filteredA.items.map((i) => i.subjectCode)).toContain('SV_LIST_02');

      // SV_LIST_02 never appeared in campaign B — filtering to B must not
      // show them at all, not show them with a zeroed-out count.
      const filteredB = await studentService.listStudents({ page: 1, limit: 50, campaignId: campaignB.id });
      expect(filteredB.items.map((i) => i.subjectCode)).not.toContain('SV_LIST_02');
    });

    test('getStudentDetail returns every session across every campaign, ignoring any list-page campaign filter', async () => {
      const campaignA = await campaignService.createCampaign({ name: 'Student Detail A' });
      const campaignB = await campaignService.createCampaign({ name: 'Student Detail B' });
      const { device: deviceA } = await deviceService.registerDevice(campaignA.id, { name: 'Kiosk SDA' });
      const { device: deviceB } = await deviceService.registerDevice(campaignB.id, { name: 'Kiosk SDB' });

      const subjectCode = 'SV_DETAIL_01';
      for (const [device, campaign] of [
        [deviceA, campaignA],
        [deviceB, campaignB],
      ] as const) {
        const sessionId = randomUUID();
        const at = new Date().toISOString();
        await deviceEventService.recordBatch(device.id, campaign.id, [
          {
            type: DeviceEventType.SESSION_REPORT,
            occurredAt: at,
            metadata: {
              sessionId,
              approvedAt: at,
              subjectCode,
              subjectName: 'Trần Thị Bình',
              photos: [
                {
                  photoId: randomUUID(),
                  stepId: 'FRONT',
                  attempt: 1,
                  mimeType: 'image/jpeg',
                  sizeBytes: 500,
                  sha256: randomUUID().replace(/-/g, '').padEnd(64, '0'),
                  virtualPath: `face/2026/${sessionId}/FRONT-1.jpg`,
                },
              ],
            },
          },
        ]);
      }

      const detail = await studentService.getStudentDetail(subjectCode);
      expect(detail.subjectCode).toBe(subjectCode);
      expect(detail.subjectName).toBe('Trần Thị Bình');
      expect(detail.sessions).toHaveLength(2);
      const campaignIds = detail.sessions.map((s) => s.campaignId).sort();
      expect(campaignIds).toEqual([campaignA.id, campaignB.id].sort());
      // No fsFileId on any photo in this fixture, so no view-link call
      // should have produced a value — best-effort resolution just leaves
      // viewUrl empty rather than failing the whole request.
      for (const session of detail.sessions) {
        expect(session.photos).toHaveLength(1);
        expect(session.photos[0].viewUrl).toBeUndefined();
      }
    });

    test('getStudentDetail throws STUDENT_NOT_FOUND for a code with no sessions', async () => {
      await expect(studentService.getStudentDetail('SV_DOES_NOT_EXIST')).rejects.toMatchObject({
        payload: { code: ERROR_CODE.STUDENT_NOT_FOUND },
      });
    });
  });
});
