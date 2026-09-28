import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { SnakeNamingStrategy } from 'typeorm-naming-strategies';
import { encryptSecret } from '@app/shared/security/secret.codec';
import {
  IntegrationOutcome,
  success,
  terminal,
} from '@app/shared/integrations/integration-outcome';
import { AdvisoryLockService } from '@app/shared/database/advisory-lock.service';
import {
  EligibilityHttpClient,
  type EligibilityApiConfig,
  type EligibilityListResult,
} from '@app/modules/workflow/infrastructure/integrations/eligibility-http.client';
import { CampaignSubjectPullFetchWorker } from './campaign-subject-pull-fetch.worker';
import { CampaignSubjectPullWriteWorker } from './campaign-subject-pull-write.worker';
import { CampaignSubjectPullStuckJobRecoveryWorker } from './campaign-subject-pull-stuck-job-recovery.worker';
import { Campaign } from '../entities/campaign.entity';
import { Device } from '../entities/device.entity';
import { CampaignSubjectImport } from '../entities/campaign-subject-import.entity';
import { CampaignSubject } from '../entities/campaign-subject.entity';
import { CampaignSubjectService } from '../services/campaign-subject.service';
import { RequestSubjectPullDto } from '../dto/request-subject-pull.dto';

/**
 * Live-DB audit of the EXTERNAL_API/ROSTER_AND_API roster-pull queue
 * (2026-09-28, user question: "does creating a campaign with an external-API
 * roster call it once, and is there a re-pull button"). Runs against a real
 * Postgres — same `TEST_DATABASE_URL`-gated convention as
 * `device-management-persistence.spec.ts`; skipped entirely otherwise so a
 * plain `pnpm test` never touches a live DB. Workers are instantiated
 * directly with `new` (they have trivial constructors, no Nest TestingModule
 * needed) and invoked directly (`.tick()`/`.drain()`) rather than waiting for
 * their `@Cron` schedules, same as prior live-worker audits this session.
 *
 * Uses ONE real, zero-PII call to the actual configured Dai Nam API
 * (`DAINAM_STUDENT_INFO_BASE_URL`/`_API_KEY` from `.env`) filtered down to a
 * `course_year` that matches no real student (confirmed empirically to
 * return `{success:true, data:[]}`) — proves the fetch worker really does
 * one real outbound HTTP call end-to-end (auth header, response parsing,
 * chunk table, status transitions) without ever pulling a single real
 * student's PII into this DB. Every other scenario (upsert on re-pull, a
 * student disappearing from the source, a failed call, a stuck job) needs
 * data this test controls precisely, so those use a hand-rolled
 * `EligibilityHttpClient`-shaped double instead of the real class — the real
 * external API has no way to "remove one student" on demand for a test.
 */
const url = process.env.TEST_DATABASE_URL;
const describeDb = url ? describe : describe.skip;

const REAL_DAINAM_BASE_URL = process.env.DAINAM_STUDENT_INFO_BASE_URL;
const REAL_DAINAM_API_KEY = process.env.DAINAM_STUDENT_INFO_API_KEY;
const describeRealApi =
  REAL_DAINAM_BASE_URL && REAL_DAINAM_API_KEY ? describe : describe.skip;

/** Minimal double matching the one method these workers call — no real HTTP. */
class FakeEligibilityHttpClient {
  constructor(
    private readonly impl: (
      config: EligibilityApiConfig,
    ) => Promise<IntegrationOutcome<EligibilityListResult>>,
  ) {}
  fetchAll(
    config: EligibilityApiConfig,
  ): Promise<IntegrationOutcome<EligibilityListResult>> {
    return this.impl(config);
  }
}

