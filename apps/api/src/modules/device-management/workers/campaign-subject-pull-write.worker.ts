import { CampaignSnapshotService } from '@app/modules/stats/services/campaign-snapshot.service';
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import type { ChunkPayloadRow } from './campaign-subject-pull-fetch.worker';

const MAX_CHUNK_ATTEMPTS = 5;
/** Fixed 10-minute claim window a stale `PROCESSING` chunk sits in before `CampaignSubjectPullStuckJobRecoveryWorker` resets it — see `claimNext`'s own doc comment for why `next_retry_at` doubles as the "claimed at" marker. */
const CLAIM_STALE_MINUTES = 10;

interface ClaimedChunk {
  id: string;
  import_id: string;
  campaign_id: string;
  payload: ChunkPayloadRow[];
  attempts: number;
}

/**
 * Tầng 2 of the 2-tier pull queue (plan §3.1) — drains
 * `campaign_subject_import_chunks`, one chunk (≤500 rows) per transaction,
 * `FOR UPDATE SKIP LOCKED` so any number of replicas can run this
 * concurrently (same claim shape `UploadWorkerService`/
 * `VariantUploadWorkerService` already use). Each chunk's rows were already
 * parsed/validated by `CampaignSubjectPullFetchWorker` (Tầng 1) — this
 * class does purely mechanical SQL, no field-mapping/date-parsing logic.
 */
