import { PhotoReviewService } from '@app/modules/photo-review/services/photo-review.service';
import { CaptureStatsService } from '@app/modules/stats/services/capture-stats.service';
import { ERROR_CODE } from '@app/shared/errors/legacy';
import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { SnakeNamingStrategy } from 'typeorm-naming-strategies';
import { Photo } from './entities/photo.entity';
import { Session } from './entities/session.entity';
import { SessionVideo } from './entities/session-video.entity';
import { UploadOutboxEntry } from './entities/upload-outbox.entity';
import { VideoUploadOutboxEntry } from './entities/video-upload-outbox.entity';
import { SessionService } from './services/session.service';
import { SessionVideoService } from './services/session-video.service';

/**
 * The video twin of `capture-persistence.spec.ts` (2026-09-09, "route kiosk
 * VIDEO uploads through apps/api the same way kiosk PHOTO uploads already
 * work") — same "runs against a real Postgres because what is being
 * checked is what the database guarantees" reasoning, and the same
 * `TEST_DATABASE_URL`-gated skip for a machine without one.
 *
 * A separate file rather than appended to `capture-persistence.spec.ts`:
 * that file was NOT touched by either of the two other agents working in
 * apps/api today (confirmed via `git status` before starting), but staying
 * out of it entirely removes any chance of colliding with unrelated
 * in-flight work there.
 */
const url = process.env.TEST_DATABASE_URL;
const describeDb = url ? describe : describe.skip;

