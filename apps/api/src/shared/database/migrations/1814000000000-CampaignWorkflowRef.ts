import { MigrationInterface, QueryRunner } from 'typeorm';

interface CaptureConfigRow {
  id: string;
  name: string;
  description: string | null;
  capture_angles: unknown;
  card_spec: Record<string, unknown> | null;
}

const DEFAULT_CARD_SPEC = {
  size: '4x6',
  dpi: 300,
  backgroundColor: '#FFFFFF',
  headHeightRatio: [0.7, 0.8],
  eyeLineRatio: [0.4, 0.45],
  retouch: { enabled: true },
};

/**
 * `campaigns.workflow_id`/`workflow_version_id` (cms-8-screens-api-plan.md
 * §2.2/P2 — "campaign tham chiếu đến version"), plus the ONE-TIME data
 * migration the plan calls for: `capture_configurations` "sẽ được thay
 * thế (migrate dữ liệu sang version 1 của workflow tương ứng rồi bỏ
 * bảng)". This migration does the copy; the table itself is NOT dropped
 * here (its 5 routes stay live-but-deprecated for one phase, plan §9.1
 * rule 5) — dropping it is a follow-up once the CMS switches to
 * `/v1/workflows`.
 *
 * Each `capture_configurations` row becomes one `workflows` row
 * (`status='ACTIVE'`, code derived from its name) with exactly one
 * PUBLISHED `workflow_versions` row (version 1) whose `config` wraps that
 * row's `capture_angles`/`card_spec` into the 6-group shape
 * (`domain/schema/workflow-config.schema.ts`) — the four groups a capture
 * configuration never had an opinion on (`identification`, `eligibility`,
 * `aiProcessing`, `printing`) get conservative, explicit defaults, never
 * silently blank.
 *
 * `down()` only drops the new campaign columns — the migrated
 * `workflows`/`workflow_versions` rows are left in place (an admin can
 * delete them by hand if a rollback truly needs to undo the copy; this
 * matches the "additive, not truly reversible" posture other data
 * migrations in this codebase already take rather than pretending a clean
 * reverse exists for a one-time data copy).
 */
export class CampaignWorkflowRef1814000000000 implements MigrationInterface {
  name = 'CampaignWorkflowRef1814000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "campaigns"
        ADD COLUMN "workflow_id" uuid,
        ADD COLUMN "workflow_version_id" uuid
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_campaigns_workflow_id" ON "campaigns" ("workflow_id")`,
    );

    const configs = (await queryRunner.query(
      `SELECT id, name, description, capture_angles, card_spec FROM "capture_configurations" ORDER BY created_at`,
    )) as CaptureConfigRow[];

    const usedCodes = new Set<string>();
    for (const row of configs) {
      const code = this.deriveUniqueCode(row.name, row.id, usedCodes);
      const angles = Array.isArray(row.capture_angles)
        ? row.capture_angles
        : [];
      const cardSourceStep = angles.find(
        (a): a is { id?: string; isCardSource?: boolean } =>
          typeof a === 'object' &&
          a !== null &&
          (a as { isCardSource?: boolean }).isCardSource === true,
      );

      const config = {
        capture: {
          angles,
          clickMode: {
            default: 'MANUAL_SEQUENTIAL',
            allowed: ['MANUAL_SEQUENTIAL', 'MANUAL_ALL_AT_ONCE', 'AUTO_AI'],
          },
          shotsPerCamera: 1,
          cardSourceAngleCode: cardSourceStep?.id ?? null,
        },
        identification: {
          methods: ['MANUAL_LOOKUP'],
          lookupKeyField: 'studentCode',
        },
        eligibility: { mode: 'NONE' },
        aiProcessing: { enabled: false, steps: [] },
        output: {
          photoKindCode: 'STUDENT_CARD',
          cardSpec: row.card_spec ?? DEFAULT_CARD_SPEC,
        },
        printing: { mode: 'CENTRALIZED' },
      };

      const [{ id: workflowId }] = (await queryRunner.query(
        `INSERT INTO "workflows" ("code", "name", "description", "status")
         VALUES ($1, $2, $3, 'ACTIVE') RETURNING "id"`,
        [code, row.name, row.description],
      )) as Array<{ id: string }>;
      const [{ id: versionId }] = (await queryRunner.query(
        `INSERT INTO "workflow_versions" ("workflow_id", "version", "config", "published_at", "note")
         VALUES ($1, 1, $2, now(), 'Migrated from capture_configurations (1814000000000)')
         RETURNING "id"`,
        [workflowId, JSON.stringify(config)],
      )) as Array<{ id: string }>;
      await queryRunner.query(
        `UPDATE "workflows" SET "current_version_id" = $1 WHERE "id" = $2`,
        [versionId, workflowId],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_campaigns_workflow_id"`);
    await queryRunner.query(`
      ALTER TABLE "campaigns"
        DROP COLUMN "workflow_version_id",
        DROP COLUMN "workflow_id"
    `);
  }

  /** `UPPER_SNAKE` from the name, truncated to fit `workflows.code varchar(50)`, de-duplicated within this run. */
  private deriveUniqueCode(
    name: string,
    fallbackId: string,
    used: Set<string>,
  ): string {
    const base =
      this.stripDiacritics(name)
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 40) || `CFG_${fallbackId.slice(0, 8).toUpperCase()}`;

    let code = base;
    let suffix = 1;
    while (used.has(code)) {
      suffix += 1;
      code = `${base.slice(0, 47)}_${suffix}`;
    }
    used.add(code);
    return code;
  }

  /**
   * NFD-decompose (base letter + combining marks), then drop every
   * codepoint in the Combining Diacritical Marks block (U+0300-U+036F) via
   * numeric char-code comparison — deliberately not a regex character
   * class of literal combining characters in source, which are trivial to
   * corrupt silently in transit/copy/paste and would fail with no visible
   * diff. `charCodeAt`/`fromCharCode` are fine here: every codepoint in
   * that block is within the Basic Multilingual Plane (no surrogate pairs
   * to worry about).
   */
  private stripDiacritics(value: string): string {
    let result = '';
    for (const ch of value.normalize('NFD')) {
      const code = ch.charCodeAt(0);
      if (code < 0x0300 || code > 0x036f) {
        result += ch;
      }
    }
    return result;
  }
}