@Injectable()
export class CampaignSubjectPullWriteWorker {
  private readonly logger = new Logger(CampaignSubjectPullWriteWorker.name);
  private running = false;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly snapshotService: CampaignSnapshotService,
  ) {}

  @Cron('*/2 * * * * *')
  async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      for (;;) {
        const chunk = await this.claimNext();
        if (!chunk) break;
        await this.processChunk(chunk);
      }
    } catch (error) {
      this.logger.error(`write tick failed: ${(error as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  /**
   * `next_retry_at = now() + CLAIM_STALE_MINUTES` at claim time — the
   * `campaign_subject_import_chunks` table has no `updated_at` column (see
   * the migration's own doc comment), so this reuses `next_retry_at` as the
   * "claimed at, expect a status change before this" marker instead of
   * adding one. If this worker crashes mid-chunk, `next_retry_at` stays in
   * the future and `status = 'PROCESSING'` — exactly what
   * `CampaignSubjectPullStuckJobRecoveryWorker`'s sweep looks for.
   */
  /** `[rows]: [T[], number]` destructure — see `CampaignSubjectPullFetchWorker.claimNext`'s own doc comment for why a bare `DataSource.query()` for `UPDATE ... RETURNING` returns a tuple, confirmed empirically. */
  private async claimNext(): Promise<ClaimedChunk | null> {
    const [rows]: [ClaimedChunk[], number] = await this.dataSource.query(
      `UPDATE campaign_subject_import_chunks
          SET status = 'PROCESSING',
              attempts = attempts + 1,
              next_retry_at = now() + interval '${CLAIM_STALE_MINUTES} minutes'
        WHERE id = (
          SELECT id FROM campaign_subject_import_chunks
           WHERE status = 'PENDING' AND next_retry_at <= now()
           ORDER BY id
           FOR UPDATE SKIP LOCKED
           LIMIT 1
        )
        RETURNING id, import_id, campaign_id, payload, attempts`,
    );
    return rows[0] ?? null;
  }

  private async processChunk(chunk: ClaimedChunk): Promise<void> {
    const validRows = chunk.payload.filter((r) => r.status === 'VALID');
    const otherRows = chunk.payload.filter((r) => r.status !== 'VALID');

    try {
      await this.dataSource.transaction(async (manager) => {
        if (validRows.length > 0) {
          await this.upsertValidRows(
            manager,
            chunk.import_id,
            chunk.campaign_id,
            validRows,
          );
        }
        if (otherRows.length > 0) {
          await this.insertOtherRows(
            manager,
            chunk.import_id,
            chunk.campaign_id,
            otherRows,
          );
        }

        await manager.query(
          `UPDATE campaign_subject_imports
              SET valid_rows = valid_rows + $2, error_rows = error_rows + $3, updated_at = now()
            WHERE id = $1`,
          [chunk.import_id, validRows.length, otherRows.length],
        );
        await manager.query(
          `UPDATE campaign_subject_import_chunks SET status = 'DONE' WHERE id = $1`,
          [chunk.id],
        );

        await this.finalizeIfComplete(
          manager,
          chunk.import_id,
          chunk.campaign_id,
        );
      });
    } catch (error) {
      await this.recordFailure(chunk, error);
    }
  }

  /**
   * `ON CONFLICT (campaign_id, subject_code) WHERE status = 'VALID'` — the
   * exact partial-unique-index inference clause
   * `1815000000000-CampaignExtendedFields.ts` created for Excel imports,
   * reused here so an API pull upserts by the SAME natural key whether the
   * existing row came from an Excel upload or an earlier pull.
   * `import_id = EXCLUDED.import_id` re-points an existing row at this
   * import — exactly the plan's "Cập nhật lại" semantics table entry
   * "Dòng đã có... import_id trỏ sang lần kéo mới." `printed_at`/
   * `printed_batch_id` are never mentioned in the UPDATE SET — a pull must
   * never clear or guess a real print confirmation (feature 6).
   */
  private async upsertValidRows(
    manager: EntityManager,
    importId: string,
    campaignId: string,
    rows: ChunkPayloadRow[],
  ): Promise<void> {
    const values: unknown[] = [];
    const placeholders: string[] = [];
    let i = 1;
    for (const r of rows) {
      placeholders.push(
        `($${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++}, 'VALID', $${i++})`,
      );
      values.push(
        campaignId,
        importId,
        r.rowNo,
        r.subjectCode,
        r.fullName,
        r.citizenId,
        r.className,
        r.faculty,
        r.major,
        r.dateOfBirth,
        JSON.stringify(r.extra),
      );
    }
    await manager.query(
      `INSERT INTO campaign_subjects
         (campaign_id, import_id, row_no, subject_code, full_name, citizen_id, class_name, faculty, major, date_of_birth, status, extra)
       VALUES ${placeholders.join(', ')}
       ON CONFLICT (campaign_id, subject_code) WHERE status = 'VALID'
       DO UPDATE SET
         import_id = EXCLUDED.import_id,
         full_name = EXCLUDED.full_name,
         citizen_id = EXCLUDED.citizen_id,
         class_name = EXCLUDED.class_name,
         faculty = EXCLUDED.faculty,
         major = EXCLUDED.major,
         date_of_birth = EXCLUDED.date_of_birth,
         extra = EXCLUDED.extra,
         updated_at = now()`,
      values,
    );
  }

  /** `ERROR`/`DUPLICATE` rows — plain `INSERT`, no conflict target needed: the partial unique index only covers `status = 'VALID'` rows, so these never collide with anything. */
  private async insertOtherRows(
    manager: EntityManager,
    importId: string,
    campaignId: string,
    rows: ChunkPayloadRow[],
  ): Promise<void> {
    const values: unknown[] = [];
    const placeholders: string[] = [];
    let i = 1;
    for (const r of rows) {
      placeholders.push(
        `($${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++})`,
      );
      values.push(
        campaignId,
        importId,
        r.rowNo,
        r.subjectCode,
        r.fullName,
        r.citizenId,
        r.className,
        r.faculty,
        r.major,
        r.dateOfBirth,
        r.status,
        r.errorMessage,
      );
    }
    await manager.query(
      `INSERT INTO campaign_subjects
         (campaign_id, import_id, row_no, subject_code, full_name, citizen_id, class_name, faculty, major, date_of_birth, status, error_message)
       VALUES ${placeholders.join(', ')}`,
      values,
    );
  }

  /**
   * Runs in the SAME transaction as the chunk that just finished (plan's
   * own "nên không có tranh chấp" — no separate worker can see a
   * half-finalized state). `PENDING`/`PROCESSING` chunks count as "still
   * remaining"; `DONE` AND `FAILED` both count as "no longer remaining" —
   * a chunk that exhausted `MAX_CHUNK_ATTEMPTS` must not block the import
   * from ever finalizing (plan's own "không bao giờ treo mãi").
   *
   * `missingCount` — subjects a PRIOR pull wrote that THIS pull's upserts
   * never touched (still attributed to an older `EXTERNAL_API` import) —
   * feeds `error_rows` as the plan's own semantics table specifies
   * ("import_id khác lần kéo mới nhất chính là dấu hiệu 'không còn trong
   * API' — có sẵn, không cần cột mới"); the rows themselves are left
   * completely untouched (feature 6's "đánh dấu, không xoá").
   */
  private async finalizeIfComplete(
    manager: EntityManager,
    importId: string,
    campaignId: string,
  ): Promise<void> {
    const [{ remaining }]: Array<{ remaining: number }> = await manager.query(
      `SELECT COUNT(*)::int AS remaining
           FROM campaign_subject_import_chunks
          WHERE import_id = $1 AND status IN ('PENDING', 'PROCESSING')`,
      [importId],
    );
    if (remaining > 0) return;

    const [{ missingCount }]: Array<{ missingCount: number }> =
      await manager.query(
        `SELECT COUNT(*)::int AS "missingCount"
           FROM campaign_subjects cs
           JOIN campaign_subject_imports ci ON ci.id = cs.import_id
          WHERE cs.campaign_id = $1
            AND ci.source = 'EXTERNAL_API'
            AND cs.status = 'VALID'
            AND cs.import_id <> $2`,
        [campaignId, importId],
      );

    await manager.query(
      `UPDATE campaign_subject_imports
          SET status = 'DONE', finished_at = now(), error_rows = error_rows + $2
        WHERE id = $1`,
      [importId, missingCount],
    );
    // Payload has done its job — dropping it keeps this table from growing
    // unbounded across repeated pulls (plan's own "phình bảng" concern).
    await manager.query(
      `DELETE FROM campaign_subject_import_chunks WHERE import_id = $1`,
      [importId],
    );

    // Best-effort, outside nothing (still inside this transaction is fine —
    // it only reads/writes `stats_campaign_snapshot`, a different table,
    // same "small extra write riding the same transaction" shape
    // `importRoster`'s own snapshot refresh call is NOT inside a
    // transaction for — kept fire-and-forget here too, deliberately NOT
    // awaited inside the transaction, so a slow snapshot refresh can never
    // hold this transaction's locks open.
    void this.snapshotService
      .refresh([campaignId])
      .catch((err) =>
        this.logger.warn(
          `snapshot refresh after pull failed: ${(err as Error).message}`,
        ),
      );

    // Known gap, deliberately deferred: unlike `importRoster`, this path
    // does not upload a raw-response file or a formatted xlsx error report
    // to file-service — both are "best-effort follow-up" per the plan, and
    // the chunk payload (this method's only copy of the raw records) is
    // dropped right above. `error`/`DUPLICATE` rows are NOT lost — they are
    // real `campaign_subjects` rows with their own `errorMessage`, visible
    // via `GET /v1/campaigns/:id/subjects?status=ERROR`; only the polished
    // downloadable xlsx report a human would otherwise click is missing.
  }

  private async recordFailure(
    chunk: ClaimedChunk,
    error: unknown,
  ): Promise<void> {
    const message = ((error as Error)?.message ?? String(error)).slice(0, 2000);
    if (chunk.attempts >= MAX_CHUNK_ATTEMPTS) {
      this.logger.error(
        `chunk ${chunk.id} permanently failed after ${chunk.attempts} attempts: ${message}`,
      );
      await this.dataSource.transaction(async (manager) => {
        await manager.query(
          `UPDATE campaign_subject_import_chunks SET status = 'FAILED', last_error = $2 WHERE id = $1`,
          [chunk.id, message],
        );
        await this.finalizeIfComplete(
          manager,
          chunk.import_id,
          chunk.campaign_id,
        );
      });
      return;
    }

    // Exponential backoff, capped — same shape
    // `variant-upload-worker.service.ts`'s own `computeVariantNextRetryAt`
    // uses, inlined here rather than imported (that one lives in
    // `photo-review`, a module this one must not depend on).
    const delaySeconds = Math.min(300, 2 ** chunk.attempts);
    await this.dataSource.query(
      `UPDATE campaign_subject_import_chunks
          SET status = 'PENDING', last_error = $2, next_retry_at = now() + ($3 || ' seconds')::interval
        WHERE id = $1`,
      [chunk.id, message, String(delaySeconds)],
    );
  }
}
