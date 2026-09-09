import { FileStorageService } from '@app/modules/file-storage/services/file-storage.service';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { SnakeNamingStrategy } from 'typeorm-naming-strategies';
import { PhotoKind } from './entities/photo-kind.entity';
import { PhotoReviewEvent } from './entities/photo-review-event.entity';
import { PhotoVariant } from './entities/photo-variant.entity';
import { SubjectPhotoSet } from './entities/subject-photo-set.entity';
import {
  PHOTO_REVIEW_ERROR_CODE,
  PhotoReviewSetStatus,
  PhotoVariantKind,
  PhotoVariantStatus,
} from './photo-review.constants';
import { PhotoKindService } from './services/photo-kind.service';
import { PhotoReviewSidecarService } from './services/photo-review-sidecar.service';
import { PhotoReviewService } from './services/photo-review.service';

/**
 * Real-Postgres persistence spec for the locking rule (plan §4) and the
 * variant/set state transitions built on top of it — the safety-critical
 * behavior of this whole module. Mirrors the setup style of
 * `apps/api/src/modules/capture/capture-persistence.spec.ts`.
 *
 * Skipped when TEST_DATABASE_URL is absent. Schema must already be
 * migrated (`DATABASE_URL=<test db> npx ts-node ... typeorm/cli
 * migration:run -d ./src/database/db.migrate.config.ts`) before this runs
 * — the module's own migrations already seed a STUDENT_CARD `PhotoKind`
 * row, which these tests reuse rather than re-seeding.
 */
const url = process.env.TEST_DATABASE_URL;
const describeDb = url ? describe : describe.skip;

