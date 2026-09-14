import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * P6 — cms-8-screens-api-plan.md §2.5/§2.7 (last backend phase of the
 * 8-screen plan). Five tables: `print_batches`/`print_items`/
 * `print_item_events` (§2.5, "Đợt in thẻ") and `printers`/
 * `printer_stock_events` (§2.7, "Quản lý máy in").
 *
 * Cross-module references (`campaign_id`, `set_id`/`variant_id` →
 * photo-review's `subject_photo_sets`/`photo_variants`, `template_id`/
 * `default_template_id` → card-template's `card_templates`, `device_id` →
 * device-management's `devices`) are plain `uuid` columns with NO FK
 * constraint — same convention `campaigns.workflow_id`/
 * `subject_photo_sets.current_card_variant_id` already established: a
 * module must not take a hard DB dependency on another feature module's
 * table just because they happen to share one Postgres instance (see each
 * of those columns' own doc comment). This holds even for `template_id`,
 * even though `PrintModule` DOES take a real Nest-level dependency on
 * `CardTemplateModule` (to reuse the render engine) — a TypeORM FK is a
 * stronger, DDL-level coupling than an injected service and is avoided for
 * the same reason.
 *
 * Within this migration's own five tables, FKs ARE used freely
 * (`print_items.batch_id` → `print_batches`, `print_items.printer_id`/
 * `print_batches.printer_id` → `printers`, `print_item_events.item_id` →
 * `print_items`, `printer_stock_events.printer_id` → `printers`,
 * `print_items.reprint_of_item_id` → itself) — these all live in one
 * module's own migration, so there is no cross-module coupling concern.
 *
 * `print_items.campaign_id`/`class_name`/`faculty`/`full_name` are
 * denormalized from `subject_photo_sets` at bulk-create time (§2.5's
 * "person-data source priority" — see `PrintItemService.bulkCreate`) rather
 * than joined at read time, same reasoning `subject_photo_sets` itself
 * denormalizes from `campaign_subjects` (P4) and `stats_daily_review`
 * denormalizes `campaign_id` — every list/filter/group query on this
 * screen (`GET /v1/print/items?campaignId&className&faculty`,
 * `GET /v1/print/items/groups`) reads only this table, no cross-module join
 * on the hot list path.
 *
 * The partial unique index on `print_items(set_id)` (excluding
 * CANCELLED/FAILED/REPRINT_REQUESTED — see `PRINT_ITEM_INACTIVE_STATUSES`'s
 * own doc comment) is the "1 person, 1 currently-valid card item" rule the
 * plan states explicitly — a set can accumulate CANCELLED/FAILED/
 * REPRINT_REQUESTED history (a bulk-create retried after a failed render,
 * or an item superseded by a reprint) without blocking a fresh item for the
 * same set. REPRINT_REQUESTED had to be added here after the first version
 * of this migration shipped without it: `PrintItemService.reprint` moves
 * the original item to REPRINT_REQUESTED (not a terminal status) and
 * inserts a new active row for the same `set_id` in the same transaction —
 * without REPRINT_REQUESTED excluded, that insert 409s against this very
 * index, confirmed live the first time `POST .../reprint` was exercised
 * end-to-end.
 */
export class Print1818000000000 implements MigrationInterface {
  name = 'Print1818000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── printers (§2.7) — created first, print_batches/print_items FK into it ──
    await queryRunner.query(`
      CREATE TABLE "printers" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "name" character varying(255) NOT NULL,
        "model" character varying(255),
        "print_mode" character varying(12) NOT NULL DEFAULT 'SINGLE_SIDE',
        "usage_mode" character varying(12) NOT NULL DEFAULT 'CENTRALIZED',
        "location" character varying(255),
        "device_id" uuid,
        "connection" jsonb,
        "status" character varying(10) NOT NULL DEFAULT 'OFFLINE',
        "last_seen_at" TIMESTAMP WITH TIME ZONE,
        "last_error" text,
        "blank_stock" integer NOT NULL DEFAULT 0,
        "blank_stock_updated_at" TIMESTAMP WITH TIME ZONE,
        "low_stock_threshold" integer NOT NULL DEFAULT 0,
        "default_template_id" uuid,
        "agent_token_hash" character varying(64),
        CONSTRAINT "PK_printers" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_printers_print_mode" CHECK ("print_mode" IN ('SINGLE_SIDE', 'DUPLEX')),
        CONSTRAINT "CHK_printers_usage_mode" CHECK ("usage_mode" IN ('DIRECT', 'CENTRALIZED')),
        CONSTRAINT "CHK_printers_status" CHECK ("status" IN ('ONLINE', 'OFFLINE', 'ERROR', 'DISABLED'))
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_printers_status" ON "printers" ("status")`,
    );
    // Partial + unique: most printers never get a token issued (DIRECT mode
    // is out of scope this pass, see PrintAgentController's own doc
    // comment), and NULL != NULL under a plain UNIQUE constraint anyway, so
    // the partial WHERE is belt-and-suspenders documentation of that intent
    // more than a behavioural necessity.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_printers_agent_token_hash" ON "printers" ("agent_token_hash") WHERE "agent_token_hash" IS NOT NULL`,
    );

    // ── print_batches (§2.5) ──
    await queryRunner.query(`
      CREATE TABLE "print_batches" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "code" character varying(50) NOT NULL,
        "name" character varying(255) NOT NULL,
        "campaign_id" uuid,
        "default_template_id" uuid,
        "printer_id" uuid,
        "mode" character varying(12) NOT NULL DEFAULT 'CENTRALIZED',
        "status" character varying(12) NOT NULL DEFAULT 'DRAFT',
        "created_by_user_id" uuid,
        "item_count" integer NOT NULL DEFAULT 0,
        "printed_count" integer NOT NULL DEFAULT 0,
        "failed_count" integer NOT NULL DEFAULT 0,
        "sent_at" TIMESTAMP WITH TIME ZONE,
        "done_at" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_print_batches" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_print_batches_code" UNIQUE ("code"),
        CONSTRAINT "CHK_print_batches_mode" CHECK ("mode" IN ('DIRECT', 'CENTRALIZED')),
        CONSTRAINT "CHK_print_batches_status" CHECK ("status" IN ('DRAFT', 'READY', 'PRINTING', 'DONE', 'CANCELLED')),
        CONSTRAINT "FK_print_batches_printer" FOREIGN KEY ("printer_id")
          REFERENCES "printers" ("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_print_batches_campaign_id" ON "print_batches" ("campaign_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_print_batches_status" ON "print_batches" ("status")`,
    );

    // ── print_items (§2.5) ──
    await queryRunner.query(`
      CREATE TABLE "print_items" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "batch_id" uuid,
        "campaign_id" uuid NOT NULL,
        "set_id" uuid NOT NULL,
        "variant_id" uuid,
        "subject_code" character varying(100) NOT NULL,
        "full_name" character varying(255),
        "class_name" character varying(100),
        "faculty" character varying(255),
        "extra" jsonb,
        "template_id" uuid,
        "rendered_front_fs_file_id" character varying(255),
        "rendered_back_fs_file_id" character varying(255),
        "rendered_at" TIMESTAMP WITH TIME ZONE,
        "status" character varying(20) NOT NULL DEFAULT 'PENDING',
        "printer_id" uuid,
        "printed_at" TIMESTAMP WITH TIME ZONE,
        "error_message" text,
        "reprint_of_item_id" uuid,
        CONSTRAINT "PK_print_items" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_print_items_status" CHECK ("status" IN (
          'PENDING', 'RENDERED', 'QUEUED', 'PRINTING', 'PRINTED', 'FAILED',
          'REPRINT_REQUESTED', 'CANCELLED'
        )),
        CONSTRAINT "FK_print_items_batch" FOREIGN KEY ("batch_id")
          REFERENCES "print_batches" ("id") ON DELETE SET NULL,
        CONSTRAINT "FK_print_items_printer" FOREIGN KEY ("printer_id")
          REFERENCES "printers" ("id") ON DELETE SET NULL,
        CONSTRAINT "FK_print_items_reprint_of" FOREIGN KEY ("reprint_of_item_id")
          REFERENCES "print_items" ("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_print_items_batch_id" ON "print_items" ("batch_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_print_items_campaign_id" ON "print_items" ("campaign_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_print_items_status" ON "print_items" ("status")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_print_items_set_id" ON "print_items" ("set_id")`,
    );
    // "1 person, 1 currently-valid card item" — see this migration's own top
    // comment. Plain (non-partial) uniqueness would block a legitimate
    // re-bulk-create after an earlier attempt ended CANCELLED/FAILED, and
    // (REPRINT_REQUESTED) would make `reprint()` unable to ever insert its
    // replacement row.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_print_items_set_id_active" ON "print_items" ("set_id") WHERE "status" NOT IN ('CANCELLED', 'FAILED', 'REPRINT_REQUESTED')`,
    );

    // ── print_item_events (§2.5) ──
    await queryRunner.query(`
      CREATE TABLE "print_item_events" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "item_id" uuid NOT NULL,
        "from_status" character varying(20),
        "to_status" character varying(20) NOT NULL,
        "source" character varying(12) NOT NULL,
        "actor_user_id" uuid,
        "message" text,
        "at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_print_item_events" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_print_item_events_source" CHECK ("source" IN ('SYSTEM', 'PRINT_AGENT', 'MANUAL')),
        CONSTRAINT "FK_print_item_events_item" FOREIGN KEY ("item_id")
          REFERENCES "print_items" ("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_print_item_events_item_id" ON "print_item_events" ("item_id")`,
    );

    // ── printer_stock_events (§2.7) ──
    await queryRunner.query(`
      CREATE TABLE "printer_stock_events" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "printer_id" uuid NOT NULL,
        "delta" integer NOT NULL,
        "reason" character varying(10) NOT NULL,
        "resulting_stock" integer NOT NULL,
        "actor_user_id" uuid,
        "note" text,
        "at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_printer_stock_events" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_printer_stock_events_reason" CHECK ("reason" IN ('REFILL', 'PRINT', 'ADJUST', 'WASTE')),
        CONSTRAINT "FK_printer_stock_events_printer" FOREIGN KEY ("printer_id")
          REFERENCES "printers" ("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_printer_stock_events_printer_id" ON "printer_stock_events" ("printer_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "printer_stock_events"`);
    await queryRunner.query(`DROP TABLE "print_item_events"`);
    await queryRunner.query(`DROP TABLE "print_items"`);
    await queryRunner.query(`DROP TABLE "print_batches"`);
    await queryRunner.query(`DROP TABLE "printers"`);
  }
}