describeDb(
  'Campaign subject API pull — live DB audit (device-management)',
  () => {
    let dataSource: DataSource;
    const campaignIds: string[] = [];

    beforeAll(async () => {
      dataSource = new DataSource({
        type: 'postgres',
        url,
        entities: [Campaign, Device, CampaignSubjectImport, CampaignSubject],
        namingStrategy: new SnakeNamingStrategy(),
        synchronize: false,
      });
      await dataSource.initialize();
    });

    afterAll(async () => {
      // Cleanup net #1: everything we tracked by id.
      for (const campaignId of campaignIds) {
        await dataSource.query(
          `DELETE FROM campaign_subject_import_chunks WHERE campaign_id = $1`,
          [campaignId],
        );
        await dataSource.query(
          `DELETE FROM campaign_subjects WHERE campaign_id = $1`,
          [campaignId],
        );
        await dataSource.query(
          `DELETE FROM campaign_subject_imports WHERE campaign_id = $1`,
          [campaignId],
        );
        await dataSource.query(`DELETE FROM campaigns WHERE id = $1`, [
          campaignId,
        ]);
      }
      // Cleanup net #2: safety sweep by name prefix, in case a test failed
      // before it could record its own campaign id above.
      const stray: Array<{ id: string }> = await dataSource.query(
        `SELECT id FROM campaigns WHERE name LIKE 'ZZTEST-pull-audit-%'`,
      );
      for (const { id } of stray) {
        await dataSource.query(
          `DELETE FROM campaign_subject_import_chunks WHERE campaign_id = $1`,
          [id],
        );
        await dataSource.query(
          `DELETE FROM campaign_subjects WHERE campaign_id = $1`,
          [id],
        );
        await dataSource.query(
          `DELETE FROM campaign_subject_imports WHERE campaign_id = $1`,
          [id],
        );
        await dataSource.query(`DELETE FROM campaigns WHERE id = $1`, [id]);
      }
      await dataSource.destroy();
    });

    // NOTE on `dataSource.query()` return shapes (confirmed empirically here
    // too, matching `CampaignSubjectPullFetchWorker.claimNext`'s own doc
    // comment): a plain SELECT or an `INSERT ... RETURNING` returns a FLAT
    // array of rows. Only an `UPDATE ... RETURNING` returns a
    // `[rows, rowCount]` TUPLE — that distinction is real, not a typo (first
    // draft of this file got bitten by it on the INSERTs below).

    async function createFixtureCampaign(
      api: EligibilityApiConfig,
    ): Promise<string> {
      const rows: Array<{ id: string }> = await dataSource.query(
        `INSERT INTO campaigns (name, eligibility_config)
         VALUES ($1, $2::jsonb)
         RETURNING id`,
        [
          `ZZTEST-pull-audit-${randomUUID()}`,
          JSON.stringify({ mode: 'EXTERNAL_API', api }),
        ],
      );
      const campaignId = rows[0].id;
      campaignIds.push(campaignId);
      return campaignId;
    }

    async function insertPendingFetch(campaignId: string): Promise<string> {
      const rows: Array<{ id: string }> = await dataSource.query(
        `INSERT INTO campaign_subject_imports (campaign_id, source, file_name, status)
         VALUES ($1, 'EXTERNAL_API', $2, 'PENDING_FETCH')
         RETURNING id`,
        [campaignId, `external-api-${new Date().toISOString()}.json`],
      );
      return rows[0].id;
    }

    async function getImport(importId: string) {
      const rows: Array<Record<string, unknown>> = await dataSource.query(
        `SELECT * FROM campaign_subject_imports WHERE id = $1`,
        [importId],
      );
      return rows[0];
    }

    async function getSubjects(campaignId: string) {
      const rows: Array<Record<string, unknown>> = await dataSource.query(
        `SELECT subject_code, full_name, status, import_id
             FROM campaign_subjects
            WHERE campaign_id = $1
            ORDER BY subject_code`,
        [campaignId],
      );
      return rows;
    }

    describeRealApi(
      'initial pull — real Dai Nam API call, zero PII (empty-filtered)',
      () => {
        it('fetch worker makes one real HTTP call and closes the import out DONE with zero rows', async () => {
          const api: EligibilityApiConfig = {
            baseUrl: REAL_DAINAM_BASE_URL!,
            requestMethod: 'POST',
            requestPath: '/api/get_list_student_info',
            // course_year 1900 matches no real student — confirmed live to
            // return HTTP 200 {success:true, data:[]}. Proves real
            // reachability/auth/parsing without pulling any real student PII.
            requestBodyTemplate: {
              faculty_id: 0,
              traning_system_id: 0,
              course_year: 1900,
            },
            authType: 'API_KEY_HEADER',
            authParamName: 'x-api-key',
            credentialCiphertext: encryptSecret(REAL_DAINAM_API_KEY!),
            listResponsePath: 'data',
          };
          const campaignId = await createFixtureCampaign(api);
          const importId = await insertPendingFetch(campaignId);

          const worker = new CampaignSubjectPullFetchWorker(
            new AdvisoryLockService(dataSource),
            dataSource,
            // Real client — this is the one scenario that hits the network for real.
            new EligibilityHttpClient(),
          );
          await worker.tick();

          const imp = await getImport(importId);
          expect(imp.status).toBe('DONE');
          expect(Number(imp.total_rows)).toBe(0);
          const subjects = await getSubjects(campaignId);
          expect(subjects).toHaveLength(0);
        }, 20_000);
      },
    );

    describe('manual re-pull — controlled fake data, upsert + disappeared-student semantics', () => {
      it('2nd pull (force) updates a changed subject, adds a new one, and leaves the disappeared one stale rather than deleting/invalidating it', async () => {
        const api: EligibilityApiConfig = {
          baseUrl: 'https://example.invalid',
          requestMethod: 'POST',
          requestPath: '/list',
          authType: 'NONE',
        };
        const campaignId = await createFixtureCampaign(api);

        const pull1Records = [
          {
            student_code: 'ZZTEST-S1',
            full_name: 'Nguyen Van A',
            class_name: 'ZZ1',
          },
          {
            student_code: 'ZZTEST-S2',
            full_name: 'Tran Thi B (will disappear)',
            class_name: 'ZZ1',
          },
        ];
        const pull2Records = [
          {
            student_code: 'ZZTEST-S1',
            full_name: 'Nguyen Van A (updated name)',
            class_name: 'ZZ1',
          },
          {
            student_code: 'ZZTEST-S3',
            full_name: 'Le Van C (new)',
            class_name: 'ZZ1',
          },
          // S2 intentionally omitted — simulates "removed from source".
        ];

        const writeWorker = new CampaignSubjectPullWriteWorker(dataSource, {
          refresh: () => Promise.resolve(0),
        } as never);

        // --- Pull 1 ---
        const import1Id = await insertPendingFetch(campaignId);
        const fetch1 = new CampaignSubjectPullFetchWorker(
          new AdvisoryLockService(dataSource),
          dataSource,
          new FakeEligibilityHttpClient(() =>
            Promise.resolve(success({ raw: null, records: pull1Records })),
          ) as never,
        );
        await fetch1.tick();
        await writeWorker.drain();

        const imp1 = await getImport(import1Id);
        expect(imp1.status).toBe('DONE');
        expect(Number(imp1.valid_rows)).toBe(2);

        let subjects = await getSubjects(campaignId);
        expect(subjects.map((s) => s.subject_code)).toEqual([
          'ZZTEST-S1',
          'ZZTEST-S2',
        ]);

        // --- Pull 2 (manual re-pull, force:true — via the REAL service method) ---
        const subjectService = new CampaignSubjectService(
          undefined as never, // CampaignSubject repository — not touched by requestPull
          dataSource.getRepository(CampaignSubjectImport),
          undefined as never, // eligibilityLogRepository
          dataSource, // dataSource
          {
            findCampaignEntityOrFail: async (id: string) => {
              const rows: Array<Record<string, unknown>> =
                await dataSource.query(
                  `SELECT eligibility_config FROM campaigns WHERE id = $1`,
                  [id],
                );
              return { eligibilityConfig: rows[0].eligibility_config };
            },
          } as never, // campaignService
          undefined as never, // fileStorage
          undefined as never, // snapshotService
          undefined as never, // eligibilityHttpClient (unused by requestPull itself)
          new AdvisoryLockService(dataSource), // advisoryLock
        );

        const forcedDto: RequestSubjectPullDto = { force: true };
        const import2Dao = await subjectService.requestPull(
          campaignId,
          null,
          forcedDto,
        );
        expect(import2Dao.status).toBe('PENDING_FETCH');

        const fetch2 = new CampaignSubjectPullFetchWorker(
          new AdvisoryLockService(dataSource),
          dataSource,
          new FakeEligibilityHttpClient(() =>
            Promise.resolve(success({ raw: null, records: pull2Records })),
          ) as never,
        );
        await fetch2.tick();
        await writeWorker.drain();

        const imp2 = await getImport(import2Dao.id);
        expect(imp2.status).toBe('DONE');
        expect(Number(imp2.valid_rows)).toBe(2); // S1 (update) + S3 (new)
        // S2's absence is reflected as +1 error_rows on the NEW import
        // (`finalizeIfComplete`'s `missingCount`) — informational only,
        // see the assertions on S2's own row below for what this does NOT do.
        expect(Number(imp2.error_rows)).toBe(1);

        subjects = await getSubjects(campaignId);
        const bySubjectCode: Record<
          string,
          Record<string, unknown>
        > = Object.fromEntries(
          subjects.map((s) => [String(s.subject_code), s]),
        );

        expect(bySubjectCode['ZZTEST-S1'].full_name).toBe(
          'Nguyen Van A (updated name)',
        );
        expect(bySubjectCode['ZZTEST-S1'].import_id).toBe(import2Dao.id);

        expect(bySubjectCode['ZZTEST-S3']).toBeDefined();
        expect(bySubjectCode['ZZTEST-S3'].import_id).toBe(import2Dao.id);

        // The key finding: S2 (removed from the 2nd pull's source data) is
        // NEITHER deleted NOR flipped to a non-VALID status — it is left
        // completely untouched, still pointing at the FIRST (now stale)
        // import. Nothing in this codebase currently filters roster reads
        // (`lookupSubject`'s ROSTER branch, the CMS roster list) by "is
        // this subject's import_id the campaign's latest EXTERNAL_API
        // import" — so in practice a student removed from the source
        // stays fully "VALID"/eligible indefinitely after a re-pull.
        expect(bySubjectCode['ZZTEST-S2']).toBeDefined();
        expect(bySubjectCode['ZZTEST-S2'].status).toBe('VALID');
        expect(bySubjectCode['ZZTEST-S2'].import_id).toBe(import1Id);
      }, 20_000);

      it('requestPull without force rejects a 2nd call within 5 minutes of a running/queued pull', async () => {
        const api: EligibilityApiConfig = {
          baseUrl: 'https://example.invalid',
          requestMethod: 'POST',
          requestPath: '/list',
          authType: 'NONE',
        };
        const campaignId = await createFixtureCampaign(api);
        await insertPendingFetch(campaignId); // simulates the auto-enqueue on create

        const subjectService = new CampaignSubjectService(
          undefined as never,
          dataSource.getRepository(CampaignSubjectImport),
          undefined as never,
          dataSource,
          {
            findCampaignEntityOrFail: async (id: string) => {
              const rows: Array<Record<string, unknown>> =
                await dataSource.query(
                  `SELECT eligibility_config FROM campaigns WHERE id = $1`,
                  [id],
                );
              return { eligibilityConfig: rows[0].eligibility_config };
            },
          } as never,
          undefined as never,
          undefined as never,
          undefined as never,
          new AdvisoryLockService(dataSource),
        );

        // `CustomException`'s own `.message` is a generic Nest fallback
        // ("Custom Exception") — the real reason lives in `.payload.error`
        // (see `custom.exception.ts`), so assert on that directly instead of
        // `.rejects.toThrow(regex)`.
        let caught: { payload?: { error?: string } } | undefined;
        try {
          await subjectService.requestPull(campaignId, null, {});
        } catch (error) {
          caught = error as { payload?: { error?: string } };
        }
        expect(caught?.payload?.error).toEqual(
          expect.stringContaining('Đã có một lần kéo dữ liệu đang chạy'),
        );

        // This test deliberately never lets a worker claim/drain the
        // PENDING_FETCH row it inserted above (claiming it would defeat
        // the point of testing the "already running" guard) — clean it up
        // immediately rather than leaving it in the shared, GLOBAL (not
        // per-campaign) claim queue where a LATER test's fetch worker
        // could otherwise claim this orphaned row instead of its own
        // (confirmed the hard way while writing this spec).
        await dataSource.query(
          `DELETE FROM campaign_subject_imports WHERE campaign_id = $1`,
          [campaignId],
        );
      });
    });

    describe('error handling — external API call fails', () => {
      it('a Terminal outcome from fetchAll marks the import FAILED with failure_reason set', async () => {
        const api: EligibilityApiConfig = {
          baseUrl: 'https://example.invalid',
          requestMethod: 'POST',
          requestPath: '/list',
          authType: 'NONE',
        };
        const campaignId = await createFixtureCampaign(api);
        const importId = await insertPendingFetch(campaignId);

        const worker = new CampaignSubjectPullFetchWorker(
          new AdvisoryLockService(dataSource),
          dataSource,
          new FakeEligibilityHttpClient(() =>
            Promise.resolve(terminal('API trả về HTTP 500: simulated failure')),
          ) as never,
        );
        await worker.tick();

        const imp = await getImport(importId);
        expect(imp.status).toBe('FAILED');
        expect(imp.failure_reason).toMatch(/simulated failure/);
      });
    });

    describe('stuck job recovery', () => {
      it('resets a FETCHING import stuck past 30 minutes back to PENDING_FETCH, and a stale PROCESSING chunk back to PENDING', async () => {
        const api: EligibilityApiConfig = {
          baseUrl: 'https://example.invalid',
          requestMethod: 'POST',
          requestPath: '/list',
          authType: 'NONE',
        };
        const campaignId = await createFixtureCampaign(api);

        const importRow: Array<{ id: string }> = await dataSource.query(
          `INSERT INTO campaign_subject_imports (campaign_id, source, file_name, status, updated_at)
             VALUES ($1, 'EXTERNAL_API', 'stuck.json', 'FETCHING', now() - interval '40 minutes')
             RETURNING id`,
          [campaignId],
        );
        const importId = importRow[0].id;

        const chunkRow: Array<{ id: string }> = await dataSource.query(
          `INSERT INTO campaign_subject_import_chunks
               (import_id, campaign_id, chunk_no, row_count, payload, status, next_retry_at)
             VALUES ($1, $2, 1, 0, '[]'::jsonb, 'PROCESSING', now() - interval '1 minute')
             RETURNING id`,
          [importId, campaignId],
        );
        const chunkId = chunkRow[0].id;

        const recovery = new CampaignSubjectPullStuckJobRecoveryWorker(
          new AdvisoryLockService(dataSource),
          dataSource,
        );
        await recovery.tick();

        const imp = await getImport(importId);
        expect(imp.status).toBe('PENDING_FETCH');

        const chunk: Array<{ status: string }> = await dataSource.query(
          `SELECT status FROM campaign_subject_import_chunks WHERE id = $1`,
          [chunkId],
        );
        expect(chunk[0].status).toBe('PENDING');

        // This campaign's stray chunk row isn't covered by the campaignIds
        // cleanup loop above (chunks are deleted by campaign_id there too,
        // so it IS covered) — no extra cleanup needed.
      });
    });
  },
);
