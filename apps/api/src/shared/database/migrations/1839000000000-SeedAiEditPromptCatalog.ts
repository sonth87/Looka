import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds a few ready-to-use `/edit` prompt presets to the `ai_pipeline_steps`
 * catalog (user request 2026-09-28, "gen cho tôi 1 số prompt trong
 * ai_pipeline_steps sẵn luôn") — until now the catalog's only `/edit` row
 * was the single `AI_EDIT` entry with an empty `default_params` (no prompt
 * at all, per `1813000000000-CreateAiPipelineSteps.ts`'s own seed). These
 * give a workflow author (or the executor's own fallback when a step's
 * `params.prompt` is unset — see `PhotoReviewService.runAiProcessingPipeline`)
 * real, working presets to pick from instead of the service's own generic
 * default.
 *
 * `isSystem: false` on every new row here, matching
 * `create-ai-pipeline-step.handler.ts`'s own rule ("entity.isSystem =
 * false" for every CMS-created step) — these are ordinary, editable
 * presets, not protected catalog entries like the original four.
 *
 * Every prompt is English (the integration guide: "prompt tiếng Việt cho
 * kết quả kém hơn rõ rệt") and stays inside plan §6.3's boundary
 * (`FORBIDDEN_PROMPT_KEYWORDS` in `photo-review.constants.ts` — no
 * expression/eye/glasses/face-shape/age/beautification/feature changes) —
 * explicit "keep the face unchanged" language in each one, not just an
 * absence of the forbidden Vietnamese keywords (those only ever match
 * Vietnamese substrings, so English text never trips that specific guard,
 * but the actual product boundary still applies).
 *
 * `BACKGROUND_REPLACE`'s own `default_params.color` is also updated here,
 * from `'#FFFFFF'` to `'#F37320'` (Flame Orange) — the same new
 * system-wide default `1840000000000-UpdateDefaultCardBackgroundColor.ts`
 * applies to `photo_kinds.card_spec.backgroundColor` (the field that
 * actually drives real output images today). `BACKGROUND_REPLACE` itself
 * has no `PhotoAiPort` implementation yet (see
 * `PhotoReviewService.runAiProcessingPipeline`'s own doc comment — it is
 * logged and skipped, a known gap) so this one change has no runtime
 * effect today, but keeps the catalog's stated default consistent with the
 * rest of the system rather than silently still saying white.
 */
export class SeedAiEditPromptCatalog1839000000000
  implements MigrationInterface
{
  name = 'SeedAiEditPromptCatalog1839000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "ai_pipeline_steps"
         SET "default_params" = '{"color": "#F37320"}'::jsonb
       WHERE "code" = 'BACKGROUND_REPLACE'
         AND "default_params" = '{"color": "#FFFFFF"}'::jsonb
    `);

    await queryRunner.query(`
      INSERT INTO "ai_pipeline_steps"
        ("code", "name_vi", "description", "sidecar_endpoint", "default_params", "sort_order", "is_system") VALUES
        ('AI_EDIT_LIGHTING', 'Sửa ảnh: cân sáng & màu da', 'Cân đều ánh sáng, khử ám màu trên da — không đổi biểu cảm hay nét mặt', '/edit',
          '{"prompt": "Even out the lighting and remove any color cast on the skin tone. Do not change the facial expression or features, and do not apply any beautification. Keep the face exactly as captured."}'::jsonb, 41, false),
        ('AI_EDIT_BACKGROUND_CLEANUP', 'Sửa ảnh: dọn phông nền', 'Khử nhiễu, bóng và tạp chất trên phông nền, làm đều sáng phông — giữ nguyên chủ thể', '/edit',
          '{"prompt": "Clean up the background: remove noise, shadows, and artifacts, and make the background evenly lit. Do not alter the subject''s face, expression, or hair in any way."}'::jsonb, 42, false),
        ('AI_EDIT_SHARPEN', 'Sửa ảnh: làm nét nhẹ', 'Làm nét nhẹ chi tiết nhỏ (tóc, vải áo) mà không đổi cấu trúc khuôn mặt', '/edit',
          '{"prompt": "Slightly sharpen fine details such as hair strands and clothing texture, without altering the facial structure, expression, or skin texture beyond minor noise reduction."}'::jsonb, 43, false)
      ON CONFLICT ("code") DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM "ai_pipeline_steps"
       WHERE "code" IN ('AI_EDIT_LIGHTING', 'AI_EDIT_BACKGROUND_CLEANUP', 'AI_EDIT_SHARPEN')
    `);
    await queryRunner.query(`
      UPDATE "ai_pipeline_steps"
         SET "default_params" = '{"color": "#FFFFFF"}'::jsonb
       WHERE "code" = 'BACKGROUND_REPLACE'
         AND "default_params" = '{"color": "#F37320"}'::jsonb
    `);
  }
}
