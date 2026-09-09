import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * "Sinh viên dự kiến" campaign roster (2026-09-09, CCCD-scan capture-
 * identification feature) — see `CampaignStudentRoster` entity's own doc
 * comment. `(campaign_id, citizen_id)` unique: one CCCD number resolves to
 * at most one roster row per campaign.
 */
export class CampaignStudentRoster1802000000000
  implements MigrationInterface
{
  name = 'CampaignStudentRoster1802000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "campaign_student_roster" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "campaign_id" uuid NOT NULL,
        "student_code" character varying(100) NOT NULL,
        "student_name" character varying(255) NOT NULL,
        "citizen_id" character varying(20) NOT NULL,
        "class_name" character varying(100),
        "major" character varying(255),
        "academic_year" character varying(20),
        CONSTRAINT "PK_campaign_student_roster" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_campaign_student_roster_campaign_citizen" UNIQUE ("campaign_id", "citizen_id"),
        CONSTRAINT "FK_campaign_student_roster_campaign" FOREIGN KEY ("campaign_id")
          REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE NO ACTION
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_campaign_student_roster_created_at" ON "campaign_student_roster" ("created_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_campaign_student_roster_campaign_id" ON "campaign_student_roster" ("campaign_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "campaign_student_roster"`);
  }
}
