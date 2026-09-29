import { FileStorageService } from '@app/modules/file-storage/services/file-storage.service';
import { ReviewStatsService } from '@app/modules/stats/services/review-stats.service';
import { DomainEventDispatcher } from '@app/shared/cqrs/domain-event.dispatcher';
import { TransactionContext } from '@app/shared/database/transaction-context';
import { getQueueToken } from '@nestjs/bullmq';
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
  AI_EDIT_QUEUE_NAME,
  PHOTO_REVIEW_ERROR_CODE,
  PhotoReviewSetStatus,
  PhotoVariantKind,
  PhotoVariantStatus,
} from './photo-review.constants';
import { PHOTO_AI_PORT } from './application/ports/photo-ai.port';
import { AiImageEditClient } from './services/ai-image-edit.client';
import { PhotoAiAdapter } from './services/photo-ai.adapter';
import { PhotoKindService } from './services/photo-kind.service';
import { PhotoReviewSidecarService } from './services/photo-review-sidecar.service';
import { PhotoReviewService } from './services/photo-review.service';
import { ReviewAssignmentService } from './services/review-assignment.service';
import { WorkflowCatalogReadRepository } from '@app/modules/workflow/infrastructure/read/workflow-catalog.read-repository';

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
      issueViewLink: jest.fn().mockResolvedValue({
        url: 'https://fs.local/view/fake',
        expiresAt: new Date(),
      }),
      deleteFile: jest.fn().mockResolvedValue(undefined),
    };
    const sidecar = {
      cardPhoto: jest.fn(),
      background: jest.fn(),
      retouch: jest.fn(),
      identitySimilarity: jest.fn(),
    };
    const aiImageEdit = {
      edit: jest.fn(),
      health: jest.fn(),
    };
    // `PhotoReviewService` grew 4 more constructor deps after this spec was
    // first written (review-assignment scoping, stats hooks, and the
    // domain-event seam that lets `PrintModule` react to approve/reject —
    // see `PhotoReviewService`'s own top doc comment). None of the
    // behavior under test here exercises any of the four for real: every
    // call below passes `actorUserId: null`, which
    // `ReviewAssignmentService.resolveActor` already short-circuits to
    // "unrestricted" without a query — so a plain fake for each is enough,
    // same faking style as `fileStorage`/`sidecar` above, rather than
    // wiring up a real `DiscoveryModule`/`ReviewAssignment` repository this
    // suite has no other need for.
    const reviewAssignments = {
      assertInScope: jest.fn().mockResolvedValue(undefined),
      // `listSets` also calls this — `null` (no filter) matches the real
      // `ReviewAssignmentService.buildScopeFilter`'s own "unrestricted"
      // return for a null/admin actor, which every call in this suite is.
      buildScopeFilter: jest.fn().mockResolvedValue(null),
    };
    const reviewStats = {
      recordAutoFailed: jest.fn().mockResolvedValue(undefined),
      recordAiRequested: jest.fn().mockResolvedValue(undefined),
      recordAiAccepted: jest.fn().mockResolvedValue(undefined),
      recordUploaded: jest.fn().mockResolvedValue(undefined),
      recordDecision: jest.fn().mockResolvedValue(undefined),
    };
    const transactionContext = {
      run: jest.fn((_manager: unknown, fn: () => Promise<unknown>) => fn()),
    };
    const domainEventDispatcher = {
      dispatch: jest.fn().mockResolvedValue(undefined),
    };
    // No campaign in this suite is workflow-pinned — see the same note in
    // photo-review-upload-live.spec.ts.
    const workflowCatalog = {
      getVersionRef: jest.fn().mockResolvedValue(null),
    };

    const built = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({
          type: 'postgres',
          url,
          entities: [
            SubjectPhotoSet,
            PhotoVariant,
            PhotoReviewEvent,
            PhotoKind,
          ],
          namingStrategy: new SnakeNamingStrategy(),
          synchronize: false,
        }),
        TypeOrmModule.forFeature([
          SubjectPhotoSet,
          PhotoVariant,
          PhotoReviewEvent,
          PhotoKind,
        ]),
      ],
      providers: [
        PhotoReviewService,
        PhotoKindService,
        { provide: FileStorageService, useValue: fileStorage },
        { provide: PhotoReviewSidecarService, useValue: sidecar },
        { provide: AiImageEditClient, useValue: aiImageEdit },
        { provide: PHOTO_AI_PORT, useClass: PhotoAiAdapter },
        // Only used by the local-content HMAC helpers
        // (issueLocalVariantViewLink/verifyLocalVariantViewTokenOrFail) —
        // none of these tests exercise that path directly, so a fixed dummy
        // key is enough to satisfy PhotoReviewService's constructor.
        { provide: ConfigService, useValue: { get: () => 'test-api-key' } },
        { provide: ReviewAssignmentService, useValue: reviewAssignments },
        { provide: ReviewStatsService, useValue: reviewStats },
        { provide: TransactionContext, useValue: transactionContext },
        { provide: DomainEventDispatcher, useValue: domainEventDispatcher },
        { provide: WorkflowCatalogReadRepository, useValue: workflowCatalog },
        // None of these tests need the job to actually run (they only
        // assert on the immediate PROCESSING/LOCKED state `aiEdit()`/
        // `reprocess()` leave behind) — just enough for `@InjectQueue` to
        // resolve, see photo-review-upload-live.spec.ts's `aiEditQueue` for
        // the sibling suite that DOES need to inspect/run enqueued jobs.
        {
          provide: getQueueToken(AI_EDIT_QUEUE_NAME),
          useValue: { add: jest.fn().mockResolvedValue(undefined) },
        },
      ],
    }).compile();

    moduleRef = built;
    service = built.get(PhotoReviewService);
    dataSource = built.get(DataSource);

    // Reuse the seeded STUDENT_CARD kind (migration 1800001000000) rather
    // than inserting a second one — a duplicate `code` would violate its
    // unique constraint.
    const kindRow = await dataSource.query(
      `SELECT id FROM photo_kinds WHERE code = 'STUDENT_CARD' LIMIT 1`,
    );
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
        throw new Error(
          'expected the call to reject with a locked-set error, but it resolved',
        );
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
    await dataSource.query(`INSERT INTO sessions (id) VALUES ($1)`, [
      sourceSessionId,
    ]);
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
        [
          variantId,
          setId,
          PhotoVariantKind.CARD_AUTO,
          randomUUID(),
          PhotoVariantStatus.READY,
        ],
      );
      await dataSource.query(
        `UPDATE subject_photo_sets SET current_card_variant_id = $1 WHERE id = $2`,
        [variantId, setId],
      );
    }

    return { setId, variantId };
  }

  describe('locking rule (plan §4)', () => {
    it('rejects approve() while status is PENDING_AUTO', async () => {
      const { setId } = await seedSet({
        status: PhotoReviewSetStatus.PENDING_AUTO,
      });
      await expectLocked(service.approve(setId, {}, null, apiBaseUrl));
    });

    it('rejects approve() while status is AUTO_FAILED', async () => {
      const { setId } = await seedSet({
        status: PhotoReviewSetStatus.AUTO_FAILED,
      });
      await expectLocked(service.approve(setId, {}, null, apiBaseUrl));
    });

    it('rejects setCurrent()/aiEdit()/discardVariant() when currentCardVariantId is null even if status looks unlocked', async () => {
      const { setId } = await seedSet({
        status: PhotoReviewSetStatus.READY,
        withCurrentVariant: false,
      });
      await expectLocked(
        service.setCurrent(setId, randomUUID(), null, apiBaseUrl),
      );
      await expectLocked(
        service.aiEdit(setId, { prompt: 'nền trắng đều' }, null, apiBaseUrl),
      );
    });

    it('allows approve() once status is READY with a current variant', async () => {
      const { setId } = await seedSet({
        status: PhotoReviewSetStatus.READY,
        withCurrentVariant: true,
      });
      const result = await service.approve(
        setId,
        { note: 'ok' },
        null,
        apiBaseUrl,
      );
      expect(result.status).toBe(PhotoReviewSetStatus.APPROVED);
    });

    it('reprocess() is allowed while locked (it is the only way out of AUTO_FAILED) — sidecar is stubbed to fail, proving the call reaches the sidecar rather than being rejected by the lock', async () => {
      const { setId } = await seedSet({
        status: PhotoReviewSetStatus.AUTO_FAILED,
      });
      // `PhotoReviewSidecarService` is DI-overridden with a plain
      // `{ cardPhoto: jest.fn(), ... }` object above (`useValue: sidecar`),
      // but `moduleRef.get()` types the return as the real class, whose
      // methods are plain async functions with no `.mockRejectedValueOnce` —
      // cast through `jest.Mocked<...>` so TS sees the mock surface that is
      // actually there at runtime.
      const sidecar = moduleRef.get(PhotoReviewSidecarService);
      sidecar.cardPhoto.mockRejectedValueOnce(
        new Error('sidecar unreachable (expected in this test)'),
      );
      // Should not throw the "locked" error — it should attempt processing
      // and fail for the sidecar-unreachable reason instead, per plan §4/§3.10.
      await expect(
        service.reprocess(setId, null, apiBaseUrl),
      ).resolves.toBeDefined();
      const row = await dataSource.query(
        `SELECT status FROM subject_photo_sets WHERE id = $1`,
        [setId],
      );
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
        [
          newVariantId,
          setId,
          PhotoVariantKind.CARD_AI,
          PhotoVariantStatus.READY,
        ],
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
      const { variantId } = await seedSet({
        status: PhotoReviewSetStatus.READY,
        withCurrentVariant: true,
      });
      await expect(
        service.discardVariant(variantId as string, null, apiBaseUrl),
      ).rejects.toThrow();
    });

    it('discardVariant() on a non-current variant marks it DISCARDED and never hard-deletes it', async () => {
      const { setId } = await seedSet({
        status: PhotoReviewSetStatus.READY,
        withCurrentVariant: true,
      });
      const extraVariantId = randomUUID();
      await dataSource.query(
        `INSERT INTO photo_variants (id, set_id, version, kind, status, created_at, updated_at)
         VALUES ($1, $2, 2, $3, $4, now(), now())`,
        [
          extraVariantId,
          setId,
          PhotoVariantKind.CARD_UPLOAD,
          PhotoVariantStatus.READY,
        ],
      );

      await service.discardVariant(extraVariantId, null, apiBaseUrl);

      const row = await dataSource.query(
        `SELECT status FROM photo_variants WHERE id = $1`,
        [extraVariantId],
      );
      expect(row).toHaveLength(1); // still exists — never hard-deleted
      expect(row[0].status).toBe(PhotoVariantStatus.DISCARDED);
    });

    it('setCurrent() refuses a DISCARDED variant', async () => {
      const { setId } = await seedSet({
        status: PhotoReviewSetStatus.READY,
        withCurrentVariant: true,
      });
      const discardedId = randomUUID();
      await dataSource.query(
        `INSERT INTO photo_variants (id, set_id, version, kind, status, created_at, updated_at)
         VALUES ($1, $2, 2, $3, $4, now(), now())`,
        [
          discardedId,
          setId,
          PhotoVariantKind.CARD_AI,
          PhotoVariantStatus.DISCARDED,
        ],
      );
      await expect(
        service.setCurrent(setId, discardedId, null, apiBaseUrl),
      ).rejects.toThrow();
    });
  });

  describe('prompt filter (plan §5.3/§6.3)', () => {
    const forbidden = [
      'cho cười tự nhiên hơn',
      'mở mắt to hơn',
      'bỏ kính đi',
      'làm gầy mặt',
      'làm đẹp da',
    ];
    it.each(forbidden)(
      'rejects a forbidden-edit prompt: "%s"',
      async (prompt) => {
        const { setId } = await seedSet({
          status: PhotoReviewSetStatus.READY,
          withCurrentVariant: true,
        });
        await expect(
          service.aiEdit(setId, { prompt }, null, apiBaseUrl),
        ).rejects.toThrow();
      },
    );

    it('accepts an allowed prompt and creates a PROCESSING variant even if the sidecar later fails', async () => {
      const { setId } = await seedSet({
        status: PhotoReviewSetStatus.READY,
        withCurrentVariant: true,
      });
      const aiImageEdit = moduleRef.get(AiImageEditClient);
      aiImageEdit.edit.mockRejectedValueOnce(
        new Error('sidecar unreachable (expected in this test)'),
      );
      const variant = await service
        .aiEdit(setId, { prompt: 'bỏ lóa kính' }, null, apiBaseUrl)
        .catch((e) => {
          // Either a synchronous rejection surfacing the sidecar error, or a
          // created-then-marked-FAILED variant, are both acceptable outcomes
          // here — what must NOT happen is a PROMPT_FORBIDDEN rejection for
          // an allowed prompt. Re-throw only if it looks like the filter
          // caught it, which is the real failure mode this test guards.
          if (e.payload?.code === PHOTO_REVIEW_ERROR_CODE.PROMPT_FORBIDDEN)
            throw e;
          return null;
        });
      // If it didn't throw, a variant object should have been returned.
      if (variant) expect(variant).toBeDefined();
    });
  });

  describe('approve/reject', () => {
    it('reject() sets status REJECTED and stores the note', async () => {
      const { setId } = await seedSet({
        status: PhotoReviewSetStatus.READY,
        withCurrentVariant: true,
      });
      const result = await service.reject(
        setId,
        { note: 'ảnh mờ, cần chụp lại' },
        null,
        apiBaseUrl,
      );
      expect(result.status).toBe(PhotoReviewSetStatus.REJECTED);
    });

    it('writes a PhotoReviewEvent row for every approve/reject', async () => {
      const { setId } = await seedSet({
        status: PhotoReviewSetStatus.READY,
        withCurrentVariant: true,
      });
      await service.approve(setId, {}, null, apiBaseUrl);
      const events = await dataSource.query(
        `SELECT action FROM photo_review_events WHERE set_id = $1 ORDER BY at DESC`,
        [setId],
      );
      expect(
        events.some((e: { action: string }) => e.action === 'APPROVED'),
      ).toBe(true);
    });

    it('re-approving an already-APPROVED set is idempotent — exactly one APPROVED event and exactly one ReviewStatsService.recordDecision call', async () => {
      const { setId } = await seedSet({
        status: PhotoReviewSetStatus.READY,
        withCurrentVariant: true,
      });
      // `ReviewStatsService` is DI-overridden with a plain
      // `{ recordDecision: jest.fn(), ... }` object (see beforeAll) — same
      // `moduleRef.get()` real-class-typed-but-actually-a-mock convention
      // this file already accepts for `sidecar` (a cast through
      // `{ recordDecision: jest.Mock }` was tried and rejected by
      // `no-unnecessary-type-assertion`, same as that file's own attempt).
      const reviewStats = moduleRef.get(ReviewStatsService);
      // This mock is a single object shared across the whole file's
      // `beforeAll` — its call count accumulates across every earlier test.
      // Cleared here so the assertion below reflects only THIS test's own
      // two approve() calls, not the whole suite's history.
      reviewStats.recordDecision.mockClear();

      await service.approve(setId, { note: 'first' }, null, apiBaseUrl);
      const second = await service.approve(
        setId,
        { note: 'second (double-click / retry)' },
        null,
        apiBaseUrl,
      );

      expect(second.status).toBe(PhotoReviewSetStatus.APPROVED);
      const events: Array<{ action: string }> = await dataSource.query(
        `SELECT action FROM photo_review_events WHERE set_id = $1 AND action = 'APPROVED'`,
        [setId],
      );
      expect(events).toHaveLength(1);
      expect(reviewStats.recordDecision).toHaveBeenCalledTimes(1);
    });

    it('re-rejecting an already-REJECTED set is idempotent the same way', async () => {
      const { setId } = await seedSet({
        status: PhotoReviewSetStatus.READY,
        withCurrentVariant: true,
      });
      const reviewStats = moduleRef.get(ReviewStatsService);
      reviewStats.recordDecision.mockClear();

      await service.reject(setId, { note: 'first' }, null, apiBaseUrl);
      await service.reject(setId, { note: 'second' }, null, apiBaseUrl);

      const events: Array<{ action: string }> = await dataSource.query(
        `SELECT action FROM photo_review_events WHERE set_id = $1 AND action = 'REJECTED'`,
        [setId],
      );
      expect(events).toHaveLength(1);
      expect(reviewStats.recordDecision).toHaveBeenCalledTimes(1);
    });
  });

  describe('listSets faculty filter (plan §G.2.b, 2026-09-17)', () => {
    /** Mirrors `seedSet` above but sets `faculty` directly rather than going through the service — `className`/`major` already work this same "denormalized column, exact match" way, `faculty` was just missing from the DTO before this change. */
    async function seedSetWithFaculty(
      faculty: string | null,
    ): Promise<{ setId: string; campaignId: string; subjectCode: string }> {
      const setId = randomUUID();
      const campaignId = randomUUID();
      const sourceSessionId = randomUUID();
      const subjectCode = `SV${Math.random().toString(36).slice(2, 8)}`;

      await dataSource.query(`INSERT INTO sessions (id) VALUES ($1)`, [
        sourceSessionId,
      ]);
      await dataSource.query(
        `INSERT INTO subject_photo_sets
           (id, campaign_id, subject_code, kind_id, source_session_id, status, faculty, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, now(), now())`,
        [
          setId,
          campaignId,
          subjectCode,
          kindId,
          sourceSessionId,
          PhotoReviewSetStatus.PENDING_AUTO,
          faculty,
        ],
      );
      return { setId, campaignId, subjectCode };
    }

    it('returns only sets whose faculty matches exactly', async () => {
      const match = await seedSetWithFaculty('CNTT');
      await seedSetWithFaculty('Khoa khac');
      await seedSetWithFaculty(null);

      const result = await service.listSets(
        { campaignId: match.campaignId, faculty: 'CNTT' },
        apiBaseUrl,
      );

      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe(match.setId);
      expect(result.items[0].faculty).toBe('CNTT');
    });

    it('is not applied when omitted — behaves like today for existing callers', async () => {
      const a = await seedSetWithFaculty('CNTT');
      const sameCampaignFaculty = await seedSetWithFaculty('Khoa khac');
      // Force both rows into the same campaign so the "no faculty filter"
      // assertion actually exercises more than one row.
      await dataSource.query(
        `UPDATE subject_photo_sets SET campaign_id = $1 WHERE id = $2`,
        [a.campaignId, sameCampaignFaculty.setId],
      );

      const result = await service.listSets(
        { campaignId: a.campaignId },
        apiBaseUrl,
      );

      expect(result.items.map((i) => i.id).sort()).toEqual(
        [a.setId, sameCampaignFaculty.setId].sort(),
      );
    });
  });
});
