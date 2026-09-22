import { AdvisoryLockService } from '@app/shared/database/advisory-lock.service';
import { EligibilityHttpClient } from '@app/modules/workflow/infrastructure/integrations/eligibility-http.client';
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

const CHUNK_SIZE = 500;
const MAX_SUBJECT_CODE_LEN = 100;
const MAX_FULL_NAME_LEN = 255;
const MAX_CITIZEN_ID_LEN = 20;

/**
 * Field names in the real, verified Dai Nam student-info API response
 * (plan §3.1 — confirmed live: an unfiltered call returns HTTP 200 with
 * 23,992 records). `EligibilityHttpClient` stays fully config-driven (any
 * base URL/path/auth), but mapping the fetched records' own field names
 * into `campaign_subjects`' fixed columns has to name real keys somewhere;
 * this is that one place.
 */
const API_FIELD_MAP = {
  subjectCode: 'student_code',
  fullName: 'full_name',
  citizenId: 'identity_number',
  className: 'class_name',
  faculty: 'faculty_name',
  major: 'major_name',
  dateOfBirth: 'date_of_birth',
} as const;

/** One row of a chunk's `payload` jsonb — already parsed/validated, so `CampaignSubjectPullWriteWorker` only ever does mechanical INSERT/UPSERT, never re-interprets a raw API record. */
export interface ChunkPayloadRow {
  rowNo: number;
  subjectCode: string;
  fullName: string;
  citizenId: string | null;
  className: string | null;
  faculty: string | null;
  major: string | null;
  dateOfBirth: string | null;
  extra: Record<string, unknown>;
  status: 'VALID' | 'ERROR' | 'DUPLICATE';
  errorMessage: string | null;
}

interface PendingImportRow {
  id: string;
  campaign_id: string;
}

interface CampaignEligibilityApiRow {
  eligibility_config: {
    api?: {
      baseUrl: string;
      requestMethod: 'GET' | 'POST';
      requestPath: string;
      requestBodyTemplate?: Record<string, unknown>;
      authType: 'NONE' | 'API_KEY_HEADER' | 'BEARER_TOKEN' | 'QUERY_PARAM';
      authParamName?: string;
      credentialCiphertext?: string;
      listResponsePath?: string;
      retryCount?: number;
      timeoutMs?: number;
      listTimeoutMs?: number;
    };
  } | null;
}

/**
 * Tầng 1 of the 2-tier pull queue (plan §3.1) — claims ONE
 * `campaign_subject_imports` row at `PENDING_FETCH`, makes exactly ONE HTTP
 * call via `EligibilityHttpClient.fetchAll()`, dedupes/pre-validates in JS,
 * and lands the result as durable `campaign_subject_import_chunks` rows
 * (500 records each) — after this method returns, the entire ~20MB
 * response is safely in Postgres and released from this process's memory;
 * a crash from here on loses nothing (see
 * `CampaignSubjectPullStuckJobRecoveryWorker` for the "this process itself
 * crashed mid-fetch" recovery path). `CampaignSubjectPullWriteWorker`
 * (Tầng 2) does the actual `campaign_subjects` writes, chunk by chunk, so a
 * slow/failing write never blocks fetching the NEXT campaign's pull.
 *
 * Deliberately only ONE attempt per claim — `EligibilityHttpClient.
 * fetchAll()`'s own `retryCount` already retries transient network
 * failures inside that one call; a `Retryable` outcome that still fails
 * after those retries is reported as a normal `FAILED` import (a human
 * re-triggers via `force: true`), not retried again at this tier — that
 * reliability budget belongs to Tầng 2's per-chunk retry instead, once data
 * is durably staged.
 */
@Injectable()
export class CampaignSubjectPullFetchWorker {
  private readonly logger = new Logger(CampaignSubjectPullFetchWorker.name);
  private running = false;

  constructor(
    private readonly lock: AdvisoryLockService,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly eligibilityHttpClient: EligibilityHttpClient,
  ) {}

