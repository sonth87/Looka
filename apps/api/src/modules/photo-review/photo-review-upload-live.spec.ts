import { FileStorageService } from '@app/modules/file-storage/services/file-storage.service';
import { ReviewStatsService } from '@app/modules/stats/services/review-stats.service';
import { FsError } from '@face/fs-client';
import { DomainEventDispatcher } from '@app/shared/cqrs/domain-event.dispatcher';
import { TransactionContext } from '@app/shared/database/transaction-context';
import { getQueueToken } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { config as loadDotenv } from 'dotenv';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { DataSource } from 'typeorm';
import { SnakeNamingStrategy } from 'typeorm-naming-strategies';
import { PhotoKind } from './entities/photo-kind.entity';
import { PhotoReviewEvent } from './entities/photo-review-event.entity';
import { PhotoVariant } from './entities/photo-variant.entity';
import { SubjectPhotoSet } from './entities/subject-photo-set.entity';
import {
  AI_EDIT_QUEUE_NAME,
  AiEditJobKind,
  PHOTO_REVIEW_ERROR_CODE,
  PhotoReviewSetStatus,
  PhotoVariantKind,
  PhotoVariantStatus,
} from './photo-review.constants';
import { PHOTO_AI_PORT } from './application/ports/photo-ai.port';
import type { AiEditJobData } from './services/ai-edit.processor';
import { AiImageEditClient } from './services/ai-image-edit.client';
import { PhotoAiAdapter } from './services/photo-ai.adapter';
import { PhotoKindService } from './services/photo-kind.service';
import { PhotoReviewSidecarService } from './services/photo-review-sidecar.service';
import { PhotoReviewService } from './services/photo-review.service';
import { ReviewAssignmentService } from './services/review-assignment.service';
import { VariantUploadWorkerService } from './services/variant-upload-worker.service';
import { WorkflowCatalogReadRepository } from '@app/modules/workflow/infrastructure/read/workflow-catalog.read-repository';

// Unlike this module's sibling specs, this suite needs the REAL FS_BASE_URL/
// FS_API_KEY (not just TEST_DATABASE_URL) to exercise a genuine
// VariantUploadWorkerService.drain() against the real dev fs-core — loading
// apps/api/.env here (dotenv never overrides an already-exported env var, so
// an explicit `$env:FS_BASE_URL=...` before `jest` still wins) makes this
// file runnable the same way as every other spec here, `pnpm test`, without
// requiring the caller to export those two vars by hand first.
loadDotenv({ path: resolve(__dirname, '../../../.env') });

/**
 * Live coverage for `uploadVariant()` (task ask: "confirm live — create a
 * fixture set, call uploadVariant() with a real small JPEG buffer, confirm a
 * PhotoVariant row + outbox row appear, drain the outbox worker for real,
 * confirm fs_file_id gets set"), plus `acceptVariant()`'s interaction with
 * it, and the assertUnlocked matrix for `uploadVariant()`/`aiEdit()` — which
 * had ZERO test coverage anywhere in this module before this task
 * (`photo-review-persistence.spec.ts` covers `approve`/`reject`/
 * `discardVariant`/`setCurrent`'s locking rules and the AI prompt filter,
 * but never calls `uploadVariant` even once, and `photo-review-live-flows.
 * spec.ts` owns the print-integration/concurrency/events seams instead — see
 * each file's own doc comment for its scope).
 *
 * `PhotoReviewSidecarService` is mocked (same seam every sibling spec in
 * this module uses) — confirmed live during this task that the real Python
 * AI sidecar is NOT reachable in this dev environment (`curl
 * 127.0.0.1:8321/api/v1/health` → connection refused), so `cardPhoto()`/
 * `identitySimilarity()` are stubbed with realistic return shapes rather
 * than actually invoked.
 *
 * `FileStorageService` is REAL here (unlike every sibling spec, which mocks
 * it) — this suite's whole point is to prove `VariantUploadWorkerService`
 * actually pushes a variant's local-first bytes to the real file-service,
 * confirmed reachable live (`curl -o /dev/null -w '%{http_code}'
 * http://<FS_BASE_URL host>/api/v1/health` → 401, i.e. reachable, just
 * unauthenticated without a key). Skipped (not failed) when FS_BASE_URL/
 * FS_API_KEY are unavailable, same "degrade gracefully" pattern as the
 * TEST_DATABASE_URL gate.
 */
