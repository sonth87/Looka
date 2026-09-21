import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

interface RosterGroupField {
  field: string;
  label: string;
  source: 'column' | 'extra';
}

interface RosterGroupStat {
  value: string | null;
  secondaryValue: string | null;
  rosterTotal: number;
  captured: number;
  approved: number;
  notCaptured: number;
  printed: number;
  rejected: number;
}

/** Real `campaign_subjects` columns `groupBy` can name directly — same allowlist role `CampaignSubjectService.DISTINCT_VALUE_COLUMNS`/`GROUP_FIELDS` play in device-management, mirrored here since this module may not import that one (see this file's own module-boundary note below). */
const REAL_COLUMNS: Array<{ field: string; column: string; label: string }> = [
  { field: 'className', column: 'class_name', label: 'Lớp' },
  { field: 'faculty', column: 'faculty', label: 'Khoa' },
  { field: 'major', column: 'major', label: 'Ngành' },
];

/** Vietnamese labels for known Dai Nam student-API field names (plan §3.3 — "map nhỏ cho 33 khoá API đã biết"). A key not listed here falls back to showing the raw key itself, never blocks grouping. */
const EXTRA_FIELD_LABELS: Record<string, string> = {
  student_code: 'Mã SV',
  full_name: 'Họ tên',
  identity_number: 'CCCD',
  class_name: 'Lớp (API)',
  faculty_name: 'Khoa',
  major_name: 'Ngành',
  date_of_birth: 'Ngày sinh',
  course_year: 'Khóa',
  education_system_name: 'Hệ đào tạo',
  province_name: 'Tỉnh/TP',
  status: 'Trạng thái',
};

const DISCOVERY_SAMPLE_LIMIT = 2000;
const DISCOVERY_CACHE_TTL_MS = 60_000;
const MAX_GROUP_COMBINATIONS = 5000;

/**
 * `GET /v1/campaigns/:id/stats/roster-group-fields` /
 * `GET /v1/campaigns/:id/stats/roster-groups` (plan §3.3, feature 7) — lives
 * in `StatsModule`, not `device-management`, for the exact circular-
 * dependency reason `CampaignStatsExtraController`'s own doc comment gives:
 * `device-management` already imports `StatsModule` (for
 * `CampaignSnapshotService`), so this module must read `campaign_subjects`/
 * `subject_photo_sets`/`print_items` by raw SQL against table names rather
 * than importing any entity from those two modules — same convention this
 * module's own top doc comment documents for every other cross-boundary
 * read here.
 *
 * Deliberately queries `campaign_subjects`/`subject_photo_sets`/
 * `print_items` LIVE, not a `stats_*` table — unlike the rest of this
 * module (see `StatsQueryService`'s own doc comment), a truly dynamic
 * "group by any field, including one discovered from a jsonb blob at
 * request time" cannot be precomputed the way a fixed set of `stats_*`
 * columns can. At most ~24k rows per campaign, a `GROUP BY` on an indexed
 * column runs in tens of ms — see the migration's own doc comment for the
 * two partial indexes this relies on.
 */
@Injectable()
export class RosterGroupStatsService {
  private readonly discoveryCache = new Map<
    string,
    { fields: string[]; expiresAt: number }
  >();

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async groupFields(campaignId: string): Promise<RosterGroupField[]> {
    const result: RosterGroupField[] = REAL_COLUMNS.map((c) => ({
      field: c.field,
      label: c.label,
      source: 'column',
    }));
    const discovered = await this.discoverExtraFields(campaignId);
    for (const key of discovered) {
      result.push({
        field: key,
        label: EXTRA_FIELD_LABELS[key] ?? key,
        source: 'extra',
      });
    }
    return result;
  }

