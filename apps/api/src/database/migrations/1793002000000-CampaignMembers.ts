import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Per-campaign approval table (§2.3/§3.2.2) — depends on both `campaigns`
 * and `users` (the latter created ahead of this in
 * `1791000000000-CreateUsers.ts` specifically so this table wouldn't race
 * it). `(campaign_id, user_id)` unique: a person has at most one membership
 * row per campaign.
 */
export class CampaignMembers1793002000000 implements MigrationInterface {
  name = 'CampaignMembers1793002000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "campaign_members" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "campaign_id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "status" character varying(10) NOT NULL,
        "requested_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "decided_at" TIMESTAMP WITH TIME ZONE,
        "decided_by_user_id" uuid,
        "note" text,
        CONSTRAINT "PK_campaign_members" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_campaign_members_campaign_user" UNIQUE ("campaign_id", "user_id"),
        CONSTRAINT "FK_campaign_members_campaign" FOREIGN KEY ("campaign_id")
          REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_campaign_members_user" FOREIGN KEY ("user_id")
          REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "CHK_campaign_members_status"
          CHECK ("status" IN ('PENDING', 'APPROVED', 'REJECTED', 'REVOKED'))
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_campaign_members_created_at" ON "campaign_members" ("created_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_campaign_members_campaign_id" ON "campaign_members" ("campaign_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_campaign_members_user_id" ON "campaign_members" ("user_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "campaign_members"`);
  }
}
