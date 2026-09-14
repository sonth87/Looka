import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Catalog of AI processing steps a workflow's `config.aiProcessing.steps[]`
 * can reference by `code` — cms-8-screens-api-plan.md §2.2 ("thêm 1 mục
 * quản lý các mục quy trình của AI"). Seeded from the sidecar routes that
 * genuinely exist (`services/python-ai`, confirmed in the CMS-8-screens
 * research: `/card-photo`, `/background`, `/retouch` are real; `/edit` is
 * a 501 stub — seeded anyway so a workflow author can select it and get a
 * clear "not implemented yet" at run time rather than the option not
 * existing at all). `sidecar_endpoint` is a CHECK, not a free string — the
 * only integration surface `PhotoAiPort`/`PhotoReviewSidecarService`
 * actually understand.
 */
export class CreateAiPipelineSteps1813000000000 implements MigrationInterface {
  name = 'CreateAiPipelineSteps1813000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "ai_pipeline_steps" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "code" character varying(50) NOT NULL,
        "name_vi" character varying(255) NOT NULL,
        "description" text,
        "sidecar_endpoint" character varying(20) NOT NULL,
        "params_schema" jsonb,
        "default_params" jsonb,
        "active" boolean NOT NULL DEFAULT true,
        "sort_order" integer NOT NULL DEFAULT 0,
        "is_system" boolean NOT NULL DEFAULT false,
        CONSTRAINT "PK_ai_pipeline_steps" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_ai_pipeline_steps_code" UNIQUE ("code"),
        CONSTRAINT "CHK_ai_pipeline_steps_endpoint"
          CHECK ("sidecar_endpoint" IN ('/card-photo', '/background', '/retouch', '/edit'))
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_ai_pipeline_steps_created_at" ON "ai_pipeline_steps" ("created_at")`,
    );

    await queryRunner.query(`
      INSERT INTO "ai_pipeline_steps"
        ("code", "name_vi", "description", "sidecar_endpoint", "default_params", "sort_order", "is_system") VALUES
        ('CARD_CROP', 'Cắt & chuẩn ảnh thẻ', 'Căn chỉnh, crop theo tỉ lệ đầu/mắt, xuất đúng cỡ/dpi ảnh thẻ', '/card-photo',
          '{"size": "4x6", "dpi": 300}'::jsonb, 10, true),
        ('BACKGROUND_REPLACE', 'Thay nền', 'Thay nền ảnh về màu chuẩn (thường trắng)', '/background',
          '{"color": "#FFFFFF"}'::jsonb, 20, true),
        ('SKIN_SMOOTH', 'Làm mịn da', 'Làm mịn da theo mặt nạ vùng da, giữ nguyên đường nét', '/retouch',
          '{"strength": "LIGHT"}'::jsonb, 30, true),
        ('AI_EDIT', 'Sửa ảnh theo prompt', 'Sửa ảnh theo mô tả tự do — hiện sidecar trả 501 (chưa có model)', '/edit',
          '{}'::jsonb, 40, true)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "ai_pipeline_steps"`);
  }
}
