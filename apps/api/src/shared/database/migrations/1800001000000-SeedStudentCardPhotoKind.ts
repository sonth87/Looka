import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Seeds the first (and, at this pass, only) `photo_kinds` row — student
 * card, plan §5.6/R-Q7 answer: 4x6 cm, 300 dpi, white background.
 * `prompt_hints` is seeded from a handful of the plan's §5.3 AI-edit
 * suggestion chips.
 */
export class SeedStudentCardPhotoKind1800001000000 implements MigrationInterface {
  name = 'SeedStudentCardPhotoKind1800001000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `INSERT INTO "photo_kinds" ("code", "label_vi", "card_spec", "prompt_hints", "active")
       VALUES ('STUDENT_CARD', 'Ảnh thẻ sinh viên', $1::jsonb, $2::jsonb, true)`,
      [
        JSON.stringify({
          size: '4x6',
          dpi: 300,
          backgroundColor: '#FFFFFF',
          headHeightRatio: [0.7, 0.8],
          eyeLineRatio: [0.4, 0.45],
        }),
        JSON.stringify([
          'bỏ lóa kính',
          'gọn tóc lòa xòa',
          'thẳng cổ áo',
          'nền trắng đều',
          'bỏ bụi/vết trên nền',
          'cân sáng hai bên mặt',
        ]),
      ],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM "photo_kinds" WHERE "code" = 'STUDENT_CARD'`);
  }
}