const url = process.env.TEST_DATABASE_URL;
const fsBaseUrl = process.env.FS_BASE_URL;
const fsApiKey = process.env.FS_API_KEY;
const canRunDb = Boolean(url);
const canRunFsCore = Boolean(fsBaseUrl && fsApiKey);
const describeDb = canRunDb ? describe : describe.skip;

describeDb('photo-review uploadVariant/acceptVariant (live)', () => {
  let service: PhotoReviewService;
  let dataSource: DataSource;
  let moduleRef: TestingModule;
  let kindId: string;
  let sidecar: {
    cardPhoto: jest.Mock;
    identitySimilarity: jest.Mock;
  };
  let aiImageEdit: {
    edit: jest.Mock;
    health: jest.Mock;
  };
  let workflowCatalog: {
    getVersionRef: jest.Mock;
  };
  let aiEditQueue: { add: jest.Mock };
  const apiBaseUrl = 'http://localhost:3100';

  const tinyJpeg = () =>
    // Not a real, decodable JPEG — irrelevant here, since `cardPhoto()`/
    // `identitySimilarity()` are both mocked below and never actually decode
    // these bytes; only their presence/size/mime matter to `uploadVariant()`
    // before it ever reaches the sidecar.
    Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);

  beforeAll(async () => {
    const realFileStorage = new FileStorageService({
      get: (key: string) => {
        if (key === 'fileService.baseUrl') return fsBaseUrl;
        if (key === 'fileService.apiKey') return fsApiKey;
        if (key === 'fileService.tenant') return 'looka-face-capture';
        return undefined;
      },
    } as unknown as ConfigService);
    if (canRunFsCore) {
      await realFileStorage.onModuleInit();
    }

    sidecar = {
      cardPhoto: jest.fn().mockResolvedValue({
        imageBase64: Buffer.from('fake-card-bytes').toString('base64'),
        mimeType: 'image/jpeg',
        width: 480,
        height: 640,
        dpi: 300,
        warnings: [],
      }),
      identitySimilarity: jest.fn().mockResolvedValue({ similarity: 0.92 }),
    };
    aiImageEdit = {
      edit: jest.fn().mockResolvedValue({
        imageBuffer: Buffer.from('fake-ai-bytes'),
        mimeType: 'image/jpeg',
        seed: null,
        durationMs: null,
      }),
      health: jest.fn(),
    };

    const reviewAssignments = {
      assertInScope: jest.fn().mockResolvedValue(undefined),
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
    // No campaign in this suite is workflow-pinned by default —
    // `resolveAiProcessingSteps` should see "no version ref" and fall back
    // to the pre-executor single `makeCardPhoto` call every existing
    // assertion here already expects. One test below (the AI-pipeline
    // executor test) overrides this per-call with `mockResolvedValueOnce`.
    workflowCatalog = {
      getVersionRef: jest.fn().mockResolvedValue(null),
    };
    aiEditQueue = { add: jest.fn().mockResolvedValue(undefined) };

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
        { provide: FileStorageService, useValue: realFileStorage },
        { provide: PhotoReviewSidecarService, useValue: sidecar },
        { provide: AiImageEditClient, useValue: aiImageEdit },
        { provide: PHOTO_AI_PORT, useClass: PhotoAiAdapter },
        { provide: ConfigService, useValue: { get: () => 'test-api-key' } },
        { provide: ReviewAssignmentService, useValue: reviewAssignments },
        { provide: ReviewStatsService, useValue: reviewStats },
        { provide: TransactionContext, useValue: transactionContext },
        { provide: DomainEventDispatcher, useValue: domainEventDispatcher },
        { provide: WorkflowCatalogReadRepository, useValue: workflowCatalog },
        {
          provide: getQueueToken(AI_EDIT_QUEUE_NAME),
          useValue: aiEditQueue,
        },
      ],
    }).compile();

    moduleRef = built;
    service = built.get(PhotoReviewService);
    dataSource = built.get(DataSource);

    const kindRow: Array<{ id: string }> = await dataSource.query(
      `SELECT id FROM photo_kinds WHERE code = 'STUDENT_CARD' LIMIT 1`,
    );
    if (kindRow.length === 0) {
      throw new Error(
        'STUDENT_CARD photo kind not found — run migrations against TEST_DATABASE_URL first',
      );
    }
    kindId = kindRow[0].id;
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  let cleanup: { setIds: string[]; sessionIds: string[] };

  beforeEach(() => {
    cleanup = { setIds: [], sessionIds: [] };
    sidecar.cardPhoto.mockClear();
    sidecar.identitySimilarity.mockClear();
    aiImageEdit.edit.mockClear();
    workflowCatalog.getVersionRef.mockClear();
    aiEditQueue.add.mockClear();
  });

  afterEach(async () => {
    if (cleanup.setIds.length) {
      // Cascades to photo_variants/photo_review_events/variant_upload_outbox
      // (FK ON DELETE CASCADE) but not to print_items (no FK, cross-module
      // boundary — swept separately, same as photo-review-live-flows.spec.ts).
      await dataSource.query(`DELETE FROM print_items WHERE set_id = ANY($1)`, [
        cleanup.setIds,
      ]);
      await dataSource.query(
        `DELETE FROM subject_photo_sets WHERE id = ANY($1)`,
        [cleanup.setIds],
      );
    }
    if (cleanup.sessionIds.length) {
      await dataSource.query(
        `DELETE FROM upload_outbox WHERE photo_id IN (SELECT id FROM photos WHERE session_id = ANY($1))`,
        [cleanup.sessionIds],
      );
      await dataSource.query(`DELETE FROM photos WHERE session_id = ANY($1)`, [
        cleanup.sessionIds,
      ]);
      await dataSource.query(`DELETE FROM sessions WHERE id = ANY($1)`, [
        cleanup.sessionIds,
      ]);
    }
  });

  /**
   * `aiEdit()`/`reprocess()` now only enqueue onto the `ai-edit` BullMQ
   * queue (`aiEditQueue`, mocked above) instead of running the real
   * `/edit`/sidecar call inline — 2026-09-29 ("đẩy vào queue, lock lại chỉ
   * cho 1 tiến trình chạy", later "sử dụng bullmq ... tạo 1 processor để
   * xử lý"). This finds the most recent `.add()` call queued for
   * `variantId` and runs the same `PhotoReviewService.process*Job` method
   * `AiEditProcessor` would eventually call, synchronously, so tests can
   * assert on the FINAL (READY/FAILED) state without a real Redis worker
   * loop.
   */
  async function runQueuedJob(variantId: string): Promise<void> {
    const calls = aiEditQueue.add.mock.calls as Array<
      [AiEditJobKind, AiEditJobData]
    >;
    const call = [...calls]
      .reverse()
      .find(([, data]) => data.variantId === variantId);
    if (!call) {
      throw new Error(`no ai-edit queue job found for variant ${variantId}`);
    }
    const [kind, data] = call;
    if (kind === AiEditJobKind.REPROCESS) {
      await service.processReprocessJob(data.setId, variantId);
    } else {
      await service.processAiEditJob(data.setId, variantId, data.payload ?? {});
    }
  }

  /**
   * Seeds a fully-unlocked set (a READY CARD_AUTO current variant) plus a
   * real FRONT `photos` row with local-first bytes in `upload_outbox` —
   * exactly what `uploadVariant()`'s mandatory identity check
   * (`readSourcePhotoBytes`) needs to find bytes for, entirely offline
   * (no fs-core round trip needed to read the REFERENCE image; only the
   * uploaded candidate + the resulting card crop actually go to fs-core,
   * via VariantUploadWorkerService, further down).
   */
  async function seedUnlockedSetWithFrontPhoto(
    status: PhotoReviewSetStatus = PhotoReviewSetStatus.READY,
  ): Promise<{
    setId: string;
    sessionId: string;
    autoVariantId: string;
  }> {
    const setId = randomUUID();
    const sessionId = randomUUID();
    const autoVariantId = randomUUID();
    const campaignId = randomUUID();
    const subjectCode = `ZZTEST-${randomUUID().slice(0, 8)}`;
    const photoId = randomUUID();

    await dataSource.query(`INSERT INTO sessions (id) VALUES ($1)`, [
      sessionId,
    ]);
    await dataSource.query(
      `INSERT INTO photos (id, session_id, step_id, step_type, attempt, mime_type, bytes, sha256)
       VALUES ($1, $2, 'step-front', 'FRONT', 1, 'image/jpeg', 10, 'deadbeef')`,
      [photoId, sessionId],
    );
    await dataSource.query(
      `INSERT INTO upload_outbox (photo_id, idem_key, virtual_path, mime_type, content)
       VALUES ($1, $2, 'zztest/front.jpg', 'image/jpeg', $3)`,
      [photoId, `zztest-front-${photoId}`, tinyJpeg()],
    );

    await dataSource.query(
      `INSERT INTO subject_photo_sets
         (id, campaign_id, subject_code, kind_id, source_session_id, status, current_card_variant_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NULL, now(), now())`,
      [setId, campaignId, subjectCode, kindId, sessionId, status],
    );
    await dataSource.query(
      `INSERT INTO photo_variants (id, set_id, version, kind, source_photo_id, status, created_at, updated_at)
       VALUES ($1, $2, 1, $3, $4, $5, now(), now())`,
      [
        autoVariantId,
        setId,
        PhotoVariantKind.CARD_AUTO,
        photoId,
        PhotoVariantStatus.READY,
      ],
    );
    await dataSource.query(
      // Give the CARD_AUTO variant local bytes too, so it is a usable aiEdit
      // source in the acceptVariant test below without a fs-core round trip.
      `INSERT INTO variant_upload_outbox (variant_id, idem_key, virtual_path, mime_type, content)
       VALUES ($1, $2, 'zztest/auto.jpg', 'image/jpeg', $3)`,
      [autoVariantId, `zztest-auto-${autoVariantId}`, tinyJpeg()],
    );
    await dataSource.query(
      `UPDATE subject_photo_sets SET current_card_variant_id = $1 WHERE id = $2`,
      [autoVariantId, setId],
    );

    return { setId, sessionId, autoVariantId };
  }

  describe('uploadVariant() happy path + real outbox drain', () => {
    it('creates a CARD_UPLOAD variant, sets it as current immediately (no separate accept step — confirmed by reading the source: uploadVariant() itself writes current_card_variant_id), and writes a variant_upload_outbox row', async () => {
      const { setId, sessionId } = await seedUnlockedSetWithFrontPhoto();
      cleanup.setIds.push(setId);
      cleanup.sessionIds.push(sessionId);

      const result = await service.uploadVariant(
        setId,
        { buffer: tinyJpeg(), mimetype: 'image/jpeg', size: 10 },
        null,
        apiBaseUrl,
      );

      expect(result.variant.kind).toBe(PhotoVariantKind.CARD_UPLOAD);
      expect(result.variant.status).toBe(PhotoVariantStatus.READY);
      expect(result.identitySimilarity).toBeCloseTo(0.92, 5);
      expect(result.identityWarning).toBe(false); // 0.92 is above the 0.85 warn threshold

      const setRow: Array<{
        current_card_variant_id: string;
        status: string;
      }> = await dataSource.query(
        `SELECT current_card_variant_id, status FROM subject_photo_sets WHERE id = $1`,
        [setId],
      );
      expect(setRow[0].current_card_variant_id).toBe(result.variant.id);
      expect(setRow[0].status).toBe(PhotoReviewSetStatus.IN_REVIEW); // READY -> IN_REVIEW on any accepted change

      const outboxRows: Array<{ status: string; variant_id: string }> =
        await dataSource.query(
          `SELECT status, variant_id FROM variant_upload_outbox WHERE variant_id = $1`,
          [result.variant.id],
        );
      expect(outboxRows).toHaveLength(1);
      expect(outboxRows[0].status).toBe('PENDING'); // not sent yet — VariantUploadWorkerService hasn't run

      const events: Array<{ action: string }> = await dataSource.query(
        `SELECT action FROM photo_review_events WHERE set_id = $1 AND variant_id = $2`,
        [setId, result.variant.id],
      );
      expect(events.map((e) => e.action)).toContain('UPLOAD_REPLACED');
    });

    (canRunFsCore ? it : it.skip)(
      'draining VariantUploadWorkerService for real against the live fs-core sets fs_file_id/fs_status, the bytes round-trip byte-for-byte, and a second drain does not re-upload (idempotent no-op)',
      async () => {
        const { setId, sessionId } = await seedUnlockedSetWithFrontPhoto();
        cleanup.setIds.push(setId);
        cleanup.sessionIds.push(sessionId);

        const result = await service.uploadVariant(
          setId,
          { buffer: tinyJpeg(), mimetype: 'image/jpeg', size: 10 },
          null,
          apiBaseUrl,
        );

        const realFileStorage = moduleRef.get(FileStorageService);
        const uploadRawSpy = jest.spyOn(realFileStorage, 'uploadRaw');
        const worker = new VariantUploadWorkerService(
          dataSource,
          realFileStorage,
        );

        let fsFileId: string | null = null;
        for (let i = 0; i < 15 && !fsFileId; i++) {
          await worker.drain();
          const rows: Array<{ fs_file_id: string | null }> =
            await dataSource.query(
              `SELECT fs_file_id FROM photo_variants WHERE id = $1`,
              [result.variant.id],
            );
          fsFileId = rows[0]?.fs_file_id ?? null;
          if (!fsFileId) await new Promise((r) => setTimeout(r, 300));
        }

        expect(fsFileId).not.toBeNull();
        // Confirms task ask "what visibility/owner/tenant does this call
        // site actually use": the photo-review upload leg (unlike a
        // hypothetical per-device kiosk path) always goes through the
        // DEFAULT tenant (no `clientForTenant` call, one-arg `uploadRaw`)
        // with `visibility: 'public'` and no owner id at all — confirmed by
        // reading `VariantUploadWorkerService.send()`'s real call, and now
        // also confirmed live: this exact request shape was ACCEPTED (not
        // 403'd) by the currently-reachable dev fs-core deployment. This is
        // NOT proof that fs-core's own 2026-09-23 bare-API-key regression
        // (project memory: commit 0ff48f3, fix uncommitted in that separate
        // repo) is fixed/deployed everywhere — only that, right now, THIS
        // dev instance accepts THIS exact request.
        expect(uploadRawSpy).toHaveBeenCalledWith(
          expect.objectContaining({ visibility: 'public' }),
        );

        const outboxRows: Array<{ status: string }> = await dataSource.query(
          `SELECT status FROM variant_upload_outbox WHERE variant_id = $1`,
          [result.variant.id],
        );
        expect(outboxRows[0].status).toBe('UPLOADED');

        // Byte-correctness: fetch the file BACK from fs-core via a real
        // view-link + HTTP GET (not mocked) and confirm it is exactly the
        // bytes the mocked sidecar's cardPhoto() produced
        // ("fake-card-bytes", base64-decoded) — not corrupted, truncated, or
        // substituted in transit.
        const link = await realFileStorage.issueViewLink(
          fsFileId as string,
          'photo-review-live-spec-verify',
        );
        const res = await fetch(link.url);
        expect(res.ok).toBe(true);
        const fetched = Buffer.from(await res.arrayBuffer());
        expect(fetched.equals(Buffer.from('fake-card-bytes'))).toBe(true);

        // Idempotency: draining again finds nothing PENDING left to claim —
        // uploadRaw is not called a second time for the same variant (no
        // duplicate file/registration on a redundant drain tick, matching
        // this class's own idem_key-based idempotency doc comments).
        uploadRawSpy.mockClear();
        await worker.drain();
        expect(uploadRawSpy).not.toHaveBeenCalled();

        uploadRawSpy.mockRestore();
      },
      30_000,
    );

    it('a 401/403 from fs-core (bad API key) is classified non-retryable: the outbox row is marked FAILED and photo_variants.fs_file_id/fs_status are NEVER set — CONFIRMED GAP: this failure is then completely invisible everywhere a reviewer/admin would look (toVariantDao still reports READY with a working viewUrl via the local-content fallback, and exportApproved() silently skips this set as NO_CARD later)', async () => {
      const { setId, sessionId } = await seedUnlockedSetWithFrontPhoto();
      cleanup.setIds.push(setId);
      cleanup.sessionIds.push(sessionId);

      const result = await service.uploadVariant(
        setId,
        { buffer: tinyJpeg(), mimetype: 'image/jpeg', size: 10 },
        null,
        apiBaseUrl,
      );

      // NOTE on how this 401 is produced: a first attempt at this test
      // pointed a second FileStorageService at the SAME real fs-core with
      // a deliberately wrong API key, expecting a live 401. A raw `curl -X
      // POST .../api/v1/files -H "X-API-Key: <bad>"` against the real
      // dev fs-core DOES correctly come back `401 TOKEN_INVALID
      // {"message":"API key không hợp lệ"}` — the server-side auth check
      // itself is fine. But the LIVE dev API server is also running right
      // now on :3100 (confirmed via `netstat`) with its OWN real
      // `VariantUploadWorkerService` cron ticking every 3s against this
      // SAME shared `variant_upload_outbox` table with the CORRECT key —
      // `claimNext()`'s `FOR UPDATE SKIP LOCKED` has no per-test scoping
      // (documented risk, see `variant-upload-worker.service.spec.ts`'s
      // own top doc comment), so that real cron kept winning the race and
      // uploading this test's row successfully before the bad-key worker
      // could claim it, making the row come back UPLOADED instead of
      // FAILED — a test-isolation artifact of a shared dev DB, not
      // evidence against the bug this test exists to prove. Reverted to a
      // mocked `uploadRaw` throwing the EXACT real `FsError` shape just
      // confirmed live via curl, which is deterministic and still proves
      // the real code path (`VariantUploadWorkerService.recordFailure`) —
      // same "mock the seam, verify real behavior" convention this
      // module's sibling `variant-upload-worker.service.spec.ts` already
      // uses for its own terminal-failure case.
      const failingFileStorage = {
        uploadRaw: jest
          .fn()
          .mockRejectedValue(
            new FsError(401, 'TOKEN_INVALID', 'API key không hợp lệ'),
          ),
        cancelUpload: jest.fn().mockResolvedValue(undefined),
      };
      const worker = new VariantUploadWorkerService(
        dataSource,
        failingFileStorage as unknown as FileStorageService,
      );

      await worker.drain();

      const outboxRows: Array<{
        status: string;
        last_error: string | null;
      }> = await dataSource.query(
        `SELECT status, last_error FROM variant_upload_outbox WHERE variant_id = $1`,
        [result.variant.id],
      );
      expect(outboxRows[0].status).toBe('FAILED'); // terminal — a 401/403 is never retried (FsError.retryable is false for any 4xx except 409/429)
      expect(outboxRows[0].last_error).toBeTruthy();

      const variantRow: Array<{
        fs_file_id: string | null;
        fs_status: string | null;
        status: string;
      }> = await dataSource.query(
        `SELECT fs_file_id, fs_status, status FROM photo_variants WHERE id = $1`,
        [result.variant.id],
      );
      // The real bug this test proves: VariantUploadWorkerService.send()'s
      // catch path (recordFailure) only ever writes to
      // variant_upload_outbox — it never touches photo_variants at all.
      // photo_variants.status is still READY (set by uploadVariant()
      // itself, before any of this ran) and fs_file_id/fs_status are BOTH
      // still null, exactly as if nothing had ever gone wrong.
      expect(variantRow[0].status).toBe(PhotoVariantStatus.READY);
      expect(variantRow[0].fs_file_id).toBeNull();
      expect(variantRow[0].fs_status).toBeNull();

      // And the CMS-facing DAO (what ReviewDetailContent.tsx actually
      // renders) reflects exactly that blind spot: READY, with a real
      // viewUrl — resolved via the local-content fallback
      // (resolveVariantViewSource's 'local' branch), completely
      // indistinguishable from a variant that reached fs-core just fine.
      const dao = await service.getJob(result.variant.id, apiBaseUrl, null);
      expect(dao.status).toBe(PhotoVariantStatus.READY);
      expect(dao.viewUrl).toBeTruthy();
      expect(dao.viewUrl).toContain('/local-content');
    }, 30_000);
  });

  describe('acceptVariant() on a CARD_AI variant, interacting with a prior uploadVariant()', () => {
    it('accepting a newer CARD_AI variant moves current_card_variant_id off the CARD_UPLOAD variant onto it', async () => {
      const { setId, sessionId } = await seedUnlockedSetWithFrontPhoto();
      cleanup.setIds.push(setId);
      cleanup.sessionIds.push(sessionId);

      const uploadResult = await service.uploadVariant(
        setId,
        { buffer: tinyJpeg(), mimetype: 'image/jpeg', size: 10 },
        null,
        apiBaseUrl,
      );

      const queuedAiVariant = await service.aiEdit(
        setId,
        { prompt: 'nen trang deu', fromVariantId: uploadResult.variant.id },
        null,
        apiBaseUrl,
      );
      expect(queuedAiVariant.status).toBe(PhotoVariantStatus.PROCESSING);
      await runQueuedJob(queuedAiVariant.id);
      const aiVariant = await service.getJob(
        queuedAiVariant.id,
        apiBaseUrl,
        null,
      );
      expect(aiVariant.status).toBe(PhotoVariantStatus.READY);
      expect(aiVariant.kind).toBe(PhotoVariantKind.CARD_AI);
      // Confirms task item 1's own ask: aiEdit() never sets current by
      // itself (plan §6.2 rule 5, "con người chấp nhận") — the upload
      // variant is still current until an explicit accept() below.
      const beforeAccept: Array<{ current_card_variant_id: string }> =
        await dataSource.query(
          `SELECT current_card_variant_id FROM subject_photo_sets WHERE id = $1`,
          [setId],
        );
      expect(beforeAccept[0].current_card_variant_id).toBe(
        uploadResult.variant.id,
      );

      const accepted = await service.acceptVariant(
        aiVariant.id,
        null,
        apiBaseUrl,
      );
      expect(accepted.status).toBe(PhotoVariantStatus.READY);

      const afterAccept: Array<{ current_card_variant_id: string }> =
        await dataSource.query(
          `SELECT current_card_variant_id FROM subject_photo_sets WHERE id = $1`,
          [setId],
        );
      expect(afterAccept[0].current_card_variant_id).toBe(aiVariant.id);
    });
  });

  describe('assertUnlocked matrix for uploadVariant()/aiEdit() (no prior coverage for uploadVariant anywhere in this module)', () => {
    it('uploadVariant() is rejected with SET_LOCKED while status is PENDING_AUTO', async () => {
      const setId = randomUUID();
      const sessionId = randomUUID();
      await dataSource.query(`INSERT INTO sessions (id) VALUES ($1)`, [
        sessionId,
      ]);
      const campaignId = randomUUID();
      await dataSource.query(
        `INSERT INTO subject_photo_sets
           (id, campaign_id, subject_code, kind_id, source_session_id, status, current_card_variant_id, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NULL, now(), now())`,
        [
          setId,
          campaignId,
          `ZZTEST-${randomUUID().slice(0, 8)}`,
          kindId,
          sessionId,
          PhotoReviewSetStatus.PENDING_AUTO,
        ],
      );
      cleanup.setIds.push(setId);
      cleanup.sessionIds.push(sessionId);

      await expect(
        service.uploadVariant(
          setId,
          { buffer: tinyJpeg(), mimetype: 'image/jpeg', size: 10 },
          null,
          apiBaseUrl,
        ),
      ).rejects.toMatchObject({
        payload: expect.objectContaining({
          code: PHOTO_REVIEW_ERROR_CODE.SET_LOCKED,
        }),
      });
    });

    // CONFIRMED FINDING (task item 4 — reported, not fixed: see this task's
    // own report for why): `LOCKED_SET_STATUSES` (photo-review.constants.ts)
    // only ever contains PENDING_AUTO/AUTO_FAILED — APPROVED and REJECTED
    // are BOTH deliberately absent from it (REJECTED needs to stay editable
    // for the "reject, then fix, then re-approve" rework flow), so
    // `assertUnlocked` does not block ANY of uploadVariant/aiEdit/
    // acceptVariant/setCurrent on an APPROVED set — including one whose
    // print item has already been EXPORTED/PRINTED to a physical card. This
    // is asymmetric with the NEW reject-after-export block added earlier
    // this session (transitionSetStatus explicitly blocks REJECTING an
    // APPROVED+EXPORTED set), which only protects the *status* field, not
    // current_card_variant_id itself.
    it('CONFIRMED GAP: uploadVariant() (and therefore its automatic current_card_variant_id swap) is NOT blocked on an APPROVED set even when its print item is already EXPORTED', async () => {
      const { setId, sessionId } = await seedUnlockedSetWithFrontPhoto(
        PhotoReviewSetStatus.APPROVED,
      );
      cleanup.setIds.push(setId);
      cleanup.sessionIds.push(sessionId);
      const campaignRow: Array<{ campaign_id: string }> =
        await dataSource.query(
          `SELECT campaign_id FROM subject_photo_sets WHERE id = $1`,
          [setId],
        );
      await dataSource.query(
        `INSERT INTO print_items (campaign_id, set_id, subject_code, status)
         VALUES ($1, $2, $3, 'EXPORTED')`,
        [campaignRow[0].campaign_id, setId, `ZZTEST-${setId.slice(0, 8)}`],
      );

      const result = await service.uploadVariant(
        setId,
        { buffer: tinyJpeg(), mimetype: 'image/jpeg', size: 10 },
        null,
        apiBaseUrl,
      );
      expect(result.variant.status).toBe(PhotoVariantStatus.READY);

      const setRow: Array<{
        current_card_variant_id: string;
        status: string;
      }> = await dataSource.query(
        `SELECT current_card_variant_id, status FROM subject_photo_sets WHERE id = $1`,
        [setId],
      );
      // The set silently keeps current_card_variant_id pointed at the NEW
      // upload while status stays APPROVED and the (already-exported)
      // print_items row is left completely untouched — no error, no
      // warning, nothing in this response signals the mismatch.
      expect(setRow[0].current_card_variant_id).toBe(result.variant.id);
      expect(setRow[0].status).toBe(PhotoReviewSetStatus.APPROVED);

      const printItem: Array<{ status: string }> = await dataSource.query(
        `SELECT status FROM print_items WHERE set_id = $1`,
        [setId],
      );
      expect(printItem[0].status).toBe('EXPORTED'); // untouched — no cross-check happened
    });

    it('aiEdit() is likewise NOT blocked on a REJECTED set (by design — this is the "reject, then fix, then re-approve" rework flow, not a bug: REJECTED is intentionally absent from LOCKED_SET_STATUSES)', async () => {
      const { setId, sessionId } = await seedUnlockedSetWithFrontPhoto(
        PhotoReviewSetStatus.REJECTED,
      );
      cleanup.setIds.push(setId);
      cleanup.sessionIds.push(sessionId);

      const queuedAiVariant = await service.aiEdit(
        setId,
        { prompt: 'bo bui tren nen' },
        null,
        apiBaseUrl,
      );
      await runQueuedJob(queuedAiVariant.id);
      const aiVariant = await service.getJob(
        queuedAiVariant.id,
        apiBaseUrl,
        null,
      );
      expect(aiVariant.status).toBe(PhotoVariantStatus.READY);

      // And the set can be approved straight out of REJECTED afterwards,
      // confirming this really is a supported rework path, not dead code.
      const accepted = await service.acceptVariant(
        aiVariant.id,
        null,
        apiBaseUrl,
      );
      expect(accepted.id).toBe(aiVariant.id);
      const approved = await service.approve(setId, {}, null, apiBaseUrl);
      expect(approved.status).toBe(PhotoReviewSetStatus.APPROVED);
    });
  });

  describe('reprocess() driven by a configured ai_pipeline_steps pipeline (2026-09-28 executor)', () => {
    it("runs BOTH a CARD_CROP and an AI_EDIT_LIGHTING step in order (not just the single hardcoded card-crop) when the set's campaign is pinned to a workflow version with aiProcessing.enabled and those two steps configured", async () => {
      const { setId, sessionId } = await seedUnlockedSetWithFrontPhoto(
        PhotoReviewSetStatus.AUTO_FAILED,
      );
      cleanup.setIds.push(setId);
      cleanup.sessionIds.push(sessionId);

      // `resolveAiProcessingSteps` reads `campaigns.workflow_version_id` via
      // real SQL (this module owns no `campaigns` entity — see
      // `PhotoReviewService`'s own top doc comment) — needs a real row, even
      // though `workflowCatalog.getVersionRef` (which reads the actual
      // config behind that id) is mocked below.
      const workflowVersionId = randomUUID();
      const setRow: Array<{ campaign_id: string }> = await dataSource.query(
        `SELECT campaign_id FROM subject_photo_sets WHERE id = $1`,
        [setId],
      );
      const campaignId = setRow[0].campaign_id;
      await dataSource.query(
        `INSERT INTO campaigns (id, name, workflow_version_id) VALUES ($1, $2, $3)`,
        [campaignId, 'zztest ai-pipeline campaign', workflowVersionId],
      );
      try {
        workflowCatalog.getVersionRef.mockResolvedValueOnce({
          workflowId: randomUUID(),
          workflowCode: 'ZZTEST_WORKFLOW',
          version: 1,
          config: {
            aiProcessing: {
              enabled: true,
              steps: [
                { code: 'CARD_CROP', params: {} },
                { code: 'AI_EDIT_LIGHTING', params: {} },
              ],
            },
          },
        });

        const queuedDetail = await service.reprocess(setId, null, apiBaseUrl);
        // reprocess() now only enqueues (2026-09-29 queue) — the new
        // PROCESSING CARD_AUTO variant is already in `variants`, just not
        // promoted to `currentCardVariantId` yet.
        const queuedVariant = queuedDetail.variants.find(
          (v) =>
            v.kind === PhotoVariantKind.CARD_AUTO &&
            v.status === PhotoVariantStatus.PROCESSING,
        );
        expect(queuedVariant).toBeDefined();
        await runQueuedJob(queuedVariant!.id);
        const detail = await service.getSetDetail(setId, apiBaseUrl);

        // Both steps actually dispatched, in order — proving this ran the
        // configured 2-step pipeline rather than silently falling back to
        // the old single `makeCardPhoto` call.
        expect(sidecar.cardPhoto).toHaveBeenCalledTimes(1);
        expect(aiImageEdit.edit).toHaveBeenCalledTimes(1);
        expect(workflowCatalog.getVersionRef).toHaveBeenCalledWith(
          workflowVersionId,
        );
        // AI_EDIT ran last — the final stored variant is `aiImageEdit`'s
        // output, not `sidecar.cardPhoto`'s.
        const currentVariant = detail.variants.find(
          (v) => v.id === detail.currentCardVariantId,
        );
        expect(currentVariant?.status).toBe(PhotoVariantStatus.READY);
      } finally {
        await dataSource.query(`DELETE FROM campaigns WHERE id = $1`, [
          campaignId,
        ]);
      }
    });
  });
});
