import { FileStorageService } from '@app/modules/file-storage/services/file-storage.service';
import { PrintBatch } from '@app/modules/print/entities/print-batch.entity';
import { PrintItemEvent } from '@app/modules/print/entities/print-item-event.entity';
import { PrintItem } from '@app/modules/print/entities/print-item.entity';
// Not used directly by any test here, but `PrintBatch`/`PrintItem` both
// carry a `@ManyToOne(() => Printer)` relation — TypeORM needs it in the
// same `entities` array or metadata resolution fails at DataSource init.
import { Printer } from '@app/modules/print/entities/printer.entity';
import { PhotoSetStatusChangedHandler } from '@app/modules/print/services/photo-set-status-changed.handler';
import { PrintItemService } from '@app/modules/print/services/print-item.service';
import { ReviewStatsService } from '@app/modules/stats/services/review-stats.service';
import { STATS_UNKNOWN_UUID } from '@app/modules/stats/stats.constants';
import { FoundationModule } from '@app/shared/foundation.module';
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
import { ReviewAssignmentService } from './services/review-assignment.service';

/**
 * Real-Postgres, real-`DomainEventDispatcher` coverage for the seam this
 * task was specifically asked to exercise live: `PhotoReviewService.approve`
 * /`reject` raising `PhotoSetStatusChangedEvent`, and `PrintModule`'s
 * `PhotoSetStatusChangedHandler` reacting to it to auto-attach/withdraw a
 * `print_items` row (task brief "cứ duyệt xong thì sẽ có trong đợt in").
 * Nothing here mocks that seam — `FoundationModule` provides the real
 * `TransactionContext`/`DomainEventDispatcher`/`DiscoveryModule`, and
 * `PhotoSetStatusChangedHandler` is a real, DI-constructed provider so
 * `DomainEventDispatcher.onModuleInit()` actually discovers it, exactly as
 * it would in the running app. Only `PrintItemService`'s OWN unrelated
 * constructor deps (template/render/file-storage/stats/printer — untouched
 * by `onSetApproved`/`onSetLeftApproved`, see that spec's own doc comment)
 * are stubbed out, same convention `print-item.service.auto-attach.spec.ts`
 * already uses for the exact same two methods.
 *
 * `Test.createTestingModule(...).compile()` does NOT run `onModuleInit`
 * lifecycle hooks by itself (confirmed against
 * `@nestjs/testing`'s own `TestingModuleBuilder.compile` — no
 * `callOnModuleInit` there) — `moduleRef.init()` below is what makes
 * `DomainEventDispatcher` actually register `PhotoSetStatusChangedHandler`.
 *
 * Skipped when `TEST_DATABASE_URL` is absent — same convention as
 * `photo-review-persistence.spec.ts`, which this file complements rather
 * than duplicates (that file owns the locking-rule matrix; this one owns
 * the print-integration seam, the approve/reject idempotency gap, real
 * concurrency, and `listEvents`).
 */
const url = process.env.TEST_DATABASE_URL;
const describeDb = url ? describe : describe.skip;

