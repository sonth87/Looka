import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SnakeNamingStrategy } from 'typeorm-naming-strategies';
import { Photo } from './entities/photo.entity';
import { Session } from './entities/session.entity';
import { UploadOutboxEntry } from './entities/upload-outbox.entity';
import { PhotoService } from './services/photo.service';
import { SessionService } from './services/session.service';

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
  let moduleRef: TestingModule;

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
      providers: [SessionService, PhotoService],
    }).compile();

    moduleRef = built;
    sessionService = built.get(SessionService);
    photoService = built.get(PhotoService);
  });

  afterAll(async () => {
    await moduleRef?.close();
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
});
