import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds "Phòng ban"/"Khoa" to the manual "thêm người dùng" form (same screen
 * `1810000000000-UsersProfileFields.ts` added `title`/`code`/`phone` for) —
 * plain nullable `varchar`, no catalog/FK: same "free text, not a lookup
 * table" choice already made for `campaign_subjects.class_name`/`faculty`,
 * since there is no `department`/`faculty` catalog anywhere in this app to
 * reference.
 */
export class UsersDepartmentFaculty1836000000000 implements MigrationInterface {
  name = 'UsersDepartmentFaculty1836000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
        ADD COLUMN "department" character varying(255),
        ADD COLUMN "faculty" character varying(255)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
        DROP COLUMN "faculty",
        DROP COLUMN "department"
    `);
  }
}