  @Cron('*/5 * * * * *')
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.lock.withLock('campaign_subject_pull_fetch', () =>
        this.runOnce(),
      );
    } catch (error) {
      this.logger.error(`fetch tick failed: ${(error as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  private async runOnce(): Promise<void> {
    const claimed = await this.claimNext();
    if (!claimed) return;
    await this.processImport(claimed.id, claimed.campaign_id);
  }

  /**
   * `SKIP LOCKED` claim — same shape `UploadWorkerService.claimNext`/
   * `VariantUploadWorkerService.claimNext` already use, including the
   * `[rows]: [T[], number]` destructure: a bare (non-transactional)
   * `DataSource.query()` for an `UPDATE ... RETURNING` returns a
   * `[rows, rowCount]` TUPLE, not a flat array — confirmed empirically
   * against the real dev DB (unlike `INSERT ... RETURNING`, which does
   * return a flat array; the two statement kinds behave differently here).
   * `updated_at = now()` is set explicitly since a raw-SQL `UPDATE` bypasses
   * TypeORM's `@UpdateDateColumn`; the stuck-job sweep reads it back to
   * detect a claim that never finished.
   */
  private async claimNext(): Promise<PendingImportRow | null> {
    const [rows]: [PendingImportRow[], number] = await this.dataSource.query(
      `UPDATE campaign_subject_imports
          SET status = 'FETCHING', updated_at = now()
        WHERE id = (
          SELECT id FROM campaign_subject_imports
           WHERE status = 'PENDING_FETCH'
           ORDER BY id
           FOR UPDATE SKIP LOCKED
           LIMIT 1
        )
        RETURNING id, campaign_id`,
    );
    return rows[0] ?? null;
  }

  private async processImport(
    importId: string,
    campaignId: string,
  ): Promise<void> {
    try {
      const [campaignRow]: CampaignEligibilityApiRow[] =
        await this.dataSource.query(
          `SELECT eligibility_config FROM campaigns WHERE id = $1`,
          [campaignId],
        );
      const api = campaignRow?.eligibility_config?.api;
      if (!api) {
        await this.fail(
          importId,
          'Campaign không còn cấu hình API điều kiện tiếp nhận',
        );
        return;
      }

      const outcome = await this.eligibilityHttpClient.fetchAll({
        baseUrl: api.baseUrl,
        requestMethod: api.requestMethod,
        requestPath: api.requestPath,
        requestBodyTemplate: api.requestBodyTemplate,
        authType: api.authType,
        authParamName: api.authParamName,
        credentialCiphertext: api.credentialCiphertext,
        listResponsePath: api.listResponsePath,
        retryCount: api.retryCount,
        timeoutMs: api.timeoutMs,
        listTimeoutMs: api.listTimeoutMs,
      });
      if (outcome.kind !== 'Success') {
        await this.fail(importId, outcome.reason);
        return;
      }

      // `records` (potentially ~24k/~20MB) is only ever referenced inside
      // this one method call — nothing holds onto it past `parseAndValidate`
      // returning, and the per-chunk `rows.slice()` loop below releases each
      // batch's own reference as soon as it's been written to a chunk row.
      const records = outcome.value.records;
      const { rows, discoveredFields } = this.parseAndValidate(records);

      // ERROR/DUPLICATE `campaign_subjects` rows from a PRIOR pull of this
      // campaign are pruned right before this pull writes its own — unlike
      // VALID rows (upserted by `campaign_id, subject_code`), those never
      // had a conflict target, so without this every re-pull would keep
      // appending the same stale error/duplicate rows on top of the old
      // ones forever. Only run once we actually have a fresh result to
      // replace them with (never on a failed fetch, handled above).
      await this.dataSource.query(
        `DELETE FROM campaign_subjects cs
           USING campaign_subject_imports ci
          WHERE cs.import_id = ci.id
            AND cs.campaign_id = $1
            AND ci.source = 'EXTERNAL_API'
            AND ci.id <> $2
            AND cs.status IN ('ERROR', 'DUPLICATE')`,
        [campaignId, importId],
      );

      let chunkNo = 0;
      for (let start = 0; start < rows.length; start += CHUNK_SIZE) {
        const batch = rows.slice(start, start + CHUNK_SIZE);
        chunkNo++;
        // `ON CONFLICT ... DO NOTHING` — enqueue-idempotent (plan's own
        // note): if this worker crashed after inserting some chunks and a
        // later re-claim re-fetches + re-chunks, a chunk_no already written
        // is left exactly as it was, never duplicated.
        await this.dataSource.query(
          `INSERT INTO campaign_subject_import_chunks
             (import_id, campaign_id, chunk_no, row_count, payload)
           VALUES ($1, $2, $3, $4, $5::jsonb)
           ON CONFLICT (import_id, chunk_no) DO NOTHING`,
          [importId, campaignId, chunkNo, batch.length, JSON.stringify(batch)],
        );
      }

      // `AND status = 'FETCHING'` — this import must still be the one WE
      // claimed; if the stuck-job recovery sweep reset it back to
      // `PENDING_FETCH` from under us (e.g. this same process stalled long
      // enough to look abandoned) this flip must not resurrect it, since a
      // fresh claim/fetch cycle for the same import id is already/about to
      // be underway elsewhere. Tầng 2's `claimNext`/`finalizeIfComplete`
      // both require `status = 'IMPORTING'` before touching a chunk, so
      // chunks committed above are never processed until this flip lands.
      await this.dataSource.query(
        `UPDATE campaign_subject_imports
            SET status = 'IMPORTING', total_rows = $2, source_detail = $3::jsonb, updated_at = now()
          WHERE id = $1 AND status = 'FETCHING'`,
        [importId, records.length, JSON.stringify({ discoveredFields })],
      );

      if (rows.length === 0) {
        // Nothing parsed at all (e.g. the API returned an empty list) — no
        // chunk was ever created, so Tầng 2 will never see this import to
        // finalize it. Close it out here instead, same "still close out
        // even with zero rows" precedent `importRoster`'s own empty-file
        // branch follows.
        await this.dataSource.query(
          `UPDATE campaign_subject_imports
              SET status = 'DONE', finished_at = now()
            WHERE id = $1 AND status = 'IMPORTING'`,
          [importId],
        );
      }
    } catch (error) {
      await this.fail(importId, (error as Error).message);
    }
  }

  /**
   * Every record becomes exactly one `ChunkPayloadRow` — never dropped
   * (plan's own "không bao giờ vứt dòng"). Dedup order matters: the FIRST
   * occurrence of a `subjectCode` in this pull's own record order wins as
   * `VALID`; any LATER occurrence of the same code is `DUPLICATE`, not
   * silently merged or overwritten — this also happens to be what prevents
   * `CampaignSubjectPullWriteWorker`'s multi-row `ON CONFLICT DO UPDATE`
   * from ever seeing the same conflict target twice within one statement
   * (the exact error class `campaign-member.service.ts`'s own grant-dedup
   * fix already hit).
   */
  private parseAndValidate(records: Array<Record<string, unknown>>): {
    rows: ChunkPayloadRow[];
    discoveredFields: string[];
  } {
    const discovered = new Set<string>();
    const seenValid = new Set<string>();
    const rows: ChunkPayloadRow[] = [];
    let rowNo = 0;

    for (const record of records) {
      rowNo++;
      if (discovered.size < 200) {
        for (const key of Object.keys(record)) discovered.add(key);
      }

      const subjectCode =
        this.pickString(record, API_FIELD_MAP.subjectCode) ?? '';
      const fullName = this.pickString(record, API_FIELD_MAP.fullName) ?? '';
      const citizenId = this.pickString(record, API_FIELD_MAP.citizenId);

      let status: ChunkPayloadRow['status'] = 'VALID';
      let errorMessage: string | null = null;
      if (!subjectCode) {
        status = 'ERROR';
        errorMessage = 'Thiếu mã SV';
      } else if (subjectCode.length > MAX_SUBJECT_CODE_LEN) {
        status = 'ERROR';
        errorMessage = `Mã SV quá dài (>${MAX_SUBJECT_CODE_LEN} ký tự)`;
      } else if (fullName.length > MAX_FULL_NAME_LEN) {
        status = 'ERROR';
        errorMessage = `Họ tên quá dài (>${MAX_FULL_NAME_LEN} ký tự)`;
      } else if (citizenId && citizenId.length > MAX_CITIZEN_ID_LEN) {
        status = 'ERROR';
        errorMessage = `CCCD quá dài (>${MAX_CITIZEN_ID_LEN} ký tự)`;
      } else if (seenValid.has(subjectCode)) {
        status = 'DUPLICATE';
        errorMessage = `Mã SV "${subjectCode}" trùng trong lần kéo này`;
      } else {
        seenValid.add(subjectCode);
      }

      rows.push({
        rowNo,
        subjectCode,
        fullName,
        citizenId,
        className: this.pickString(record, API_FIELD_MAP.className),
        faculty: this.pickString(record, API_FIELD_MAP.faculty),
        major: this.pickString(record, API_FIELD_MAP.major),
        dateOfBirth: this.parseDate(record[API_FIELD_MAP.dateOfBirth]),
        extra: record,
        status,
        errorMessage,
      });
    }
    return { rows, discoveredFields: Array.from(discovered) };
  }

  private async fail(importId: string, reason: string): Promise<void> {
    this.logger.warn(`pull fetch failed for import ${importId}: ${reason}`);
    await this.dataSource.query(
      `UPDATE campaign_subject_imports
          SET status = 'FAILED', failure_reason = $2, finished_at = now()
        WHERE id = $1`,
      [importId, reason.slice(0, 2000)],
    );
  }

  /** Only ever stringifies a primitive — an object/array value (unexpected shape for these fields) is treated as absent rather than turned into `"[object Object]"`. */
  private pickString(
    record: Record<string, unknown>,
    key: string,
  ): string | null {
    const value = record[key];
    if (typeof value === 'string') return value.trim() || null;
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }
    return null;
  }

  /**
   * Same dd/mm/yyyy-before-native-parsing reasoning
   * `CampaignSubjectService.cellToDate` documents for Excel dates
   * (2026-09-18 fix) — kept as its own small copy rather than shared, since
   * that one takes `ExcelJS.CellValue`, not a plain JSON value from an HTTP
   * response.
   */
  private parseDate(value: unknown): string | null {
    let text: string;
    if (typeof value === 'string') text = value.trim();
    else if (typeof value === 'number') text = String(value);
    else return null;
    if (!text) return null;

    const isoMatch = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
    if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;

    const viMatch = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(text);
    if (viMatch) {
      const day = Number(viMatch[1]);
      const month = Number(viMatch[2]);
      const year = Number(viMatch[3]);
      if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
        const parsed = new Date(Date.UTC(year, month - 1, day));
        if (!Number.isNaN(parsed.getTime())) {
          return parsed.toISOString().slice(0, 10);
        }
      }
    }

    const parsed = new Date(text);
    return Number.isNaN(parsed.getTime())
      ? null
      : parsed.toISOString().slice(0, 10);
  }
}
