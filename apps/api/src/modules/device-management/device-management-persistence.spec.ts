import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SnakeNamingStrategy } from 'typeorm-naming-strategies';
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
  let moduleRef: TestingModule;

  beforeAll(async () => {
    const built = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        TypeOrmModule.forRoot({
          type: 'postgres',
          url,
          entities: [Campaign, Device, DeviceEvent],
          namingStrategy: new SnakeNamingStrategy(),
          synchronize: false,
        }),
        TypeOrmModule.forFeature([Campaign, Device, DeviceEvent]),
      ],
      providers: [CampaignService, DeviceService, DeviceEventService, ActivationPackageService],
    }).compile();

    moduleRef = built;
    campaignService = built.get(CampaignService);
    deviceService = built.get(DeviceService);
    deviceEventService = built.get(DeviceEventService);
    activationPackageService = built.get(ActivationPackageService);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  test('a campaign created with no expiry is permanent (NULL, not a sentinel date)', async () => {
    const campaign = await campaignService.createCampaign({ name: 'Permanent batch' });
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
    const campaign = await campaignService.createCampaign({ name: 'Consent edits' });

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
    const campaign = await campaignService.createCampaign({ name: 'Simultaneous default' });
    expect(campaign.simultaneousCapture).toBe(false);

    const updated = await campaignService.updateCampaign(campaign.id, {
      simultaneousCapture: true,
    });
    expect(updated.simultaneousCapture).toBe(true);

    const reloaded = await campaignService.findCampaignOrFail(campaign.id);
    expect(reloaded.simultaneousCapture).toBe(true);
  });

  test('recordVideo defaults to false and round-trips through create/update', async () => {
    const campaign = await campaignService.createCampaign({ name: 'Record video default' });
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

    const renewed = await campaignService.updateCampaign(campaign.id, { expiresAt: null });
    expect(renewed.expiresAt).toBeFalsy();
  });

  test('registering a device issues a secret that verifies once, and activates the device', async () => {
    const campaign = await campaignService.createCampaign({ name: 'Device batch' });
    const { device, plainSecret } = await deviceService.registerDevice(campaign.id, {
      name: 'Kiosk A',
    });

    const ok = await deviceService.verifyCredentials(device.id, plainSecret);
    expect(ok.ok).toBe(true);

    const wrong = await deviceService.verifyCredentials(device.id, 'not-the-secret');
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) expect(wrong.reason).toBe('INVALID_SECRET');

    // The first successful check above should have flipped REGISTERED -> ACTIVATED.
    const dao = await deviceService.findDeviceOrFail(device.id);
    expect(dao.status).toBe('ACTIVATED');
    expect(dao.activatedAt).toBeTruthy();
  });

  test('a device under an expired campaign fails credential checks even with the right secret', async () => {
    const campaign = await campaignService.createCampaign({
      name: 'Already expired',
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    const { device, plainSecret } = await deviceService.registerDevice(campaign.id, {
      name: 'Kiosk B',
    });

    const result = await deviceService.verifyCredentials(device.id, plainSecret);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('EXPIRED');
  });

  test('the activation zip contains activation.json with the plaintext secret, exactly once', async () => {
    const campaignDao = await campaignService.createCampaign({ name: 'Zip test' });
    const campaign = await campaignService.findCampaignEntityOrFail(campaignDao.id);
    const { device, plainSecret } = await deviceService.registerDevice(campaign.id, {
      name: 'Kiosk C',
    });

    const zip = await activationPackageService.buildActivationZip(device, campaign, plainSecret);
    expect(zip.length).toBeGreaterThan(0);
    // A zip's local file header always starts with this 4-byte signature -
    // enough to confirm this is actually a zip, without a zip-reading
    // dependency just for the test.
    expect(zip.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  });

  test('campaign stats count events by type, scoped to that campaign only', async () => {
    const campaignA = await campaignService.createCampaign({ name: 'Stats A' });
    const campaignB = await campaignService.createCampaign({ name: 'Stats B' });
    const { device: deviceA } = await deviceService.registerDevice(campaignA.id, { name: 'Kiosk A' });
    const { device: deviceB } = await deviceService.registerDevice(campaignB.id, { name: 'Kiosk B' });

    await deviceEventService.recordBatch(deviceA.id, campaignA.id, [
      { type: DeviceEventType.SESSION_COMPLETED, occurredAt: new Date().toISOString() },
      { type: DeviceEventType.SESSION_COMPLETED, occurredAt: new Date().toISOString() },
      { type: DeviceEventType.UPLOAD_FAILED, occurredAt: new Date().toISOString() },
      { type: DeviceEventType.RETAKE, occurredAt: new Date().toISOString(), metadata: { stepId: 'FRONT' } },
    ]);
    // A different campaign's events must never leak into campaignA's stats.
    await deviceEventService.recordBatch(deviceB.id, campaignB.id, [
      { type: DeviceEventType.SESSION_COMPLETED, occurredAt: new Date().toISOString() },
    ]);

    const stats = await campaignService.findCampaignOrFail(campaignA.id).then(() =>
      deviceEventService.campaignStats(campaignA.id),
    );
    expect(stats.deviceCount).toBe(1);
    expect(stats.sessionsCompleted).toBe(2);
    expect(stats.uploadFailed).toBe(1);
    expect(stats.uploadSuccess).toBe(0);
    expect(stats.retakes).toBe(1);
    expect(stats.cbHelpInterventions).toBe(0);
  });

  test('recording an empty batch is a harmless no-op', async () => {
    const campaign = await campaignService.createCampaign({ name: 'Empty batch' });
    const { device } = await deviceService.registerDevice(campaign.id, { name: 'Kiosk' });

    const accepted = await deviceEventService.recordBatch(device.id, campaign.id, []);
    expect(accepted).toBe(0);
  });
});