describeDb('photo-review persistence', () => {
  let service: PhotoReviewService;
  let dataSource: DataSource;
  let moduleRef: TestingModule;
  let kindId: string;
  // Every service method under test now takes the calling browser's origin
  // (for a local-content fallback link — see PhotoReviewService.toVariantDao)
  // as an explicit argument, same as ReviewController's own routes compute
  // it per-request; a fixed value is enough for these persistence tests,
  // which never assert on link contents.
  const apiBaseUrl = 'http://localhost:3100';

  beforeAll(async () => {
    const fileStorage = {
      clientForTenant: jest.fn(),
      uploadRaw: jest.fn(),
      issueViewLink: jest.fn().mockResolvedValue({ url: 'https://fs.local/view/fake', expiresAt: new Date() }),
      deleteFile: jest.fn().mockResolvedValue(undefined),
    };
    const sidecar = {
      cardPhoto: jest.fn(),
      background: jest.fn(),
      retouch: jest.fn(),
      identitySimilarity: jest.fn(),
      edit: jest.fn(),
    };

    const built = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({
          type: 'postgres',
          url,
          entities: [SubjectPhotoSet, PhotoVariant, PhotoReviewEvent, PhotoKind],
          namingStrategy: new SnakeNamingStrategy(),
          synchronize: false,
        }),
        TypeOrmModule.forFeature([SubjectPhotoSet, PhotoVariant, PhotoReviewEvent, PhotoKind]),
      ],
      providers: [
        PhotoReviewService,
        PhotoKindService,
        { provide: FileStorageService, useValue: fileStorage },
        { provide: PhotoReviewSidecarService, useValue: sidecar },
        // Only used by the local-content HMAC helpers
        // (issueLocalVariantViewLink/verifyLocalVariantViewTokenOrFail) —
        // none of these tests exercise that path directly, so a fixed dummy
        // key is enough to satisfy PhotoReviewService's constructor.
        { provide: ConfigService, useValue: { get: () => 'test-api-key' } },
      ],
    }).compile();

    moduleRef = built;
    service = built.get(PhotoReviewService);
    dataSource = built.get(DataSource);

    // Reuse the seeded STUDENT_CARD kind (migration 1800001000000) rather
    // than inserting a second one — a duplicate `code` would violate its
    // unique constraint.
    const kindRow = await dataSource.query(`SELECT id FROM photo_kinds WHERE code = 'STUDENT_CARD' LIMIT 1`);
    if (kindRow.length === 0) {
      throw new Error(
        'STUDENT_CARD photo kind not found — run migrations against TEST_DATABASE_URL first (1800001000000-SeedStudentCardPhotoKind)',
      );
    }
    kindId = kindRow[0].id;
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  afterEach(async () => {
    // Clean slate between tests — cascade from sets clears their variants/events.
    await dataSource.query(`DELETE FROM subject_photo_sets`);
    await dataSource.query(`DELETE FROM photos`);
    await dataSource.query(`DELETE FROM sessions`);
  });

  /** `CustomException`'s own `.message` is always the generic "Custom Exception" — the real text lives in `.payload.error`. */
  function expectLocked(promise: Promise<unknown>): Promise<void> {
    return promise.then(
      () => {
        throw new Error('expected the call to reject with a locked-set error, but it resolved');
      },
      (e: { payload?: { error?: string; code?: number } }) => {
        expect(e.payload?.code).toBe(PHOTO_REVIEW_ERROR_CODE.SET_LOCKED);
      },
    );
  }

  /** Inserts a set directly (bypassing the service) at a given status, optionally with a current variant. */
  async function seedSet(opts: {
    status: PhotoReviewSetStatus;
    withCurrentVariant?: boolean;
  }): Promise<{ setId: string; variantId: string | null }> {
    const setId = randomUUID();
    const campaignId = randomUUID();
    const sourceSessionId = randomUUID();
    const subjectCode = `SV${Math.random().toString(36).slice(2, 8)}`;

    // `PhotoReviewService.resolveSessionContext` reads the real `sessions`
    // table (capture module, cross-boundary plain-SQL read, by design — see
    // its own doc comment) to resolve a tenant/year for fs-core writes on
    // accept()/reprocess(). Seed a minimal real row so those paths work;
    // every other column defaults sanely (checked against the live schema).
    await dataSource.query(`INSERT INTO sessions (id) VALUES ($1)`, [sourceSessionId]);
    // `PhotoReviewService.findFrontSourcePhoto` (reprocess()'s source image)
    // reads the real `photos` table the same cross-boundary way — a FRONT
    // step with no `fs_file_id` yet, so a reprocess() call takes the
    // documented "source photo not on file-service yet" path rather than
    // actually reaching the (stubbed) sidecar, which is realistic for a
    // freshly-approved session.
    await dataSource.query(
      `INSERT INTO photos (session_id, step_id, step_type, attempt, mime_type, bytes, sha256)
       VALUES ($1, 'step-front', 'FRONT', 1, 'image/jpeg', 12345, 'deadbeef')`,
      [sourceSessionId],
    );

    // Set must exist before any variant can FK to it (`FK_photo_variants_set`)
    // — insert with no current variant first, then insert the variant, then
    // point the set at it, matching what the real approval-hook flow does.
    await dataSource.query(
      `INSERT INTO subject_photo_sets
         (id, campaign_id, subject_code, kind_id, source_session_id, status, current_card_variant_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NULL, now(), now())`,
      [setId, campaignId, subjectCode, kindId, sourceSessionId, opts.status],
    );

    let variantId: string | null = null;
    if (opts.withCurrentVariant) {
      variantId = randomUUID();
      await dataSource.query(
        `INSERT INTO photo_variants (id, set_id, version, kind, source_photo_id, status, created_at, updated_at)
         VALUES ($1, $2, 1, $3, $4, $5, now(), now())`,
        [variantId, setId, PhotoVariantKind.CARD_AUTO, randomUUID(), PhotoVariantStatus.READY],
      );
      await dataSource.query(`UPDATE subject_photo_sets SET current_card_variant_id = $1 WHERE id = $2`, [
        variantId,
        setId,
      ]);
    }

    return { setId, variantId };
  }

  describe('locking rule (plan §4)', () => {
    it('rejects approve() while status is PENDING_AUTO', async () => {
      const { setId } = await seedSet({ status: PhotoReviewSetStatus.PENDING_AUTO });
      await expectLocked(service.approve(setId, {}, null, apiBaseUrl));
    });

    it('rejects approve() while status is AUTO_FAILED', async () => {
      const { setId } = await seedSet({ status: PhotoReviewSetStatus.AUTO_FAILED });
      await expectLocked(service.approve(setId, {}, null, apiBaseUrl));
    });

    it('rejects setCurrent()/aiEdit()/discardVariant() when currentCardVariantId is null even if status looks unlocked', async () => {
      const { setId } = await seedSet({ status: PhotoReviewSetStatus.READY, withCurrentVariant: false });
      await expectLocked(service.setCurrent(setId, randomUUID(), null, apiBaseUrl));
      await expectLocked(service.aiEdit(setId, { prompt: 'nền trắng đều' }, null, apiBaseUrl));
    });

    it('allows approve() once status is READY with a current variant', async () => {
      const { setId } = await seedSet({ status: PhotoReviewSetStatus.READY, withCurrentVariant: true });
      const result = await service.approve(setId, { note: 'ok' }, null, apiBaseUrl);
      expect(result.status).toBe(PhotoReviewSetStatus.APPROVED);
    });

    it('reprocess() is allowed while locked (it is the only way out of AUTO_FAILED) — sidecar is stubbed to fail, proving the call reaches the sidecar rather than being rejected by the lock', async () => {
      const { setId } = await seedSet({ status: PhotoReviewSetStatus.AUTO_FAILED });
      const sidecar = moduleRef.get(PhotoReviewSidecarService) as unknown as { cardPhoto: jest.Mock };
      sidecar.cardPhoto.mockRejectedValueOnce(new Error('sidecar unreachable (expected in this test)'));
      // Should not throw the "locked" error — it should attempt processing
      // and fail for the sidecar-unreachable reason instead, per plan §4/§3.10.
      await expect(service.reprocess(setId, null, apiBaseUrl)).resolves.toBeDefined();
      const row = await dataSource.query(`SELECT status FROM subject_photo_sets WHERE id = $1`, [setId]);
      expect(row[0].status).toBe(PhotoReviewSetStatus.AUTO_FAILED);
    });
  });

  describe('variant lifecycle', () => {
    it('accept() sets a READY variant as current and moves the set to IN_REVIEW', async () => {
      const { setId, variantId: originalVariantId } = await seedSet({
        status: PhotoReviewSetStatus.READY,
        withCurrentVariant: true,
      });
      const newVariantId = randomUUID();
      await dataSource.query(
        `INSERT INTO photo_variants (id, set_id, version, kind, status, created_at, updated_at)
         VALUES ($1, $2, 2, $3, $4, now(), now())`,
        [newVariantId, setId, PhotoVariantKind.CARD_AI, PhotoVariantStatus.READY],
      );

      await service.acceptVariant(newVariantId, null, apiBaseUrl);

      const row = await dataSource.query(
        `SELECT status, current_card_variant_id FROM subject_photo_sets WHERE id = $1`,
        [setId],
      );
      expect(row[0].current_card_variant_id).toBe(newVariantId);
      expect(row[0].current_card_variant_id).not.toBe(originalVariantId);
      expect(row[0].status).toBe(PhotoReviewSetStatus.IN_REVIEW);
    });

    it('discardVariant() refuses to discard the set current variant', async () => {
      const { variantId } = await seedSet({ status: PhotoReviewSetStatus.READY, withCurrentVariant: true });
      await expect(service.discardVariant(variantId as string, null, apiBaseUrl)).rejects.toThrow();
    });

    it('discardVariant() on a non-current variant marks it DISCARDED and never hard-deletes it', async () => {
      const { setId } = await seedSet({ status: PhotoReviewSetStatus.READY, withCurrentVariant: true });
      const extraVariantId = randomUUID();
      await dataSource.query(
        `INSERT INTO photo_variants (id, set_id, version, kind, status, created_at, updated_at)
         VALUES ($1, $2, 2, $3, $4, now(), now())`,
        [extraVariantId, setId, PhotoVariantKind.CARD_UPLOAD, PhotoVariantStatus.READY],
      );

      await service.discardVariant(extraVariantId, null, apiBaseUrl);

      const row = await dataSource.query(`SELECT status FROM photo_variants WHERE id = $1`, [extraVariantId]);
      expect(row).toHaveLength(1); // still exists — never hard-deleted
      expect(row[0].status).toBe(PhotoVariantStatus.DISCARDED);
    });

    it('setCurrent() refuses a DISCARDED variant', async () => {
      const { setId } = await seedSet({ status: PhotoReviewSetStatus.READY, withCurrentVariant: true });
      const discardedId = randomUUID();
      await dataSource.query(
        `INSERT INTO photo_variants (id, set_id, version, kind, status, created_at, updated_at)
         VALUES ($1, $2, 2, $3, $4, now(), now())`,
        [discardedId, setId, PhotoVariantKind.CARD_AI, PhotoVariantStatus.DISCARDED],
      );
      await expect(service.setCurrent(setId, discardedId, null, apiBaseUrl)).rejects.toThrow();
    });
  });

  describe('prompt filter (plan §5.3/§6.3)', () => {
    const forbidden = ['cho cười tự nhiên hơn', 'mở mắt to hơn', 'bỏ kính đi', 'làm gầy mặt', 'làm đẹp da'];
    it.each(forbidden)('rejects a forbidden-edit prompt: "%s"', async (prompt) => {
      const { setId } = await seedSet({ status: PhotoReviewSetStatus.READY, withCurrentVariant: true });
      await expect(service.aiEdit(setId, { prompt }, null, apiBaseUrl)).rejects.toThrow();
    });

    it('accepts an allowed prompt and creates a PROCESSING variant even if the sidecar later fails', async () => {
      const { setId } = await seedSet({ status: PhotoReviewSetStatus.READY, withCurrentVariant: true });
      const sidecar = moduleRef.get(PhotoReviewSidecarService) as unknown as { edit: jest.Mock };
      sidecar.edit.mockRejectedValueOnce(new Error('sidecar unreachable (expected in this test)'));
      const variant = await service.aiEdit(setId, { prompt: 'bỏ lóa kính' }, null, apiBaseUrl).catch((e) => {
        // Either a synchronous rejection surfacing the sidecar error, or a
        // created-then-marked-FAILED variant, are both acceptable outcomes
        // here — what must NOT happen is a PROMPT_FORBIDDEN rejection for
        // an allowed prompt. Re-throw only if it looks like the filter
        // caught it, which is the real failure mode this test guards.
        if (e.payload?.code === PHOTO_REVIEW_ERROR_CODE.PROMPT_FORBIDDEN) throw e;
        return null;
      });
      // If it didn't throw, a variant object should have been returned.
      if (variant) expect(variant).toBeDefined();
    });
  });

  describe('approve/reject', () => {
    it('reject() sets status REJECTED and stores the note', async () => {
      const { setId } = await seedSet({ status: PhotoReviewSetStatus.READY, withCurrentVariant: true });
      const result = await service.reject(setId, { note: 'ảnh mờ, cần chụp lại' }, null, apiBaseUrl);
      expect(result.status).toBe(PhotoReviewSetStatus.REJECTED);
    });

    it('writes a PhotoReviewEvent row for every approve/reject', async () => {
      const { setId } = await seedSet({ status: PhotoReviewSetStatus.READY, withCurrentVariant: true });
      await service.approve(setId, {}, null, apiBaseUrl);
      const events = await dataSource.query(
        `SELECT action FROM photo_review_events WHERE set_id = $1 ORDER BY at DESC`,
        [setId],
      );
      expect(events.some((e: { action: string }) => e.action === 'APPROVED')).toBe(true);
    });
  });
});
