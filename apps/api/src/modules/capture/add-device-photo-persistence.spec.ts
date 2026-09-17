import { randomUUID } from 'node:crypto';
import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { SnakeNamingStrategy } from 'typeorm-naming-strategies';
import { Photo } from './entities/photo.entity';
import { Session } from './entities/session.entity';
import { UploadOutboxEntry } from './entities/upload-outbox.entity';
import { PhotoService } from './services/photo.service';
import { SessionService } from './services/session.service';

/**
 * Runs against a real Postgres, same reasoning as capture-persistence.spec.ts
 * and capture-report-persistence.spec.ts: what is being checked is a real
 * `ON CONFLICT ... DO UPDATE` upsert behaviour, not something a mocked
 * repository could prove. Skipped when TEST_DATABASE_URL is absent; schema
 * must already be migrated (`pnpm typeorm:run-migrations` against
 * TEST_DATABASE_URL) first.
 *
 * `sessions.device_id`/`campaign_id` carry real FKs into device-management's
 * `devices`/`campaigns` tables (see `CaptureRecords1787900000000`), so each
 * test seeds a throwaway campaign+device pair with plain SQL rather than
 * importing that module's entities/services here — same pattern
 * capture-report-persistence.spec.ts already uses for the exact same reason.
 *
 * A separate file from capture-persistence.spec.ts (rather than extending
 * it) so this narrowly-scoped addition — 2026-09-17, "theo dõi ai chụp/ai
 * upload" — cannot collide with that file's own module setup while other
 * work happens in this same area concurrently.
 */
const url = process.env.TEST_DATABASE_URL;
const describeDb = url ? describe : describe.skip;

