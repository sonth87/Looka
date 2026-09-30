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
    // operator_user_id's conflict behaviour. Exercised here with a SECOND
    // photo from the SAME device/campaign (unlike the test below, which
    // covers a different device/campaign — now rejected outright, see its
    // own doc comment) so this still proves the DO-NOTHING contract for
    // device_id/campaign_id/status without relying on rejected behaviour.
    const sessionId = randomUUID();
    await photoService.addDevicePhoto(deviceId, campaignId, {
      photoId: randomUUID(),
      sessionId,
      stepId: 'FRONT',
      attempt: 1,
      dataUrl: jpegDataUrl(1),
    });

    await photoService.addDevicePhoto(deviceId, campaignId, {
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

  test('addDevicePhoto rejects a sessionId that belongs to a different device/campaign (2026-09-24 fix, confirmed audit finding — cross-device session hijack)', async () => {
    const sessionId = randomUUID();
    await photoService.addDevicePhoto(deviceId, campaignId, {
      photoId: randomUUID(),
      sessionId,
      stepId: 'FRONT',
      attempt: 1,
      dataUrl: jpegDataUrl(1),
    });

    // A second campaign+device pair, distinct from the session's real one —
    // session ids are visible to every device in a campaign via
    // GET /v1/devices/recent-captures, so a device holding valid credentials
    // for some OTHER session/campaign must never be able to attach its own
    // photo to this one.
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

    await expect(
      photoService.addDevicePhoto(otherDevice.id, otherCampaign.id, {
        photoId: randomUUID(),
        sessionId,
        stepId: 'LEFT',
        attempt: 1,
        dataUrl: jpegDataUrl(2),
      }),
    ).rejects.toThrow();

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

    // The rejected call must also never have created a `photos` row for the
    // other device's attempted write.
    const photoRows: Array<Record<string, unknown>> = await dataSource.query(
      `SELECT 1 FROM photos WHERE session_id = $1 AND step_id = $2`,
      [sessionId, 'LEFT'],
    );
    expect(photoRows.length).toBe(0);
  });

  describe('addDevicePhotos (1-n, POST /v1/devices/photos batch)', () => {
    const outboxCount = async (photoId: string): Promise<number> => {
      const rows: Array<{ count: number }> = await dataSource.query(
        `SELECT COUNT(*)::int AS count FROM upload_outbox WHERE photo_id = $1`,
        [photoId],
      );
      return rows[0].count;
    };

    const photoRowCount = async (photoId: string): Promise<number> => {
      const rows: Array<{ count: number }> = await dataSource.query(
        `SELECT COUNT(*)::int AS count FROM photos WHERE id = $1`,
        [photoId],
      );
      return rows[0].count;
    };

    test('two photos of the SAME session in one call both persist, each with its outbox row', async () => {
      const sessionId = randomUUID();
      const a = randomUUID();
      const b = randomUUID();

      const res = await photoService.addDevicePhotos(deviceId, campaignId, [
        {
          photoId: a,
          sessionId,
          stepId: 'FRONT',
          attempt: 1,
          dataUrl: jpegDataUrl(1),
        },
        {
          photoId: b,
          sessionId,
          stepId: 'LEFT',
          attempt: 1,
          dataUrl: jpegDataUrl(2),
        },
      ]);

      expect(res).toMatchObject({ requested: 2, succeeded: 2, failed: 0 });
      expect(res.results.map((r) => [r.photoId, r.ok])).toEqual([
        [a, true],
        [b, true],
      ]);
      expect(await photoRowCount(a)).toBe(1);
      expect(await photoRowCount(b)).toBe(1);
      expect(await outboxCount(a)).toBe(1);
      expect(await outboxCount(b)).toBe(1);
      const sessions: Array<{ count: number }> = await dataSource.query(
        `SELECT COUNT(*)::int AS count FROM sessions WHERE id = $1`,
        [sessionId],
      );
      expect(sessions[0].count).toBe(1);
    });

    test('a bad dataUrl next to a good photo gives a per-item 400 while the good one persists', async () => {
      const sessionId = randomUUID();
      const bad = randomUUID();
      const good = randomUUID();

      const res = await photoService.addDevicePhotos(deviceId, campaignId, [
        {
          photoId: bad,
          sessionId,
          stepId: 'FRONT',
          attempt: 1,
          dataUrl: 'not a data url',
        },
        {
          photoId: good,
          sessionId,
          stepId: 'LEFT',
          attempt: 1,
          dataUrl: jpegDataUrl(2),
        },
      ]);

      expect(res).toMatchObject({ requested: 2, succeeded: 1, failed: 1 });
      expect(res.results[0]).toMatchObject({
        photoId: bad,
        ok: false,
        statusCode: 400,
      });
      expect(res.results[1]).toMatchObject({ photoId: good, ok: true });
      expect(await photoRowCount(bad)).toBe(0);
      expect(await photoRowCount(good)).toBe(1);
    });

    test("another device's session gives a per-item 403 and plants nothing, while the caller's own photo in the same call persists", async () => {
      const foreignSession = randomUUID();
      await photoService.addDevicePhoto(deviceId, campaignId, {
        photoId: randomUUID(),
        sessionId: foreignSession,
        stepId: 'FRONT',
        attempt: 1,
        dataUrl: jpegDataUrl(1),
      });

      const [otherCampaign]: Array<{ id: string }> = await dataSource.query(
        `INSERT INTO campaigns (name) VALUES ($1) RETURNING id`,
        [`add-device-photos-other-${randomUUID()}`],
      );
      const [otherDevice]: Array<{ id: string }> = await dataSource.query(
        `INSERT INTO devices (campaign_id, name, device_secret_hash) VALUES ($1, $2, $3) RETURNING id`,
        [
          otherCampaign.id,
          `add-device-photos-other-${randomUUID()}`,
          'z'.repeat(64),
        ],
      );
      const hijack = randomUUID();
      const own = randomUUID();

      const res = await photoService.addDevicePhotos(
        otherDevice.id,
        otherCampaign.id,
        [
          {
            photoId: hijack,
            sessionId: foreignSession,
            stepId: 'LEFT',
            attempt: 1,
            dataUrl: jpegDataUrl(2),
          },
          {
            photoId: own,
            sessionId: randomUUID(),
            stepId: 'FRONT',
            attempt: 1,
            dataUrl: jpegDataUrl(3),
          },
        ],
      );

      expect(res).toMatchObject({ succeeded: 1, failed: 1 });
      expect(res.results[0]).toMatchObject({
        photoId: hijack,
        ok: false,
        statusCode: 403,
      });
      expect(res.results[1]).toMatchObject({ photoId: own, ok: true });
      expect(await photoRowCount(hijack)).toBe(0);
      expect(await outboxCount(hijack)).toBe(0);
      expect(await photoRowCount(own)).toBe(1);
    });

    test('re-sending the same batch (kiosk retry after a lost response) is idempotent: still one photo row and one outbox row each', async () => {
      const sessionId = randomUUID();
      const items = [
        {
          photoId: randomUUID(),
          sessionId,
          stepId: 'FRONT',
          attempt: 1,
          dataUrl: jpegDataUrl(1),
        },
        {
          photoId: randomUUID(),
          sessionId,
          stepId: 'LEFT',
          attempt: 1,
          dataUrl: jpegDataUrl(2),
        },
      ];

      await photoService.addDevicePhotos(deviceId, campaignId, items);
      const second = await photoService.addDevicePhotos(
        deviceId,
        campaignId,
        items,
      );

      expect(second).toMatchObject({ succeeded: 2, failed: 0 });
      for (const item of items) {
        expect(await photoRowCount(item.photoId)).toBe(1);
        expect(await outboxCount(item.photoId)).toBe(1);
      }
    });
  });
});
