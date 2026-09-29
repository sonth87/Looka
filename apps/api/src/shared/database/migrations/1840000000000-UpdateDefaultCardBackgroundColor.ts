import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * New system-wide default output-photo background color (user request
 * 2026-09-28: "mặc định ảnh phải có phông nền màu #F37320 Flame Orange") —
 * `#F37320` replaces `#FFFFFF`, matching the standard the project's own
 * `docs/plans/card-photo-export-and-filters-plan-2026-09-17.md` §F.2
 * already settled on (there as `#F67220` — a close but different value;
 * this pass's explicit ask, `#F37320`, is the one actually applied).
 *
 * Only touches the `STUDENT_CARD` `photo_kinds` row seeded by
 * `1800001000000-SeedStudentCardPhotoKind.ts` — the one column that
 * actually feeds real output images today (`PhotoAiAdapter.makeCardPhoto`,
 * via `kind.cardSpec` in `PhotoReviewService.reprocess`/`uploadVariant`).
 * Guarded by `WHERE code = 'STUDENT_CARD' AND card_spec->>'backgroundColor'
 * = '#FFFFFF'` (the `code` filter added 2026-09-29 — the original guard was
 * only the backgroundColor check, so it silently matched EVERY photo kind
 * still on the old white default, not just `STUDENT_CARD` as this comment
 * always claimed; an admin-created kind that deliberately chose white would
 * have been flipped to orange too) so a kind some admin already customized
 * away from the old default is left alone — this is a new-default change,
 * not a forced overwrite of a deliberate choice. Per that same plan doc's
 * own decision, deliberately NOT retroactive to `campaigns.card_spec`
 * overrides (an explicit per-campaign choice an admin made on purpose) or
 * to any already-generated photo.
 */
export class UpdateDefaultCardBackgroundColor1840000000000 implements MigrationInterface {
  name = 'UpdateDefaultCardBackgroundColor1840000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "photo_kinds"
         SET "card_spec" = jsonb_set("card_spec", '{backgroundColor}', '"#F37320"'::jsonb)
       WHERE "code" = 'STUDENT_CARD' AND "card_spec"->>'backgroundColor' = '#FFFFFF'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "photo_kinds"
         SET "card_spec" = jsonb_set("card_spec", '{backgroundColor}', '"#FFFFFF"'::jsonb)
       WHERE "code" = 'STUDENT_CARD' AND "card_spec"->>'backgroundColor' = '#F37320'
    `);
  }
}