describeDb(
  'photo-review live flows (print integration, concurrency, events)',
  () => {
    let service: PhotoReviewService;
    let dataSource: DataSource;
    let moduleRef: TestingModule;
    let kindId: string;
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
        edit: jest.fn(),
      };
      // Every call in this suite passes a null or a real-but-unassigned
      // actorUserId — never exercising the per-campaign assignment table
      // another agent is actively rewriting concurrently (see this task's own
      // brief) — so a plain "always in scope" fake is enough and keeps this
      // suite decoupled from that work-in-progress.
      const reviewAssignments = {
        assertInScope: jest.fn().mockResolvedValue(undefined),
        buildScopeFilter: jest.fn().mockResolvedValue(null),
      };

      const built = await Test.createTestingModule({
        imports: [
          FoundationModule,
          TypeOrmModule.forRoot({
            type: 'postgres',
            url,
            entities: [
              SubjectPhotoSet,
              PhotoVariant,
              PhotoReviewEvent,
              PhotoKind,
              PrintItem,
              PrintItemEvent,
              PrintBatch,
              Printer,
            ],
            namingStrategy: new SnakeNamingStrategy(),
            synchronize: false,
          }),
          TypeOrmModule.forFeature([
            SubjectPhotoSet,
            PhotoVariant,
            PhotoReviewEvent,
            PhotoKind,
            PrintItem,
            PrintItemEvent,
            PrintBatch,
          ]),
        ],
        providers: [
          PhotoReviewService,
          PhotoKindService,
          // Real — zero constructor deps of its own (every method takes an
          // explicit `manager`), so using the real implementation here (rather
          // than faking it, as the sibling locking-rule spec does) lets the
          // double-approve/concurrency tests below assert on real
          // `stats_daily_review` rows.
          ReviewStatsService,
          { provide: FileStorageService, useValue: fileStorage },
          { provide: PhotoReviewSidecarService, useValue: sidecar },
          { provide: ConfigService, useValue: { get: () => 'test-api-key' } },
          { provide: ReviewAssignmentService, useValue: reviewAssignments },
          // `onSetApproved`/`onSetLeftApproved` are pure `manager`-driven (see
          // their own doc comments) — every OTHER constructor dep is
          // irrelevant here, same `undefined as never` convention
          // `print-item.service.auto-attach.spec.ts` already uses.
          {
            provide: PrintItemService,
            useFactory: () =>
              new PrintItemService(
                undefined as never,
                undefined as never,
                undefined as never,
                undefined as never,
                undefined as never,
                undefined as never,
                undefined as never,
                undefined as never,
                undefined as never,
              ),
          },
          // Real, DI-constructed — this is the actual provider
          // `DomainEventDispatcher.onModuleInit()` must discover via
          // `DiscoveryService` for this suite to mean anything.
          PhotoSetStatusChangedHandler,
        ],
      }).compile();

      moduleRef = built;
      // Triggers DomainEventDispatcher.onModuleInit() — see this describe
      // block's own doc comment for why compile() alone is not enough.
      await moduleRef.init();

      service = built.get(PhotoReviewService);
      dataSource = built.get(DataSource);

      const kindRow: Array<{ id: string }> = await dataSource.query(
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

    // Every fixture id created by a test is pushed here and deleted by exact
    // id in afterEach — deliberately NOT a blanket `DELETE FROM print_items`
    // etc. (unlike this module's sibling persistence spec's blanket
    // `subject_photo_sets`/`photos`/`sessions` sweep): `print_items`/
    // `print_batches`/`users` are tables a real deployment can already hold
    // real rows in, so this suite only ever removes exactly what it created.
    let cleanup: {
      setIds: string[];
      sessionIds: string[];
      batchIds: string[];
      userIds: string[];
      campaignIds: string[];
    };

    beforeEach(() => {
      cleanup = {
        setIds: [],
        sessionIds: [],
        batchIds: [],
        userIds: [],
        campaignIds: [],
      };
    });

    afterEach(async () => {
      if (cleanup.setIds.length) {
        // Cascades to photo_variants/photo_review_events (FK ON DELETE
        // CASCADE — see migration 1800000000000-CreatePhotoReview.ts) but NOT
        // to print_items (deliberately no FK — cross-module boundary), so
        // those are swept separately below.
        await dataSource.query(
          `DELETE FROM subject_photo_sets WHERE id = ANY($1)`,
          [cleanup.setIds],
        );
        await dataSource.query(
          `DELETE FROM print_items WHERE set_id = ANY($1)`,
          [cleanup.setIds],
        );
      }
      if (cleanup.sessionIds.length) {
        await dataSource.query(
          `DELETE FROM photos WHERE session_id = ANY($1)`,
          [cleanup.sessionIds],
        );
        await dataSource.query(`DELETE FROM sessions WHERE id = ANY($1)`, [
          cleanup.sessionIds,
        ]);
      }
      if (cleanup.batchIds.length) {
        await dataSource.query(`DELETE FROM print_batches WHERE id = ANY($1)`, [
          cleanup.batchIds,
        ]);
      }
      if (cleanup.userIds.length) {
        await dataSource.query(`DELETE FROM users WHERE id = ANY($1)`, [
          cleanup.userIds,
        ]);
      }
      if (cleanup.campaignIds.length) {
        // `ReviewStatsService` (the real implementation in this suite, not
        // faked — see this describe block's own doc comment) writes here on
        // every approve()/reject(); it has no set_id column, only
        // (date, campaignId, reviewerUserId), so it needs its own sweep by
        // the fake campaignId every test pushes onto this array.
        await dataSource.query(
          `DELETE FROM stats_daily_review WHERE campaign_id = ANY($1)`,
          [cleanup.campaignIds],
        );
      }
    });

    /** Mirrors `photo-review-persistence.spec.ts`'s own `seedSet` — duplicated rather than imported/shared, deliberately: that file's helper has no `campaignId`/roster-field override this suite needs. */
    async function seedApprovableSet(opts: {
      campaignId: string;
      subjectCode?: string;
      subjectName?: string;
      className?: string | null;
      faculty?: string | null;
    }): Promise<{ setId: string; variantId: string; sessionId: string }> {
      const setId = randomUUID();
      const sessionId = randomUUID();
      const variantId = randomUUID();
      const subjectCode =
        opts.subjectCode ?? `ZZTEST-${randomUUID().slice(0, 8)}`;

      await dataSource.query(`INSERT INTO sessions (id) VALUES ($1)`, [
        sessionId,
      ]);
      await dataSource.query(
        `INSERT INTO subject_photo_sets
         (id, campaign_id, subject_code, subject_name, class_name, faculty, kind_id, source_session_id, status, current_card_variant_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NULL, now(), now())`,
        [
          setId,
          opts.campaignId,
          subjectCode,
          opts.subjectName ?? 'Nguyen Van ZZTest',
          opts.className ?? null,
          opts.faculty ?? null,
          kindId,
          sessionId,
          PhotoReviewSetStatus.READY,
        ],
      );
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
      // `aiEdit`'s "is this a usable source variant" gate accepts either
      // `fsFileId` (which would need a real fs-core round trip to actually
      // fetch bytes from — not worth wiring here) or local outbox content
      // (`hasLocalVariantContent`/`readVariantBytes`, both checked first) —
      // a plain local row is the cheaper, fully-offline way to make this
      // fixture variant usable as an `aiEdit` source.
      await dataSource.query(
        `INSERT INTO variant_upload_outbox (variant_id, idem_key, virtual_path, mime_type, content)
       VALUES ($1, $2, 'zztest/fake.jpg', 'image/jpeg', $3)`,
        [variantId, `zztest-seed-${variantId}`, Buffer.from('fake-auto-bytes')],
      );
      await dataSource.query(
        `UPDATE subject_photo_sets SET current_card_variant_id = $1 WHERE id = $2`,
        [variantId, setId],
      );
      return { setId, variantId, sessionId };
    }

    async function seedCentralizedBatch(campaignId: string): Promise<string> {
      const batchId = randomUUID();
      await dataSource.query(
        `INSERT INTO print_batches (id, code, name, campaign_id, mode, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'CENTRALIZED', 'DRAFT', now(), now())`,
        [batchId, `ZZTEST-${batchId.slice(0, 8)}`, 'ZZTest batch', campaignId],
      );
      return batchId;
    }

    describe('approve/reject → print auto-attach integration (task item 2)', () => {
      it('approve() on a READY set with an open CENTRALIZED batch creates a PENDING print_items row attached to it, with correct denormalized fields', async () => {
        const campaignId = randomUUID();
        cleanup.campaignIds.push(campaignId);
        const batchId = await seedCentralizedBatch(campaignId);
        cleanup.batchIds.push(batchId);
        const { setId, variantId, sessionId } = await seedApprovableSet({
          campaignId,
          subjectName: 'Tran Thi ZZTest',
          className: 'D20CQZZ01',
          faculty: 'ZZTest Faculty',
        });
        cleanup.setIds.push(setId);
        cleanup.sessionIds.push(sessionId);

        const result = await service.approve(setId, {}, null, apiBaseUrl);
        expect(result.status).toBe(PhotoReviewSetStatus.APPROVED);

        const items: Array<{
          batch_id: string | null;
          status: string;
          variant_id: string | null;
          subject_code: string;
          full_name: string | null;
          class_name: string | null;
          faculty: string | null;
        }> = await dataSource.query(
          `SELECT batch_id, status, variant_id, subject_code, full_name, class_name, faculty
           FROM print_items WHERE set_id = $1`,
          [setId],
        );
        expect(items).toHaveLength(1);
        expect(items[0].batch_id).toBe(batchId);
        expect(items[0].status).toBe('PENDING');
        expect(items[0].variant_id).toBe(variantId);
        expect(items[0].full_name).toBe('Tran Thi ZZTest');
        expect(items[0].class_name).toBe('D20CQZZ01');
        expect(items[0].faculty).toBe('ZZTest Faculty');

        const batch: Array<{ item_count: number }> = await dataSource.query(
          `SELECT item_count FROM print_batches WHERE id = $1`,
          [batchId],
        );
        expect(batch[0].item_count).toBe(1);
      });

      it('reject() on a set whose active print item is still PENDING cancels that item and decrements the batch counter', async () => {
        const campaignId = randomUUID();
        cleanup.campaignIds.push(campaignId);
        const batchId = await seedCentralizedBatch(campaignId);
        cleanup.batchIds.push(batchId);
        const { setId, sessionId } = await seedApprovableSet({ campaignId });
        cleanup.setIds.push(setId);
        cleanup.sessionIds.push(sessionId);

        await service.approve(setId, {}, null, apiBaseUrl);
        const result = await service.reject(
          setId,
          { note: 'anh mo, chup lai' },
          null,
          apiBaseUrl,
        );
        expect(result.status).toBe(PhotoReviewSetStatus.REJECTED);

        const items: Array<{ status: string }> = await dataSource.query(
          `SELECT status FROM print_items WHERE set_id = $1`,
          [setId],
        );
        expect(items).toHaveLength(1);
        expect(items[0].status).toBe('CANCELLED');

        const batch: Array<{ item_count: number }> = await dataSource.query(
          `SELECT item_count FROM print_batches WHERE id = $1`,
          [batchId],
        );
        expect(batch[0].item_count).toBe(0);
      });

      it('FIXED: reject() on a set whose print item is already EXPORTED is now blocked with a 409 Conflict — the set status and the print item are both left untouched', async () => {
        const campaignId = randomUUID();
        cleanup.campaignIds.push(campaignId);
        const batchId = await seedCentralizedBatch(campaignId);
        cleanup.batchIds.push(batchId);
        const { setId, sessionId } = await seedApprovableSet({ campaignId });
        cleanup.setIds.push(setId);
        cleanup.sessionIds.push(sessionId);

        await service.approve(setId, {}, null, apiBaseUrl);
        // Simulate the card having already been exported/handed to the print
        // shop (PrintBatchService.exportPackage's real end state).
        await dataSource.query(
          `UPDATE print_items SET status = 'EXPORTED' WHERE set_id = $1`,
          [setId],
        );

        await expect(
          service.reject(
            setId,
            { note: 'du da xuat file in' },
            null,
            apiBaseUrl,
          ),
        ).rejects.toMatchObject({
          payload: expect.objectContaining({
            code: PHOTO_REVIEW_ERROR_CODE.PRINT_ITEM_ALREADY_EXPORTED,
          }),
        });

        const setRow: Array<{ status: string }> = await dataSource.query(
          `SELECT status FROM subject_photo_sets WHERE id = $1`,
          [setId],
        );
        expect(setRow[0].status).toBe(PhotoReviewSetStatus.APPROVED); // unchanged — the throw rolled the transaction back

        const items: Array<{ status: string }> = await dataSource.query(
          `SELECT status FROM print_items WHERE set_id = $1`,
          [setId],
        );
        expect(items).toHaveLength(1);
        expect(items[0].status).toBe('EXPORTED'); // untouched
      });

      it('reject() still works normally when there is no print item at all (never approved into a batch, or no batch was ever open)', async () => {
        const campaignId = randomUUID();
        cleanup.campaignIds.push(campaignId);
        const { setId, sessionId } = await seedApprovableSet({ campaignId });
        cleanup.setIds.push(setId);
        cleanup.sessionIds.push(sessionId);

        // Never approved, so never auto-attached to any print item — the
        // EXPORTED/PRINTED guard must not misfire on a set with none.
        const result = await service.reject(setId, {}, null, apiBaseUrl);
        expect(result.status).toBe(PhotoReviewSetStatus.REJECTED);

        const items: Array<{ status: string }> = await dataSource.query(
          `SELECT status FROM print_items WHERE set_id = $1`,
          [setId],
        );
        expect(items).toHaveLength(0);
      });
    });

    describe('illegal-transition / idempotency gaps (task item 1)', () => {
      it('FIXED: approving an already-APPROVED set is now a no-op — exactly one photo_review_events row and stats_daily_review.approved stays at 1', async () => {
        const campaignId = randomUUID();
        cleanup.campaignIds.push(campaignId);
        const { setId, sessionId } = await seedApprovableSet({ campaignId });
        cleanup.setIds.push(setId);
        cleanup.sessionIds.push(sessionId);

        await service.approve(setId, { note: 'first' }, null, apiBaseUrl);
        // Re-approving an already-APPROVED set — assertUnlocked still lets
        // this reach transitionSetStatus (APPROVED is not a locked status),
        // but the idempotency guard added inside the locked transaction now
        // short-circuits before any write.
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
        expect(events).toHaveLength(1); // no duplicate audit-trail row

        const stats: Array<{ approved: number }> = await dataSource.query(
          `SELECT approved FROM stats_daily_review
          WHERE campaign_id = $1 AND reviewer_user_id = $2`,
          [campaignId, STATS_UNKNOWN_UUID],
        );
        expect(stats).toHaveLength(1);
        expect(Number(stats[0].approved)).toBe(1); // no longer double-counted
        // stats_daily_review row itself is swept in afterEach, by campaignId.
      });
    });

    describe('concurrency (task item 4)', () => {
      it('FIXED: two concurrent approve() calls on the same set both resolve (no crash), exactly one print_items row is created, and — since the idempotency fix — exactly one photo_review_events row too, not two', async () => {
        const campaignId = randomUUID();
        cleanup.campaignIds.push(campaignId);
        const batchId = await seedCentralizedBatch(campaignId);
        cleanup.batchIds.push(batchId);
        const { setId, sessionId } = await seedApprovableSet({ campaignId });
        cleanup.setIds.push(setId);
        cleanup.sessionIds.push(sessionId);

        const [r1, r2] = await Promise.allSettled([
          service.approve(setId, { note: 'race-1' }, null, apiBaseUrl),
          service.approve(setId, { note: 'race-2' }, null, apiBaseUrl),
        ]);

        // Real finding: `lockSet`'s `SELECT ... FOR UPDATE` serializes the two
        // transactions (the second blocks until the first commits) rather
        // than one of them failing outright — so both settle successfully.
        expect(r1.status).toBe('fulfilled');
        expect(r2.status).toBe('fulfilled');

        const setRow: Array<{ status: string }> = await dataSource.query(
          `SELECT status FROM subject_photo_sets WHERE id = $1`,
          [setId],
        );
        expect(setRow[0].status).toBe(PhotoReviewSetStatus.APPROVED); // no half-applied state

        const items: Array<{ id: string }> = await dataSource.query(
          `SELECT id FROM print_items WHERE set_id = $1`,
          [setId],
        );
        expect(items).toHaveLength(1); // NOT duplicated — the print-side guard holds under real concurrency

        const events: Array<{ action: string }> = await dataSource.query(
          `SELECT action FROM photo_review_events WHERE set_id = $1 AND action = 'APPROVED'`,
          [setId],
        );
        expect(events).toHaveLength(1); // the idempotency fix holds under real concurrency too, not just a sequential double-click
        // stats_daily_review row itself is swept in afterEach, by campaignId.
      });
    });

    describe('listEvents (task item 6)', () => {
      it('returns events newest-first, paginates correctly, and resolves the real actor display name', async () => {
        const userId = randomUUID();
        await dataSource.query(
          `INSERT INTO users (id, sso_user_code, email, display_name, is_admin)
         VALUES ($1, $2, $3, $4, false)`,
          [
            userId,
            `zztest-${userId.slice(0, 8)}`,
            `zztest-${userId.slice(0, 8)}@example.com`,
            'Pham Van ZZTest Reviewer',
          ],
        );
        cleanup.userIds.push(userId);

        const campaignId = randomUUID();
        cleanup.campaignIds.push(campaignId);
        const { setId, sessionId } = await seedApprovableSet({ campaignId });
        cleanup.setIds.push(setId);
        cleanup.sessionIds.push(sessionId);

        await service.approve(
          setId,
          { note: 'approve-first' },
          userId,
          apiBaseUrl,
        );
        await service.reject(
          setId,
          { note: 'reject-second' },
          userId,
          apiBaseUrl,
        );

        const page1 = await service.listEvents(setId, { page: 1, limit: 1 });
        expect(page1.meta.totalItems).toBe(2);
        expect(page1.items).toHaveLength(1);
        expect(page1.items[0].action).toBe('REJECTED'); // newest first
        expect(page1.items[0].actorName).toBe('Pham Van ZZTest Reviewer');

        const page2 = await service.listEvents(setId, { page: 2, limit: 1 });
        expect(page2.items).toHaveLength(1);
        expect(page2.items[0].action).toBe('APPROVED');
        expect(page2.items[0].actorName).toBe('Pham Van ZZTest Reviewer');
      });
    });

    describe('variant lifecycle race (task item 3 / known bug pattern: stale in-memory entity .save() after an async gap)', () => {
      it("FIXED: discardVariant() on an in-flight AI-edit variant is no longer reverted to READY once aiEdit()'s own delayed sidecar call resolves — the guarded UPDATE (WHERE status = 'PROCESSING') is a no-op once the row has already moved to DISCARDED", async () => {
        const campaignId = randomUUID();
        cleanup.campaignIds.push(campaignId);
        const { setId, sessionId } = await seedApprovableSet({ campaignId });
        cleanup.setIds.push(setId);
        cleanup.sessionIds.push(sessionId);

        // `PhotoReviewSidecarService` is DI-overridden with a plain
        // `{ edit: jest.fn(), ... }` object at construction (see beforeAll)
        // — `moduleRef.get()` types the return as the real class, whose
        // `edit` is a plain async method with no `.mockImplementation`, same
        // `@typescript-eslint/no-unsafe-call` this module's sibling
        // locking-rule spec already accepts for its own `cardPhoto`/`edit`
        // mock usage (see that file's own doc comment on this exact
        // trade-off) rather than fight `no-unnecessary-type-assertion` over
        // a cast TS considers redundant here.
        const sidecar = moduleRef.get(PhotoReviewSidecarService);
        // Long enough for discardVariant() below to land well before this
        // resolves — aiEdit() awaits this synchronously for the whole
        // duration (see that method's own doc comment), which is exactly the
        // "long async gap" the in-memory `variant` object is held across.
        sidecar.edit.mockImplementation(
          () =>
            new Promise((resolve) =>
              setTimeout(
                () =>
                  resolve({
                    imageBase64:
                      Buffer.from('fake-ai-bytes').toString('base64'),
                    mimeType: 'image/jpeg',
                    width: 100,
                    height: 100,
                  }),
                300,
              ),
            ),
        );

        const aiEditPromise = service.aiEdit(
          setId,
          { prompt: 'nen trang deu' },
          null,
          apiBaseUrl,
        );

        // Poll for the PROCESSING CARD_AI variant aiEdit's own first
        // (already-committed) transaction creates before it ever calls the
        // sidecar — this is exactly the row a second reviewer polling
        // GET /v1/review/sets/:id mid-flight would also see and could act on.
        let aiVariantId: string | null = null;
        for (let i = 0; i < 20 && !aiVariantId; i++) {
          const rows: Array<{ id: string }> = await dataSource.query(
            `SELECT id FROM photo_variants WHERE set_id = $1 AND kind = 'CARD_AI' AND status = 'PROCESSING'`,
            [setId],
          );
          aiVariantId = rows[0]?.id ?? null;
          if (!aiVariantId) await new Promise((r) => setTimeout(r, 20));
        }
        expect(aiVariantId).not.toBeNull();

        // A second reviewer discards it while aiEdit() is still awaiting the
        // sidecar — legal per discardVariant()'s own rules (it only refuses a
        // DISCARDED variant or the set's current one; PROCESSING is neither).
        await service.discardVariant(aiVariantId as string, null, apiBaseUrl);
        const afterDiscard: Array<{ status: string }> = await dataSource.query(
          `SELECT status FROM photo_variants WHERE id = $1`,
          [aiVariantId],
        );
        expect(afterDiscard[0].status).toBe(PhotoVariantStatus.DISCARDED);

        await aiEditPromise;

        const afterAiEdit: Array<{ status: string }> = await dataSource.query(
          `SELECT status FROM photo_variants WHERE id = $1`,
          [aiVariantId],
        );
        // The fix: aiEdit()'s success handler now does a guarded
        // `UPDATE photo_variants SET status = 'READY', ... WHERE id = $1 AND
        // status = 'PROCESSING'` instead of a blind `save()` on the stale
        // in-memory entity — since the row already moved to DISCARDED by
        // the time this runs, the UPDATE matches zero rows and is a no-op.
        expect(afterAiEdit[0].status).toBe(PhotoVariantStatus.DISCARDED);

        const set: Array<{ current_card_variant_id: string | null }> =
          await dataSource.query(
            `SELECT current_card_variant_id FROM subject_photo_sets WHERE id = $1`,
            [setId],
          );
        expect(set[0].current_card_variant_id).not.toBe(aiVariantId);
      });
    });
  },
);