describeDb('addDevicePhoto session upsert (PhotoService)', () => {
  let photoService: PhotoService;
  let dataSource: DataSource;
  let moduleRef: TestingModule;
  let deviceId: string;
  let campaignId: string;

  beforeAll(async () => {
    const built = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        TypeOrmModule.forRoot({
          type: 'postgres',
          url,
          entities: [Session, Photo, UploadOutboxEntry],
          namingStrategy: new SnakeNamingStrategy(),
          synchronize: false,
        }),
        TypeOrmModule.forFeature([Session, Photo, UploadOutboxEntry]),
      ],
      providers: [
        PhotoService,
        // addDevicePhoto() never touches this.sessionService (only addPhoto,
        // the web-path sibling, does) — a bare stub is enough to satisfy DI
        // without pulling in SessionService's own PhotoReviewService/
        // CaptureStatsService dependencies, which are irrelevant here.
        { provide: SessionService, useValue: {} },
      ],
    }).compile();

    moduleRef = built;
    photoService = built.get(PhotoService);
    dataSource = built.get(DataSource);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  beforeEach(async () => {
    const [campaign] = await dataSource.query(
      `INSERT INTO campaigns (name) VALUES ($1) RETURNING id`,
      [`add-device-photo-spec-${randomUUID()}`],
    );
    campaignId = campaign.id;
    const [device] = await dataSource.query(
      `INSERT INTO devices (campaign_id, name, device_secret_hash) VALUES ($1, $2, $3) RETURNING id`,
      [campaignId, `add-device-photo-spec-${randomUUID()}`, 'x'.repeat(64)],
    );
    deviceId = device.id;
  });

  const jpegDataUrl = (byte: number) =>
    `data:image/jpeg;base64,${Buffer.from([byte, byte, byte, byte]).toString('base64')}`;

  const operatorUserIdOf = async (
    sessionId: string,
  ): Promise<string | null> => {
    const rows: Array<{ operator_user_id: string | null }> =
      await dataSource.query(
        `SELECT operator_user_id FROM sessions WHERE id = $1`,
        [sessionId],
      );
    return rows[0]?.operator_user_id ?? null;
  };

  test('the first photo of a session sets operator_user_id on the session it creates', async () => {
    const sessionId = randomUUID();
    const operatorUserId = randomUUID();

    await photoService.addDevicePhoto(deviceId, campaignId, {
      photoId: randomUUID(),
      sessionId,
      stepId: 'FRONT',
      attempt: 1,
      dataUrl: jpegDataUrl(1),
      operatorUserId,
    });

    expect(await operatorUserIdOf(sessionId)).toBe(operatorUserId);
  });

  test('a later photo of the same session that omits operatorUserId does not regress an already-set value', async () => {
    // Mirrors capture-report-persistence.spec.ts's "operatorUserId from a
    // SESSION_REPORT is stored, and a later report that omits it does not
    // regress it" — same COALESCE-non-regression contract, exercised at the
    // earlier addDevicePhoto write path instead of the later SESSION_REPORT
    // one.
    const sessionId = randomUUID();
    const operatorUserId = randomUUID();

    await photoService.addDevicePhoto(deviceId, campaignId, {
      photoId: randomUUID(),
      sessionId,
      stepId: 'FRONT',
      attempt: 1,
      dataUrl: jpegDataUrl(1),
      operatorUserId,
    });
    expect(await operatorUserIdOf(sessionId)).toBe(operatorUserId);

    await photoService.addDevicePhoto(deviceId, campaignId, {
      photoId: randomUUID(),
      sessionId,
      stepId: 'LEFT',
      attempt: 1,
      dataUrl: jpegDataUrl(2),
      // No operatorUserId this time — an older kiosk build, or a retry that
      // for whatever reason lost the value — must never null out (or
      // overwrite with a different id) what the first photo already set.
    });
    expect(await operatorUserIdOf(sessionId)).toBe(operatorUserId);
  });

  test('a later photo of the same session with a DIFFERENT operatorUserId still does not overwrite the first one', async () => {
    const sessionId = randomUUID();
    const firstOperator = randomUUID();
    const secondOperator = randomUUID();

    await photoService.addDevicePhoto(deviceId, campaignId, {
      photoId: randomUUID(),
      sessionId,
      stepId: 'FRONT',
      attempt: 1,
      dataUrl: jpegDataUrl(1),
      operatorUserId: firstOperator,
    });
    await photoService.addDevicePhoto(deviceId, campaignId, {
      photoId: randomUUID(),
      sessionId,
      stepId: 'LEFT',
      attempt: 1,
      dataUrl: jpegDataUrl(2),
      operatorUserId: secondOperator,
    });

    expect(await operatorUserIdOf(sessionId)).toBe(firstOperator);
  });

  test('operatorUserId absent from every photo of a session leaves the column null - the no-op case', async () => {
    const sessionId = randomUUID();

    await photoService.addDevicePhoto(deviceId, campaignId, {
      photoId: randomUUID(),
      sessionId,
      stepId: 'FRONT',
      attempt: 1,
      dataUrl: jpegDataUrl(1),
    });

    expect(await operatorUserIdOf(sessionId)).toBeNull();
  });

  test("addDevicePhoto's session upsert leaves other columns' DO-NOTHING behaviour unchanged (device_id/campaign_id/status are not overwritten on conflict)", async () => {
    // Guards against a regression where widening the upsert to DO UPDATE for
    // operator_user_id accidentally widened it for every other column too —
    // the task this change implements explicitly calls for touching ONLY
    // operator_user_id's conflict behaviour.
    const sessionId = randomUUID();
    await photoService.addDevicePhoto(deviceId, campaignId, {
      photoId: randomUUID(),
      sessionId,
      stepId: 'FRONT',
      attempt: 1,
      dataUrl: jpegDataUrl(1),
    });

    // A second campaign+device pair, distinct from the session's real one.
    const [otherCampaign] = await dataSource.query(
      `INSERT INTO campaigns (name) VALUES ($1) RETURNING id`,
      [`add-device-photo-spec-other-${randomUUID()}`],
    );
    const [otherDevice] = await dataSource.query(
      `INSERT INTO devices (campaign_id, name, device_secret_hash) VALUES ($1, $2, $3) RETURNING id`,
      [
        otherCampaign.id,
        `add-device-photo-spec-other-${randomUUID()}`,
        'y'.repeat(64),
      ],
    );

    await photoService.addDevicePhoto(otherDevice.id, otherCampaign.id, {
      photoId: randomUUID(),
      sessionId,
      stepId: 'LEFT',
      attempt: 1,
      dataUrl: jpegDataUrl(2),
    });

    const rows: Array<{
      device_id: string;
      campaign_id: string;
      status: string;
    }> = await dataSource.query(
      `SELECT device_id, campaign_id, status FROM sessions WHERE id = $1`,
      [sessionId],
    );
    expect(rows[0].device_id).toBe(deviceId);
    expect(rows[0].campaign_id).toBe(campaignId);
    expect(rows[0].status).toBe('IN_PROGRESS');
  });
});
