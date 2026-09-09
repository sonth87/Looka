import { randomUUID } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { SnakeNamingStrategy } from 'typeorm-naming-strategies';
import { Photo } from './entities/photo.entity';
import { Session } from './entities/session.entity';
import { UploadOutboxEntry } from './entities/upload-outbox.entity';
import { CaptureReportService } from './services/capture-report.service';

/**
 * Runs against a real Postgres, same reasoning as capture-persistence.spec.ts:
 * `applySessionReport`'s COALESCE-non-regression upsert is a database
 * behaviour, not something a mocked repository could prove. Skipped when
 * TEST_DATABASE_URL is absent; schema must already be migrated
 * (`pnpm typeorm:run-migrations` against TEST_DATABASE_URL) first.
 *
 * `sessions.device_id`/`campaign_id` carry real FKs into device-management's
 * `devices`/`campaigns` tables (see `CaptureRecords1787900000000`), so each
 * test seeds a throwaway campaign+device pair with plain SQL rather than
 * importing that module's entities/services here — this file stays entirely
 * inside `apps/api/src/modules/capture/**`.
 */
const url = process.env.TEST_DATABASE_URL;
const describeDb = url ? describe : describe.skip;

describeDb('capture report persistence (CaptureReportService)', () => {
  let captureReportService: CaptureReportService;
  let dataSource: DataSource;
  let moduleRef: TestingModule;
  let deviceId: string;
  let campaignId: string;

  beforeAll(async () => {
    const built = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({
          type: 'postgres',
          url,
          entities: [Session, Photo, UploadOutboxEntry],
          namingStrategy: new SnakeNamingStrategy(),
          synchronize: false,
        }),
        TypeOrmModule.forFeature([Session, Photo, UploadOutboxEntry]),
      ],
      providers: [CaptureReportService],
    }).compile();

    moduleRef = built;
    captureReportService = built.get(CaptureReportService);
    dataSource = built.get(DataSource);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  beforeEach(async () => {
    const [campaign] = await dataSource.query(
      `INSERT INTO campaigns (name) VALUES ($1) RETURNING id`,
      [`capture-report-spec-${randomUUID()}`],
    );
    campaignId = campaign.id;
    const [device] = await dataSource.query(
      `INSERT INTO devices (campaign_id, name, device_secret_hash) VALUES ($1, $2, $3) RETURNING id`,
      [campaignId, `capture-report-spec-${randomUUID()}`, 'x'.repeat(64)],
    );
    deviceId = device.id;
  });

  const sha256 = () => randomUUID().replace(/-/g, '').padEnd(64, '0');

  const applyReport = (metadata: Record<string, unknown>) =>
    dataSource.transaction((manager) =>
      captureReportService.applySessionReport(
        manager,
        deviceId,
        campaignId,
        metadata,
      ),
    );

  test('operatorUserId from a SESSION_REPORT is stored, and a later report that omits it does not regress it', async () => {
    const sessionId = randomUUID();
    const operatorUserId = randomUUID();
    const startedAt = new Date().toISOString();

    await applyReport({
      sessionId,
      startedAt,
      approvedAt: startedAt,
      operatorUserId,
      photos: [],
    });

    let row = (
      await dataSource.query(
        `SELECT operator_user_id FROM sessions WHERE id = $1`,
        [sessionId],
      )
    )[0];
    expect(row.operator_user_id).toBe(operatorUserId);

    // Same COALESCE-non-regression contract as subject_code/subject_name: a
    // resend (or a late-arriving report from a code path that never learned
    // the operator) that omits operatorUserId must not null out what an
    // earlier report already recorded.
    await applyReport({
      sessionId,
      approvedAt: new Date().toISOString(),
      photos: [],
    });

    row = (
      await dataSource.query(
        `SELECT operator_user_id FROM sessions WHERE id = $1`,
        [sessionId],
      )
    )[0];
    expect(row.operator_user_id).toBe(operatorUserId);
  });

  test('operatorUserId absent from every report leaves the column null - the no-op case', async () => {
    const sessionId = randomUUID();
    const approvedAt = new Date().toISOString();

    await applyReport({ sessionId, approvedAt, photos: [] });

    const row = (
      await dataSource.query(
        `SELECT operator_user_id FROM sessions WHERE id = $1`,
        [sessionId],
      )
    )[0];
    expect(row.operator_user_id).toBeNull();
  });

  test('a SESSION_REPORT photo carries triggerSource/captureMode through to the photos row', async () => {
    const sessionId = randomUUID();
    const photoId = randomUUID();
    const approvedAt = new Date().toISOString();

    await applyReport({
      sessionId,
      approvedAt,
      photos: [
        {
          photoId,
          stepId: 'FRONT',
          attempt: 1,
          mimeType: 'image/jpeg',
          sizeBytes: 100,
          sha256: sha256(),
          virtualPath: `face/x/${photoId}.jpg`,
          triggerSource: 'GESTURE',
          captureMode: 'MANUAL',
        },
      ],
    });

    const row = (
      await dataSource.query(
        `SELECT trigger_source, capture_mode FROM photos WHERE id = $1`,
        [photoId],
      )
    )[0];
    expect(row.trigger_source).toBe('GESTURE');
    expect(row.capture_mode).toBe('MANUAL');
  });

  test('a SESSION_REPORT photo without triggerSource/captureMode leaves both columns null', async () => {
    const sessionId = randomUUID();
    const photoId = randomUUID();
    const approvedAt = new Date().toISOString();

    await applyReport({
      sessionId,
      approvedAt,
      photos: [
        {
          photoId,
          stepId: 'FRONT',
          attempt: 1,
          mimeType: 'image/jpeg',
          sizeBytes: 100,
          sha256: sha256(),
          virtualPath: `face/x/${photoId}.jpg`,
        },
      ],
    });

    const row = (
      await dataSource.query(
        `SELECT trigger_source, capture_mode FROM photos WHERE id = $1`,
        [photoId],
      )
    )[0];
    expect(row.trigger_source).toBeNull();
    expect(row.capture_mode).toBeNull();
  });

  /**
   * `campaign-stats.dao.ts`'s planned `byTrigger` field (§3.7.2) lives in
   * `device-management`, out of this module's scope (see this task's final
   * report) - this proves the data model it would read from is correct: a
   * plain GROUP BY on `photos.trigger_source`, scoped to a campaign through
   * `sessions.campaign_id`, the same scoping `campaignDeviceStats`/
   * `campaignDayStats` already use in `DeviceEventService`.
   */
  test('photos.trigger_source, scoped to a campaign, groups into the counts a byTrigger stat would report', async () => {
    const reportPhoto = async (triggerSource: string) => {
      const sessionId = randomUUID();
      const photoId = randomUUID();
      const approvedAt = new Date().toISOString();
      await applyReport({
        sessionId,
        approvedAt,
        photos: [
          {
            photoId,
            stepId: 'FRONT',
            attempt: 1,
            mimeType: 'image/jpeg',
            sizeBytes: 100,
            sha256: sha256(),
            virtualPath: `face/x/${photoId}.jpg`,
            triggerSource,
          },
        ],
      });
    };

    await reportPhoto('AUTO');
    await reportPhoto('AUTO');
    await reportPhoto('GESTURE');
    await reportPhoto('SHUTTER');
    await reportPhoto('EXTERNAL');

    const rows: Array<{ trigger_source: string; count: string }> =
      await dataSource.query(
        `SELECT p.trigger_source, COUNT(*)::int AS count
           FROM photos p
           JOIN sessions s ON s.id = p.session_id
          WHERE s.campaign_id = $1
          GROUP BY p.trigger_source`,
        [campaignId],
      );
    const byTrigger = Object.fromEntries(
      rows.map((r) => [r.trigger_source, Number(r.count)]),
    );

    expect(byTrigger.AUTO).toBe(2);
    expect(byTrigger.GESTURE).toBe(1);
    expect(byTrigger.SHUTTER).toBe(1);
    expect(byTrigger.EXTERNAL).toBe(1);
  });
});
