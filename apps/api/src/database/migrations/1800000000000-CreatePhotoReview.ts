import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Schema for the CMS "Duyệt ảnh" (photo review) module —
 * docs/plans/cms-photo-review-plan.md §2. Deliberately has NO foreign key to
 * `campaigns`/`sessions`/`photos`/`users` (device-management/capture/shared
 * tables owned by other modules, some edited concurrently by other agents):
 * `campaign_id`/`source_session_id`/`source_photo_id`/`actor_user_id`/
 * `created_by_user_id` are plain uuid columns, validated at the application
 * layer — see `apps/api/src/modules/photo-review/photo-review.module.ts`'s
 * top comment. This lets the migration run independently of those schemas.
 *
 * `subject_photo_sets.current_card_variant_id` also deliberately has NO
 * foreign key to `photo_variants`, per the task brief's own "add the FK
 * after creating photo_variants, or make it nullable with no hard FK
 * constraint, your call" — skipped here to avoid a two-step
 * create-then-ALTER migration for a pointer the application already
 * validates carefully (see `PhotoReviewService.setCurrent`/`acceptVariant`).
 * `photo_variants` rows are never hard-deleted (only `DISCARDED`), so this
 * is safe.
 */
export class CreatePhotoReview1800000000000 implements MigrationInterface {
  name = 'CreatePhotoReview1800000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "photo_kinds" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "code" character varying(100) NOT NULL,
        "label_vi" character varying(255) NOT NULL,
        "card_spec" jsonb NOT NULL,
        "quality_profile" jsonb,
        "prompt_hints" jsonb NOT NULL DEFAULT '[]',
        "active" boolean NOT NULL DEFAULT true,
        CONSTRAINT "PK_photo_kinds" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_photo_kinds_code" UNIQUE ("code")
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_photo_kinds_created_at" ON "photo_kinds" ("created_at")`);
    await queryRunner.query(`CREATE INDEX "IDX_photo_kinds_code" ON "photo_kinds" ("code")`);

    await queryRunner.query(`
      CREATE TABLE "subject_photo_sets" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "campaign_id" uuid NOT NULL,
        "subject_code" character varying(100) NOT NULL,
        "subject_name" character varying(255),
        "kind_id" uuid NOT NULL,
        "source_session_id" uuid NOT NULL,
        "status" character varying(20) NOT NULL DEFAULT 'PENDING_AUTO',
        "current_card_variant_id" uuid,
        CONSTRAINT "PK_subject_photo_sets" PRIMARY KEY ("id"),
        CONSTRAINT "FK_subject_photo_sets_kind" FOREIGN KEY ("kind_id")
          REFERENCES "photo_kinds"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
        CONSTRAINT "CHK_subject_photo_sets_status" CHECK ("status" IN
          ('PENDING_AUTO', 'READY', 'IN_REVIEW', 'APPROVED', 'REJECTED', 'AUTO_FAILED'))
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_subject_photo_sets_created_at" ON "subject_photo_sets" ("created_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_subject_photo_sets_campaign_id" ON "subject_photo_sets" ("campaign_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_subject_photo_sets_kind_id" ON "subject_photo_sets" ("kind_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_subject_photo_sets_status" ON "subject_photo_sets" ("status")`,
    );
    // Reprocessing an existing set updates it in place rather than inserting
    // a new row (plan §4) — this unique index is a hard guarantee of that,
    // not just an application convention.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_subject_photo_sets_unique" ON "subject_photo_sets" ("campaign_id", "subject_code", "kind_id")`,
    );

    await queryRunner.query(`
      CREATE TABLE "photo_variants" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "set_id" uuid NOT NULL,
        "version" integer NOT NULL,
        "kind" character varying(20) NOT NULL,
        "derived_from_variant_id" uuid,
        "source_photo_id" uuid,
        "fs_file_id" character varying(255),
        "virtual_path" text,
        "bytes" integer,
        "sha256" character varying(64),
        "width" integer,
        "height" integer,
        "dpi" integer,
        "status" character varying(20) NOT NULL DEFAULT 'PROCESSING',
        "prompt" text,
        "region_mode" character varying(30),
        "model_id" character varying(100),
        "algorithm_version" character varying(50),
        "seed" character varying(50),
        "identity_similarity" real,
        "quality_report" jsonb,
        "created_by_user_id" uuid,
        "note" text,
        CONSTRAINT "PK_photo_variants" PRIMARY KEY ("id"),
        CONSTRAINT "FK_photo_variants_set" FOREIGN KEY ("set_id")
          REFERENCES "subject_photo_sets"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_photo_variants_derived_from" FOREIGN KEY ("derived_from_variant_id")
          REFERENCES "photo_variants"("id") ON DELETE SET NULL ON UPDATE NO ACTION,
        CONSTRAINT "CHK_photo_variants_kind" CHECK ("kind" IN ('CARD_AUTO', 'CARD_AI', 'CARD_UPLOAD')),
        CONSTRAINT "CHK_photo_variants_status" CHECK ("status" IN ('PROCESSING', 'READY', 'FAILED', 'DISCARDED'))
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_photo_variants_created_at" ON "photo_variants" ("created_at")`);
    await queryRunner.query(`CREATE INDEX "IDX_photo_variants_set_id" ON "photo_variants" ("set_id")`);

    await queryRunner.query(`
      CREATE TABLE "photo_review_events" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "set_id" uuid NOT NULL,
        "variant_id" uuid,
        "action" character varying(30) NOT NULL,
        "actor_user_id" uuid,
        "payload" jsonb,
        "at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_photo_review_events" PRIMARY KEY ("id"),
        CONSTRAINT "FK_photo_review_events_set" FOREIGN KEY ("set_id")
          REFERENCES "subject_photo_sets"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_photo_review_events_variant" FOREIGN KEY ("variant_id")
          REFERENCES "photo_variants"("id") ON DELETE SET NULL ON UPDATE NO ACTION,
        CONSTRAINT "CHK_photo_review_events_action" CHECK ("action" IN
          ('AUTO_GENERATED', 'AUTO_FAILED', 'REPROCESS', 'AI_REQUESTED', 'AI_ACCEPTED',
           'AI_DISCARDED', 'UPLOAD_REPLACED', 'SET_CURRENT', 'APPROVED', 'REJECTED', 'VIEWED_ORIGINAL'))
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_photo_review_events_created_at" ON "photo_review_events" ("created_at")`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_photo_review_events_set_id" ON "photo_review_events" ("set_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_photo_review_events_at" ON "photo_review_events" ("at")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "photo_review_events"`);
    await queryRunner.query(`DROP TABLE "photo_variants"`);
    await queryRunner.query(`DROP TABLE "subject_photo_sets"`);
    await queryRunner.query(`DROP TABLE "photo_kinds"`);
  }
}