describeDb('video persistence', () => {
  let sessionService: SessionService;
  let sessionVideoService: SessionVideoService;
  let dataSource: DataSource;
  let moduleRef: TestingModule;
  let deviceId: string;
  let campaignId: string;

  beforeAll(async () => {
    const built = await Test.createTestingModule({
      imports: [
        // `SessionVideoService` reads its limits through `ConfigService`
        // (added after this spec was written) — the real, env-backed one.
        ConfigModule.forRoot({ isGlobal: true }),
        TypeOrmModule.forRoot({
          type: 'postgres',
          url,
          // `Photo`/`UploadOutboxEntry` added: `Session` now has a `photos`
          // relation, and TypeORM refuses to build metadata without its
          // target entity registered ("Entity metadata for Session#photos was
          // not found").
          entities: [
            Session,
            SessionVideo,
            VideoUploadOutboxEntry,
            Photo,
            UploadOutboxEntry,
          ],
          namingStrategy: new SnakeNamingStrategy(),
          synchronize: false,
        }),
        TypeOrmModule.forFeature([
          Session,
          SessionVideo,
          VideoUploadOutboxEntry,
          Photo,
          UploadOutboxEntry,
        ]),
      ],
      providers: [
        SessionService,
        SessionVideoService,
        // `SessionService` gained `PhotoReviewService` (best-effort review-set
        // hook) and `CaptureStatsService` (P4 counters) after this spec was
        // written, so the suite could no longer START (Nest DI error at
        // `compile()`) and none of its tests were running. Nothing here
        // touches photo review — a resolved-no-op stub; the stats service has
        // no constructor dependencies, so the real class is used.
        {
          provide: PhotoReviewService,
          useValue: {
            ensureSetForApprovedSession: jest.fn().mockResolvedValue(null),
          },
        },
        CaptureStatsService,
      ],
    }).compile();

    moduleRef = built;
    sessionService = built.get(SessionService);
    sessionVideoService = built.get(SessionVideoService);
    dataSource = built.get(DataSource);

    // addDeviceVideo() upserts `sessions.device_id`/`campaign_id`, both real
    // FKs into `devices`/`campaigns` — inserted with raw SQL rather than
    // importing those entities into this module, mirroring how this file
    // otherwise stays scoped to just the capture module's own tables.
    const campaign = await dataSource.query(
      `INSERT INTO campaigns (name) VALUES ('video-persistence-test') RETURNING id`,
    );
    campaignId = campaign[0].id;
    const device = await dataSource.query(
      `INSERT INTO devices (campaign_id, name, device_secret_hash) VALUES ($1, 'video-test-kiosk', 'x') RETURNING id`,
      [campaignId],
    );
    deviceId = device[0].id;
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  const webmDataUrl = (byte: number) =>
    `data:video/webm;base64,${Buffer.from([byte, byte, byte, byte]).toString('base64')}`;

  /**
   * A session owned by this suite's device + campaign, like a real kiosk
   * session. Since the 2026-09-24 audit fix, `addDeviceVideo` refuses (403,
   * `SESSION_DEVICE_MISMATCH`) to attach a video to a session that belongs to
   * any OTHER device/campaign — including one created with no device at all,
   * which is what `createSession({})` alone produces. These tests used to
   * pass only because that hole existed.
   */
  async function ownedSession() {
    const session = await sessionService.createSession({});
    await dataSource.query(
      `UPDATE sessions SET device_id = $1, campaign_id = $2 WHERE id = $3`,
      [deviceId, campaignId, session.id],
    );
    return session;
  }

  test('a device cannot attach a video to a session it does not own (cross-device hijack guard, 403)', async () => {
    // Created with no device/campaign — i.e. NOT this device's session.
    const foreign = await sessionService.createSession({});

    await expect(
      sessionVideoService.addDeviceVideo(deviceId, campaignId, {
        videoId: crypto.randomUUID(),
        sessionId: foreign.id,
        cameraRole: 'CENTER',
        dataUrl: webmDataUrl(1),
      }),
    ).rejects.toMatchObject({
      payload: expect.objectContaining({
        code: ERROR_CODE.SESSION_DEVICE_MISMATCH,
      }) as unknown,
    });
    const rows: unknown[] = await dataSource.query(
      `SELECT 1 FROM session_videos WHERE session_id = $1`,
      [foreign.id],
    );
    expect(rows).toHaveLength(0);
  });

  test('a video and its upload intent are written together, and is viewable locally before reaching fs-core', async () => {
    const session = await ownedSession();
    const videoId = crypto.randomUUID();

    const result = await sessionVideoService.addDeviceVideo(
      deviceId,
      campaignId,
      {
        videoId,
        sessionId: session.id,
        cameraRole: 'CENTER',
        durationMs: 5000,
        dataUrl: webmDataUrl(7),
      },
    );
    expect(result.videoId).toBe(videoId);

    // Not yet on fs-core (no worker has run in this test) — must fall back
    // to the local copy rather than throw, closing the exact gap this task
    // exists for.
    const source = await sessionVideoService.resolveViewSource(videoId);
    expect(source.kind).toBe('local');

    const local = await sessionVideoService.readLocalContent(videoId);
    expect(local.mimeType).toBe('video/webm');
    expect(local.data.equals(Buffer.from([7, 7, 7, 7]))).toBe(true);

    const { url: linkUrl } = sessionVideoService.issueLocalViewLink(
      videoId,
      'http://localhost:3100',
    );
    const parsed = new URL(linkUrl);
    expect(() =>
      sessionVideoService.verifyLocalViewTokenOrFail(
        videoId,
        parsed.searchParams.get('exp')!,
        parsed.searchParams.get('sig')!,
      ),
    ).not.toThrow();
    expect(() =>
      sessionVideoService.verifyLocalViewTokenOrFail(
        videoId,
        parsed.searchParams.get('exp')!,
        'deadbeef',
      ),
    ).toThrow();
  });

  test('addDeviceVideo is idempotent — a retried call does not create a second outbox row', async () => {
    const session = await ownedSession();
    const videoId = crypto.randomUUID();
    const dto = {
      videoId,
      sessionId: session.id,
      cameraRole: 'LEFT',
      dataUrl: webmDataUrl(9),
    };

    await sessionVideoService.addDeviceVideo(deviceId, campaignId, dto);
    await sessionVideoService.addDeviceVideo(deviceId, campaignId, dto);

    const rows = await dataSource.query(
      `SELECT id FROM video_upload_outbox WHERE video_id = $1`,
      [videoId],
    );
    expect(rows.length).toBe(1);
  });

  test('resolveViewSource prefers the healthy remote copy once fs_file_id/fs_status land', async () => {
    const session = await ownedSession();
    const videoId = crypto.randomUUID();
    await sessionVideoService.addDeviceVideo(deviceId, campaignId, {
      videoId,
      sessionId: session.id,
      dataUrl: webmDataUrl(3),
    });

    // Simulates what VideoUploadWorkerService.send() would have written.
    await dataSource.query(
      `UPDATE session_videos SET fs_file_id = gen_random_uuid(), fs_status = 'READY' WHERE id = $1`,
      [videoId],
    );

    const source = await sessionVideoService.resolveViewSource(videoId);
    expect(source.kind).toBe('remote');
  });

  test('resolveViewSource falls back to local when the remote copy is FAILED, even though fs_file_id is set', async () => {
    // The exact 2026-09-09 fix this mirrors from PhotoService.resolveViewSource:
    // fs-core purging a file mid-scan must not strand a video with no way to view it.
    const session = await ownedSession();
    const videoId = crypto.randomUUID();
    await sessionVideoService.addDeviceVideo(deviceId, campaignId, {
      videoId,
      sessionId: session.id,
      dataUrl: webmDataUrl(5),
    });

    await dataSource.query(
      `UPDATE session_videos SET fs_file_id = gen_random_uuid(), fs_status = 'FAILED' WHERE id = $1`,
      [videoId],
    );

    const source = await sessionVideoService.resolveViewSource(videoId);
    expect(source.kind).toBe('local');
  });

  test('accepts a real MediaRecorder-style mime type carrying a codec parameter (e.g. "video/webm;codecs=vp8")', async () => {
    // Live-confirmed 2026-09-09: real session_videos rows already store
    // exactly this shape — see DATA_URL_MARKER's own doc comment for why a
    // naive "match up to the first ;" regex breaks on it.
    const session = await ownedSession();
    const videoId = crypto.randomUUID();
    const dataUrl = `data:video/webm;codecs=vp8;base64,${Buffer.from([1, 2, 3]).toString('base64')}`;

    const result = await sessionVideoService.addDeviceVideo(
      deviceId,
      campaignId,
      {
        videoId,
        sessionId: session.id,
        dataUrl,
      },
    );
    expect(result.videoId).toBe(videoId);

    const local = await sessionVideoService.readLocalContent(videoId);
    expect(local.mimeType).toBe('video/webm;codecs=vp8');
    expect(local.data.equals(Buffer.from([1, 2, 3]))).toBe(true);
  });

  test('addDeviceVideo rejects an unsupported mime type', async () => {
    const session = await ownedSession();
    // A video type outside the allowlist → UNSUPPORTED_MIME_TYPE.
    await expect(
      sessionVideoService.addDeviceVideo(deviceId, campaignId, {
        videoId: crypto.randomUUID(),
        sessionId: session.id,
        dataUrl: 'data:video/x-msvideo;base64,AAAA',
      }),
    ).rejects.toMatchObject({
      payload: { code: ERROR_CODE.VIDEO_UNSUPPORTED_MIME_TYPE },
    });
    // Not a video data URL at all (an image) → the stricter prefix check
    // reports INVALID_DATA_URL first. This test used to send this image URL
    // and expect UNSUPPORTED_MIME_TYPE, before the service checked the
    // `data:video/` prefix.
    await expect(
      sessionVideoService.addDeviceVideo(deviceId, campaignId, {
        videoId: crypto.randomUUID(),
        sessionId: session.id,
        dataUrl: 'data:image/jpeg;base64,AAAA',
      }),
    ).rejects.toMatchObject({
      payload: { code: ERROR_CODE.VIDEO_INVALID_DATA_URL },
    });
  });

  test('readLocalContent throws FILE_STORAGE_NOT_READY for a video with no locally stored bytes', async () => {
    await expect(
      sessionVideoService.readLocalContent(crypto.randomUUID()),
    ).rejects.toMatchObject({
      payload: { code: ERROR_CODE.FILE_STORAGE_NOT_READY },
    });
  });
});