  /**
   * `secondaryGroupBy` gives 2-tier grouping (plan's own example: lớp ×
   * khoa) — rejected with 400 if the two fields' distinct-value counts
   * multiply past `MAX_GROUP_COMBINATIONS`, checked with a cheap
   * `COUNT(DISTINCT ...)` BEFORE running the real query, so a caller can
   * never trigger a multi-thousand-row response by accident.
   *
   * `sets`/`items` are pre-aggregated to exactly one row per `subject_code`
   * in their own CTEs before the `LEFT JOIN` — `subject_photo_sets` is only
   * unique per `(campaignId, subjectCode, kindId)` and `print_items` can
   * have more than one row per subject (reprints), so joining either
   * straight onto the roster would fan every count out. See the CTE
   * comments below for exactly what each pre-aggregation collapses.
   *
   * `printed` reads `campaign_subjects.printed_at` (feature 6's own
   * canonical "đã in" marker) rather than `print_items.status = 'PRINTED'`
   * — simpler, avoids a second join for that one column, and stays correct
   * even across reprints. `rejected` still needs `print_items` (roster has
   * no equivalent signal) — adapted to the CURRENT schema as "at least one
   * print item for this subject recorded an error", since the plan's own
   * `print_result = 'REJECTED'` column belongs to Giai đoạn 4's print
   * status rework, not yet built as of this pass.
   */
  async groupStats(
    campaignId: string,
    groupBy: string,
    secondaryGroupBy?: string,
  ): Promise<RosterGroupStat[]> {
    const params: unknown[] = [campaignId];
    const groupExpr = await this.resolveFieldExpr(campaignId, groupBy, params);
    const group2Expr = secondaryGroupBy
      ? await this.resolveFieldExpr(campaignId, secondaryGroupBy, params)
      : 'NULL';

    if (secondaryGroupBy) {
      const [combo]: Array<{ distinct1: number; distinct2: number }> =
        await this.dataSource.query(
          `SELECT COUNT(DISTINCT ${groupExpr})::int AS distinct1,
                  COUNT(DISTINCT ${group2Expr})::int AS distinct2
             FROM campaign_subjects cs
            WHERE cs.campaign_id = $1 AND cs.status = 'VALID'`,
          params,
        );
      const combinations = (combo?.distinct1 ?? 0) * (combo?.distinct2 ?? 0);
      if (combinations > MAX_GROUP_COMBINATIONS) {
        throw new BadRequestException(
          `Tổ hợp nhóm quá lớn (${combinations} > ${MAX_GROUP_COMBINATIONS}) — chọn trường khác hoặc bỏ nhóm phụ.`,
        );
      }
    }

    const rows: Array<{
      value: string | null;
      secondary_value: string | null;
      roster_total: number;
      captured: number;
      approved: number;
      not_captured: number;
      printed: number;
      rejected: number;
    }> = await this.dataSource.query(
      `WITH roster AS (
         SELECT cs.subject_code, cs.printed_at, ${groupExpr} AS g, ${group2Expr} AS g2
           FROM campaign_subjects cs
          WHERE cs.campaign_id = $1 AND cs.status = 'VALID'
       ),
       sets AS (  -- 1 row / subject_code: collapses subject_photo_sets' (campaignId, subjectCode, kindId) uniqueness before it ever reaches the join
         SELECT subject_code, bool_or(status = 'APPROVED') AS approved
           FROM subject_photo_sets
          WHERE campaign_id = $1
          GROUP BY subject_code
       ),
       items AS (  -- 1 row / subject_code: collapses print_items' possible multiple rows per subject (reprints) before it ever reaches the join
         SELECT subject_code, bool_or(error_message IS NOT NULL) AS rejected
           FROM print_items
          WHERE campaign_id = $1
          GROUP BY subject_code
       )
       SELECT r.g AS value, r.g2 AS secondary_value,
              count(*)::int AS roster_total,
              count(*) FILTER (WHERE s.subject_code IS NOT NULL)::int AS captured,
              count(*) FILTER (WHERE s.approved)::int AS approved,
              count(*) FILTER (WHERE s.subject_code IS NULL)::int AS not_captured,
              count(*) FILTER (WHERE r.printed_at IS NOT NULL)::int AS printed,
              count(*) FILTER (WHERE i.rejected)::int AS rejected
         FROM roster r
         LEFT JOIN sets  s ON s.subject_code = r.subject_code
         LEFT JOIN items i ON i.subject_code = r.subject_code
        GROUP BY r.g, r.g2
        ORDER BY r.g NULLS LAST, r.g2 NULLS LAST`,
      params,
    );

    return rows.map((r) => ({
      value: r.value,
      secondaryValue: r.secondary_value,
      rosterTotal: r.roster_total,
      captured: r.captured,
      approved: r.approved,
      notCaptured: r.not_captured,
      printed: r.printed,
      rejected: r.rejected,
    }));
  }

  /**
   * Real column → hardcoded `cs.<column>`. Otherwise `field` must be one of
   * this campaign's own discovered extra keys, and only ever reaches SQL as
   * a BOUND PARAMETER to `cs.extra ->> $n` — `field` itself is never string-
   * interpolated, so no caller-supplied text reaches SQL as raw text either
   * way. Same defense-in-depth shape `CampaignSubjectService.distinctValues`
   * uses for its own `field`.
   */
  private async resolveFieldExpr(
    campaignId: string,
    field: string,
    params: unknown[],
  ): Promise<string> {
    const real = REAL_COLUMNS.find((c) => c.field === field);
    if (real) return `cs.${real.column}`;

    const discovered = await this.discoverExtraFields(campaignId);
    if (!discovered.includes(field)) {
      throw new BadRequestException(
        `field "${field}" không hợp lệ — dùng GET .../roster-group-fields để lấy danh sách field nhóm được`,
      );
    }
    params.push(field);
    return `cs.extra ->> $${params.length}`;
  }

  /**
   * Samples up to `DISCOVERY_SAMPLE_LIMIT` rows (not a full table scan) and
   * keeps a jsonb key only if its distinct-value count within the sample
   * falls in `[2, 500]` — the lower bound excludes constants (e.g. a
   * `nationality_name` that is the same for every row), the upper bound
   * excludes near-unique identifiers (`student_id`/`email`/`identity_number`)
   * that would otherwise let a caller accidentally "group" into a
   * 24,000-row response. Cached in-process per campaign for
   * `DISCOVERY_CACHE_TTL_MS` — same reasoning/shape as
   * `PermissionsGuard`'s own per-user permission cache.
   */
  private async discoverExtraFields(campaignId: string): Promise<string[]> {
    const cached = this.discoveryCache.get(campaignId);
    const now = Date.now();
    if (cached && cached.expiresAt > now) return cached.fields;

    const rows: Array<{ key: string }> = await this.dataSource.query(
      `WITH sample AS (
         SELECT extra FROM campaign_subjects
          WHERE campaign_id = $1 AND status = 'VALID' AND extra IS NOT NULL
          ORDER BY id LIMIT ${DISCOVERY_SAMPLE_LIMIT}
       )
       SELECT kv.key
         FROM sample, jsonb_each_text(sample.extra) AS kv(key, value)
        GROUP BY kv.key
       HAVING COUNT(DISTINCT kv.value) BETWEEN 2 AND 500
        ORDER BY kv.key`,
      [campaignId],
    );
    const fields = rows.map((r) => r.key);
    this.discoveryCache.set(campaignId, {
      fields,
      expiresAt: now + DISCOVERY_CACHE_TTL_MS,
    });
    return fields;
  }
}
