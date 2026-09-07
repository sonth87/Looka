import { FileStorageService } from '@app/modules/file-storage/services/file-storage.service';
import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { SnakeNamingStrategy } from 'typeorm-naming-strategies';
import { Photo } from './entities/photo.entity';
import { Session } from './entities/session.entity';
import { UploadOutboxEntry } from './entities/upload-outbox.entity';
import { PhotoService } from './services/photo.service';
import { SessionService } from './services/session.service';
import { UploadWorkerService } from './services/upload-worker.service';

/**
 * Runs against a real Postgres, because what is being checked is what the
 * database guarantees - atomicity and a unique constraint - and a mock
 * repository would only assert that the mock behaves as written. The schema
 * must already be migrated (`pnpm typeorm:run-migrations` against
 * TEST_DATABASE_URL) before this runs.
 *
 * Skipped when TEST_DATABASE_URL is absent so a machine without Postgres
 * still runs the rest of the suite.
 */
const url = process.env.TEST_DATABASE_URL;
const describeDb = url ? describe : describe.skip;

describeDb('capture persistence', () => {
  let sessionService: SessionService;
  let photoService: PhotoService;
  let uploadWorkerService: UploadWorkerService;
  let dataSource: DataSource;
  let fileStorage: { deleteFile: jest.Mock };
  let moduleRef: TestingModule;

  beforeAll(async () => {
    fileStorage = { deleteFile: jest.fn().mockResolvedValue(undefined) };

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
      providers: [
        SessionService,
        PhotoService,
        UploadWorkerService,
        // A real FileStorageService would try to provision/reach fs-core at
        // onModuleInit - irrelevant to what these tests check (Postgres
        // behaviour) and not reachable in this environment anyway. Only the
        // method SessionService.completeSession actually calls is stubbed.
        { provide: FileStorageService, useValue: fileStorage },
      ],
    }).compile();

    moduleRef = built;
    sessionService = built.get(SessionService);
    photoService = built.get(PhotoService);
    uploadWorkerService = built.get(UploadWorkerService);
    dataSource = built.get(DataSource);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  beforeEach(() => {
    fileStorage.deleteFile.mockClear();
  });

  const jpegDataUrl = (byte: number) =>
    `data:image/jpeg;base64,${Buffer.from([byte, byte, byte, byte]).toString('base64')}`;

  test('a photo and its upload intent are written together', async () => {
    // The failure this guards against: the client is told the capture is
    // saved, the photo row exists, and nothing ever uploads it. By then the
    // browser has discarded its only copy.
    const session = await sessionService.createSession({ subjectCode: 'T-1' });
    const { photoId } = await photoService.addPhoto(session.id, {
      stepId: 'FRONT',
      attempt: 1,
      dataUrl: jpegDataUrl(1),
    });

    const photos = await photoService.listBySession(session.id);
    const stored = photos.find((p) => p.id === photoId);
    expect(stored).toBeDefined();
    expect(stored?.uploadStatus).toBe('PENDING');
  });

  test('resending the same capture does not queue it twice', async () => {
    // A browser that retries after a dropped response must not produce a
    // second file on the file-service.
    const session = await sessionService.createSession({});
    const input = { stepId: 'LEFT', attempt: 1, dataUrl: jpegDataUrl(9) };

    const first = await photoService.addPhoto(session.id, input);
    const second = await photoService.addPhoto(session.id, input);

    expect(first.photoId).toBe(second.photoId);

    const photos = await photoService.listBySession(session.id);
    expect(photos.filter((p) => p.stepId === 'LEFT')).toHaveLength(1);
  });

  test('a retake is a new attempt rather than an overwrite', async () => {
    // Replacing the row in place would destroy the earlier photo before
    // anyone had chosen between them.
    const session = await sessionService.createSession({});

    const a = await photoService.addPhoto(session.id, {
      stepId: 'RIGHT',
      attempt: 1,
      dataUrl: jpegDataUrl(1),
    });
    const b = await photoService.addPhoto(session.id, {
      stepId: 'RIGHT',
      attempt: 2,
      dataUrl: jpegDataUrl(2),
    });

    expect(a.photoId).not.toBe(b.photoId);

    const photos = await photoService.listBySession(session.id);
    expect(photos.filter((p) => p.stepId === 'RIGHT')).toHaveLength(2);
  });

  test('a photo cannot belong to a session that does not exist', async () => {
    // CustomException's own `.message` is unhelpful ("Custom Exception") -
    // it extends Nest's HttpException with `{ error }` rather than
    // `{ message }`, so HttpException falls back to a generic string for the
    // property most error-handling code reads by default. The real text
    // lives on `.payload.error`, which is what HttpExceptionFilter sends to
    // the client - asserting against that, not `.message`, is what a caller
    // actually sees.
    await expect(
      photoService.addPhoto('00000000-0000-0000-0000-000000000000', {
        stepId: 'FRONT',
        attempt: 1,
        dataUrl: jpegDataUrl(1),
      }),
    ).rejects.toMatchObject({
      payload: { error: expect.stringMatching(/not found/i) },
    });
  });

  test('completing a session is idempotent', async () => {
    const session = await sessionService.createSession({});
    const first = await sessionService.completeSession(session.id);
    const second = await sessionService.completeSession(session.id);

    expect(first.status).toBe('COMPLETED');
    expect(second.status).toBe('COMPLETED');
    expect(first.completedAt).toEqual(second.completedAt);
  });

  test('completeSession approves only the highest attempt per step, stamps approved_at, and deletes the rest', async () => {
    // Web-path alignment with decision 1 (A.4): a retaken step must not
    // leave the rejected attempt around to be uploaded alongside the final
    // one.
    const session = await sessionService.createSession({});
    await photoService.addPhoto(session.id, {
      stepId: 'FRONT',
      attempt: 1,
      dataUrl: jpegDataUrl(1),
    });
    const frontFinal = await photoService.addPhoto(session.id, {
      stepId: 'FRONT',
      attempt: 2,
      dataUrl: jpegDataUrl(2),
    });
    const left = await photoService.addPhoto(session.id, {
      stepId: 'LEFT',
      attempt: 1,
      dataUrl: jpegDataUrl(3),
    });

    await sessionService.completeSession(session.id);

    const photos = await photoService.listBySession(session.id);
    expect(photos).toHaveLength(2);
    expect(photos.find((p) => p.stepId === 'FRONT')?.attempt).toBe(2);
    expect(photos.find((p) => p.stepId === 'LEFT')?.attempt).toBe(1);

    const approvedRows: Array<{ photo_id: string; approved_at: Date | null }> =
      await dataSource.query(
        `SELECT photo_id, approved_at FROM upload_outbox WHERE photo_id = ANY($1::uuid[])`,
        [[frontFinal.photoId, left.photoId]],
      );
    expect(approvedRows).toHaveLength(2);
    for (const row of approvedRows) {
      expect(row.approved_at).not.toBeNull();
    }
  });

  test('completeSession best-effort deletes the file-service copy of a superseded, already-uploaded attempt', async () => {
    const session = await sessionService.createSession({});
    const superseded = await photoService.addPhoto(session.id, {
      stepId: 'RIGHT',
      attempt: 1,
      dataUrl: jpegDataUrl(4),
    });
    await photoService.addPhoto(session.id, {
      stepId: 'RIGHT',
      attempt: 2,
      dataUrl: jpegDataUrl(5),
    });

    // Simulate the superseded attempt having already reached the
    // file-service before the operator retook the shot and approved.
    await dataSource.query(`UPDATE photos SET fs_file_id = $2 WHERE id = $1`, [
      superseded.photoId,
      '11111111-1111-1111-1111-111111111111',
    ]);

    await sessionService.completeSession(session.id);

    expect(fileStorage.deleteFile).toHaveBeenCalledWith(
      '11111111-1111-1111-1111-111111111111',
    );
  });

  test('claimNext ignores an unapproved row and picks it up once the session is completed', async () => {
    const session = await sessionService.createSession({});
    const { photoId } = await photoService.addPhoto(session.id, {
      stepId: 'FRONT',
      attempt: 1,
      dataUrl: jpegDataUrl(7),
    });

    // Drain every currently-claimable row first, so a row approved by an
    // earlier test in this file can never be mistaken for this one.
    // eslint-disable-next-line no-empty
    while (await (uploadWorkerService as any).claimNext()) {}

    const beforeApproval = await (uploadWorkerService as any).claimNext();
    expect(beforeApproval).toBeNull();

    await sessionService.completeSession(session.id);

    const claimed = await (uploadWorkerService as any).claimNext();
    expect(claimed?.photo_id).toBe(photoId);
  });
});
