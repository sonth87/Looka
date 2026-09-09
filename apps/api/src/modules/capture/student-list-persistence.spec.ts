import { randomUUID } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { SnakeNamingStrategy } from 'typeorm-naming-strategies';
import { FileStorageService } from '@app/modules/file-storage/services/file-storage.service';
import { Photo } from './entities/photo.entity';
import { Session } from './entities/session.entity';
import { UploadOutboxEntry } from './entities/upload-outbox.entity';
import { StudentService } from './services/student.service';

/**
 * Runs against a real Postgres, same reasoning as capture-persistence.spec.ts.
 * Skipped when TEST_DATABASE_URL is absent; schema must already be migrated
 * first.
 *
 * Fixtures are inserted with plain SQL, not through `SessionService`/
 * `PhotoService` (neither lets a caller pick `captured_at` or `device_id`
 * directly) - the ordering `lastSession` depends on is exactly what these
 * tests need full control over. `devices`/`campaigns` rows are seeded the
 * same way `capture-report-persistence.spec.ts` does, to keep this file
 * inside `apps/api/src/modules/capture/**` without importing
 * device-management's entities/services.
 */
const url = process.env.TEST_DATABASE_URL;
const describeDb = url ? describe : describe.skip;

describeDb(
  'student list persistence (StudentService.listStudents lastSession)',
  () => {
    let studentService: StudentService;
    let dataSource: DataSource;
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
        providers: [
          StudentService,
          // listStudents() never calls FileStorageService (only
          // getStudentDetail() does) - a bare stub is enough to satisfy DI.
          {
            provide: FileStorageService,
            useValue: { issueViewLink: jest.fn() },
          },
        ],
      }).compile();

      moduleRef = built;
      studentService = built.get(StudentService);
      dataSource = built.get(DataSource);
    });

    afterAll(async () => {
      await moduleRef?.close();
    });

    const insertCampaign = async (): Promise<string> => {
      const [row] = await dataSource.query(
        `INSERT INTO campaigns (name) VALUES ($1) RETURNING id`,
        [`student-list-spec-${randomUUID()}`],
      );
      return row.id;
    };

    const insertDevice = async (
      campaignId: string,
      name: string,
    ): Promise<string> => {
      const [row] = await dataSource.query(
        `INSERT INTO devices (campaign_id, name, device_secret_hash) VALUES ($1, $2, $3) RETURNING id`,
        [campaignId, name, 'x'.repeat(64)],
      );
      return row.id;
    };

    const insertSession = async (opts: {
      subjectCode: string;
      campaignId?: string | null;
      deviceId?: string | null;
      capturedAt: Date;
      source?: 'WEB' | 'KIOSK';
    }): Promise<string> => {
      const [row] = await dataSource.query(
        `INSERT INTO sessions (subject_code, campaign_id, device_id, captured_at, source, status)
       VALUES ($1, $2, $3, $4, $5, 'COMPLETED')
       RETURNING id`,
        [
          opts.subjectCode,
          opts.campaignId ?? null,
          opts.deviceId ?? null,
          opts.capturedAt,
          opts.source ?? (opts.deviceId ? 'KIOSK' : 'WEB'),
        ],
      );
      return row.id;
    };

    const insertPhoto = async (
      sessionId: string,
      stepId: string,
    ): Promise<void> => {
      await dataSource.query(
        `INSERT INTO photos (session_id, step_id, mime_type, bytes, sha256, virtual_path)
       VALUES ($1, $2, 'image/jpeg', 100, $3, $4)`,
        [
          sessionId,
          stepId,
          randomUUID().replace(/-/g, '').padEnd(64, '0'),
          `sessions/${sessionId}/${stepId}-1.jpg`,
        ],
      );
    };

    const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000);

    test('lastSession reflects the most recent session across every campaign when unfiltered, and narrows to one campaign when campaignId is given', async () => {
      const subjectCode = `LS-${randomUUID()}`;
      const campaign1 = await insertCampaign();
      const campaign2 = await insertCampaign();
      const device1 = await insertDevice(
        campaign1,
        `Device One ${randomUUID()}`,
      );
      const device2 = await insertDevice(
        campaign2,
        `Device Two ${randomUUID()}`,
      );

      const session1 = await insertSession({
        subjectCode,
        campaignId: campaign1,
        deviceId: device1,
        capturedAt: hoursAgo(3),
      });
      await insertPhoto(session1, 'FRONT');

      const session2 = await insertSession({
        subjectCode,
        campaignId: campaign1,
        deviceId: device1,
        capturedAt: hoursAgo(1),
      });
      await insertPhoto(session2, 'FRONT');
      await insertPhoto(session2, 'LEFT');

      const session3 = await insertSession({
        subjectCode,
        campaignId: campaign2,
        deviceId: device2,
        capturedAt: hoursAgo(0.5),
      });
      await insertPhoto(session3, 'FRONT');
      await insertPhoto(session3, 'LEFT');
      await insertPhoto(session3, 'RIGHT');

      // Unfiltered: the most recent session overall is session3 (campaign2).
      const unfiltered = await studentService.listStudents({
        q: subjectCode,
      });
      const unfilteredRow = unfiltered.items.find(
        (i) => i.subjectCode === subjectCode,
      );
      expect(unfilteredRow?.lastSession.photoCount).toBe(3);
      expect(unfilteredRow?.lastSession.deviceName).toContain('Device Two');

      // Filtered to campaign1: the most recent session within that campaign is
      // session2, not session3 - the filter narrows the underlying set, not
      // just the displayed page, mirroring how campaignId already narrows
      // sessionCount/totalPhotos.
      const filtered = await studentService.listStudents({
        q: subjectCode,
        campaignId: campaign1,
      });
      const filteredRow = filtered.items.find(
        (i) => i.subjectCode === subjectCode,
      );
      expect(filteredRow?.lastSession.photoCount).toBe(2);
      expect(filteredRow?.lastSession.deviceName).toContain('Device One');
    });

    test('lastSession has no deviceName for a WEB-path session with no device, and photoCount 0 with no photos', async () => {
      const subjectCode = `LS-WEB-${randomUUID()}`;
      await insertSession({
        subjectCode,
        capturedAt: hoursAgo(0.1),
        source: 'WEB',
      });

      const result = await studentService.listStudents({
        q: subjectCode,
      });
      const row = result.items.find((i) => i.subjectCode === subjectCode);
      expect(row).toBeDefined();
      expect(row?.lastSession.deviceName).toBeUndefined();
      expect(row?.lastSession.photoCount).toBe(0);
    });
  },
);
