import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * P4 — cms-8-screens-api-plan.md §2.9/§5 phase table: "StatsModule: 6 bảng
 * stats_*, ... due_at, denormalize subject_photo_sets."
 *
 * Six new tables, all with `computed_at` (last time a row's counts were
 * touched, by either the action-based hot path or a cron recompute) and a
 * unique key over their grouping columns so `INSERT ... ON CONFLICT (key) DO
 * UPDATE SET col = col + n` works. Every grouping column that can be
 * "unknown" (`device_id`, `operator_user_id`, `reviewer_user_id`,
 * `printer_id`) is `uuid NOT NULL DEFAULT '00000000-...'` (the
 * `STATS_UNKNOWN_UUID` sentinel — see `stats.constants.ts`), never a real
 * nullable column: Postgres `UNIQUE` treats two NULLs as distinct, which
 * would silently break that upsert (every "unknown" row would insert fresh
 * instead of accumulating into one).
 *
 * `subject_photo_sets` also gains `class_name`/`major`/`faculty`/
 * `citizen_id` (denormalized from `campaign_subjects`/`sessions.metadata` at
 * set-creation time — cms-8-screens-api-plan.md §2.4) and `due_at`
 * (`sessions.completed_at + campaigns.processing_sla_hours`, per
 * `campaigns.entity.ts`'s own doc comment pointing at this exact migration)
 * — plus the `(status, due_at)` index the plan's §2.9 "Lưu ý" explicitly
 * calls for ("danh sách chi tiết vẫn truy vấn bảng nguồn bằng index").
 */
export class StatsModule1816000000000 implements MigrationInterface {
  name = 'StatsModule1816000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const unknownUuid = "'00000000-0000-0000-0000-000000000000'";

    await queryRunner.query(`
      CREATE TABLE "stats_daily_captures" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "date" date NOT NULL,
        "campaign_id" uuid NOT NULL,
        "device_id" uuid NOT NULL DEFAULT ${unknownUuid},
        "operator_user_id" uuid NOT NULL DEFAULT ${unknownUuid},
        "sessions_started" integer NOT NULL DEFAULT 0,
        "sessions_completed" integer NOT NULL DEFAULT 0,
        "subjects_captured" integer NOT NULL DEFAULT 0,
        "photos_total" integer NOT NULL DEFAULT 0,
        "photos_ready" integer NOT NULL DEFAULT 0,
        "photos_failed" integer NOT NULL DEFAULT 0,
        "retakes" integer NOT NULL DEFAULT 0,
        "cb_help" integer NOT NULL DEFAULT 0,
        "by_trigger" jsonb NOT NULL DEFAULT '{}',
        "by_capture_mode" jsonb NOT NULL DEFAULT '{}',
        "timing_count" integer NOT NULL DEFAULT 0,
        "timing_sum_ms" bigint NOT NULL DEFAULT 0,
        "timing_min_ms" integer,
        "timing_max_ms" integer,
        "timing_p50_ms" integer,
        "timing_p95_ms" integer,
        "computed_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_stats_daily_captures" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_stats_daily_captures_key" UNIQUE ("date", "campaign_id", "device_id", "operator_user_id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_stats_daily_captures_campaign_id" ON "stats_daily_captures" ("campaign_id")`,
    );

    await queryRunner.query(`
      CREATE TABLE "stats_daily_identification" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "date" date NOT NULL,
        "campaign_id" uuid NOT NULL,
        "device_id" uuid NOT NULL DEFAULT ${unknownUuid},
        "method" character varying(30) NOT NULL DEFAULT 'UNKNOWN',
        "count" integer NOT NULL DEFAULT 0,
        "failed_count" integer NOT NULL DEFAULT 0,
        "computed_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_stats_daily_identification" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_stats_daily_identification_key" UNIQUE ("date", "campaign_id", "device_id", "method")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_stats_daily_identification_campaign_id" ON "stats_daily_identification" ("campaign_id")`,
    );

    await queryRunner.query(`
      CREATE TABLE "stats_daily_review" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "date" date NOT NULL,
        "campaign_id" uuid NOT NULL,
        "reviewer_user_id" uuid NOT NULL DEFAULT ${unknownUuid},
        "sets_created" integer NOT NULL DEFAULT 0,
        "approved" integer NOT NULL DEFAULT 0,
        "rejected" integer NOT NULL DEFAULT 0,
        "ai_requested" integer NOT NULL DEFAULT 0,
        "ai_accepted" integer NOT NULL DEFAULT 0,
        "uploaded" integer NOT NULL DEFAULT 0,
        "auto_failed" integer NOT NULL DEFAULT 0,
        "review_sum_hours" real NOT NULL DEFAULT 0,
        "computed_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_stats_daily_review" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_stats_daily_review_key" UNIQUE ("date", "campaign_id", "reviewer_user_id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_stats_daily_review_campaign_id" ON "stats_daily_review" ("campaign_id")`,
    );

    await queryRunner.query(`
      CREATE TABLE "stats_daily_print" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "date" date NOT NULL,
        "campaign_id" uuid NOT NULL,
        "printer_id" uuid NOT NULL DEFAULT ${unknownUuid},
        "rendered" integer NOT NULL DEFAULT 0,
        "printed" integer NOT NULL DEFAULT 0,
        "failed" integer NOT NULL DEFAULT 0,
        "reprints" integer NOT NULL DEFAULT 0,
        "blank_used" integer NOT NULL DEFAULT 0,
        "computed_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_stats_daily_print" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_stats_daily_print_key" UNIQUE ("date", "campaign_id", "printer_id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_stats_daily_print_campaign_id" ON "stats_daily_print" ("campaign_id")`,
    );

    await queryRunner.query(`
      CREATE TABLE "stats_campaign_snapshot" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "campaign_id" uuid NOT NULL,
        "quota" integer,
        "roster_valid" integer NOT NULL DEFAULT 0,
        "sessions" integer NOT NULL DEFAULT 0,
        "subjects_captured" integer NOT NULL DEFAULT 0,
        "processed" integer NOT NULL DEFAULT 0,
        "pending_review" integer NOT NULL DEFAULT 0,
        "capture_errors" integer NOT NULL DEFAULT 0,
        "not_captured" integer,
        "printed" integer NOT NULL DEFAULT 0,
        "overdue" integer NOT NULL DEFAULT 0,
        "in_progress_now" integer NOT NULL DEFAULT 0,
        "last_capture_at" TIMESTAMP WITH TIME ZONE,
        "computed_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_stats_campaign_snapshot" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_stats_campaign_snapshot_campaign_id" UNIQUE ("campaign_id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "stats_jobs" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "kind" character varying(20) NOT NULL,
        "range_from" date,
        "range_to" date,
        "scope" jsonb,
        "status" character varying(10) NOT NULL,
        "started_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "finished_at" TIMESTAMP WITH TIME ZONE,
        "rows_written" integer NOT NULL DEFAULT 0,
        "error" text,
        "triggered_by_user_id" uuid,
        CONSTRAINT "PK_stats_jobs" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_stats_jobs_kind" CHECK ("kind" IN ('SNAPSHOT_REFRESH', 'DAILY_RECOMPUTE', 'REBUILD')),
        CONSTRAINT "CHK_stats_jobs_status" CHECK ("status" IN ('RUNNING', 'DONE', 'FAILED'))
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_stats_jobs_kind" ON "stats_jobs" ("kind")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_stats_jobs_status" ON "stats_jobs" ("status")`,
    );

    await queryRunner.query(`
      ALTER TABLE "subject_photo_sets"
        ADD COLUMN "class_name" character varying(100),
        ADD COLUMN "major" character varying(255),
        ADD COLUMN "faculty" character varying(255),
        ADD COLUMN "citizen_id" character varying(20),
        ADD COLUMN "due_at" TIMESTAMP WITH TIME ZONE
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_subject_photo_sets_status_due_at" ON "subject_photo_sets" ("status", "due_at")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "IDX_subject_photo_sets_status_due_at"`,
    );
    await queryRunner.query(`
      ALTER TABLE "subject_photo_sets"
        DROP COLUMN "due_at",
        DROP COLUMN "citizen_id",
        DROP COLUMN "faculty",
        DROP COLUMN "major",
        DROP COLUMN "class_name"
    `);
    await queryRunner.query(`DROP TABLE "stats_jobs"`);
    await queryRunner.query(`DROP TABLE "stats_campaign_snapshot"`);
    await queryRunner.query(`DROP TABLE "stats_daily_print"`);
    await queryRunner.query(`DROP TABLE "stats_daily_review"`);
    await queryRunner.query(`DROP TABLE "stats_daily_identification"`);
    await queryRunner.query(`DROP TABLE "stats_daily_captures"`);
  }
}
