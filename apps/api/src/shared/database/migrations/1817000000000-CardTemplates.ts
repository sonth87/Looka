import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * P5 — cms-8-screens-api-plan.md §2.6/§5 phase table: "card_templates +
 * assets + render engine (sharp/SVG) + preview + catalog biến."
 *
 * `card_templates` is a single mutable row per template (NOT a separate
 * versions table like `workflows`/`workflow_versions`, D-Q1) — the plan's
 * own schema sketch (§2.6) only gives it one `version int` column, no
 * `card_template_versions` table. `CardTemplateService.patch()` bumps that
 * column in place once the template is `ACTIVE` and already used
 * (`usageCount > 0`, per the plan's own PATCH note); it does not fork a new
 * row, so `print_items.template_id` keeps pointing at one stable id even
 * as the row's `front`/`back` content changes over time — see that
 * service's own doc comment for the full reasoning.
 *
 * `front`/`back` are `jsonb` validated at the application layer by
 * `card-template-layout.schema.ts` (zod), same "loose column, real
 * validation in code" approach `workflow_versions.config` already uses.
 */
export class CardTemplates1817000000000 implements MigrationInterface {
  name = 'CardTemplates1817000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "card_templates" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "code" character varying(50) NOT NULL,
        "name" character varying(255) NOT NULL,
        "description" text,
        "status" character varying(10) NOT NULL DEFAULT 'DRAFT',
        "version" integer NOT NULL DEFAULT 1,
        "card_width_mm" real NOT NULL DEFAULT 85.6,
        "card_height_mm" real NOT NULL DEFAULT 54,
        "dpi" integer NOT NULL DEFAULT 300,
        "front" jsonb NOT NULL DEFAULT '{"background":{"color":"#FFFFFF","assetId":null},"elements":[]}',
        "back" jsonb NOT NULL DEFAULT '{"background":{"color":"#FFFFFF","assetId":null},"elements":[]}',
        "created_by_user_id" uuid,
        "published_at" TIMESTAMP WITH TIME ZONE,
        "archived_at" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_card_templates" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_card_templates_code" UNIQUE ("code"),
        CONSTRAINT "CHK_card_templates_status" CHECK ("status" IN ('DRAFT', 'ACTIVE', 'ARCHIVED')),
        CONSTRAINT "CHK_card_templates_dpi" CHECK ("dpi" IN (300, 600))
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_card_templates_status" ON "card_templates" ("status")`,
    );

    await queryRunner.query(`
      CREATE TABLE "card_template_assets" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "template_id" uuid NOT NULL,
        "kind" character varying(20) NOT NULL,
        "fs_file_id" character varying(255) NOT NULL,
        "file_name" character varying(255) NOT NULL,
        "mime_type" character varying(100) NOT NULL,
        "width" integer,
        "height" integer,
        CONSTRAINT "PK_card_template_assets" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_card_template_assets_kind" CHECK ("kind" IN ('LOGO', 'BACKGROUND', 'FONT')),
        CONSTRAINT "FK_card_template_assets_template" FOREIGN KEY ("template_id")
          REFERENCES "card_templates" ("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_card_template_assets_template_id" ON "card_template_assets" ("template_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "card_template_assets"`);
    await queryRunner.query(`DROP TABLE "card_templates"`);
  }
}
