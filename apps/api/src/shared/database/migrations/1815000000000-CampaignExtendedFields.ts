import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * P3 — cms-8-screens-api-plan.md §5 phase table: "Phân trang/lọc campaigns,
 * processing_sla_hours, location, roster import (xlsx, job nền, file lỗi),
 * lookup tại kiosk, campaign_kiosk_assignments,
 * sessions.identification_method/identified_at/finished_at, byTrigger."
 *
 * Five schema changes in one migration (kept together — they're all part of
 * one phase, same convention `1809000000000-CreateRbac.ts` used for its own
 * 4 related tables):
 *
 * 1. `campaigns.processing_sla_hours` / `campaigns.location` — §2.1/§2.3.
 * 2. `campaign_kiosk_assignments` — D-Q4, 1 person ↔ 1 kiosk per campaign.
 * 3. `campaign_subject_imports` + `campaign_subjects` — D-Q3, recreates the
 *    roster dropped by migration `1804000000000`. Only a `VALID` row is
 *    unique per `(campaign_id, subject_code)` — a partial unique index, so a
 *    re-upload of the same student lands as `DUPLICATE` instead of erroring.
 * 4. `identification_methods` — E1 catalog, seeded with 7 rows (6 from the
 *    plan's own list + `OCR_CCCD`, added per §9.2's kiosk-impact review: the
 *    desktop kiosk today OCRs the CCCD's front face, it does not scan a QR).
 * 5. `sessions.identification_method/identified_at/finished_at` — §2.1/§2.2.
 */
export class CampaignExtendedFields1815000000000 implements MigrationInterface {
  name = 'CampaignExtendedFields1815000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "campaigns"
        ADD COLUMN "processing_sla_hours" integer,
        ADD COLUMN "location" character varying(255)
    `);

    await queryRunner.query(`
      CREATE TABLE "campaign_kiosk_assignments" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "campaign_id" uuid NOT NULL,
        "device_id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "assigned_by_user_id" uuid,
        "assigned_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "note" text,
        CONSTRAINT "PK_campaign_kiosk_assignments" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_campaign_kiosk_assignments_campaign_device" UNIQUE ("campaign_id", "device_id"),
        CONSTRAINT "UQ_campaign_kiosk_assignments_campaign_user" UNIQUE ("campaign_id", "user_id"),
        CONSTRAINT "FK_campaign_kiosk_assignments_campaign" FOREIGN KEY ("campaign_id")
          REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_campaign_kiosk_assignments_device" FOREIGN KEY ("device_id")
          REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE NO ACTION
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_campaign_kiosk_assignments_campaign_id" ON "campaign_kiosk_assignments" ("campaign_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_campaign_kiosk_assignments_device_id" ON "campaign_kiosk_assignments" ("device_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_campaign_kiosk_assignments_user_id" ON "campaign_kiosk_assignments" ("user_id")`,
    );

    await queryRunner.query(`
      CREATE TABLE "campaign_subject_imports" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "campaign_id" uuid NOT NULL,
        "file_name" character varying(255) NOT NULL,
        "fs_file_id" character varying(255),
        "uploaded_by_user_id" uuid,
        "status" character varying(10) NOT NULL DEFAULT 'PROCESSING',
        "total_rows" integer NOT NULL DEFAULT 0,
        "valid_rows" integer NOT NULL DEFAULT 0,
        "error_rows" integer NOT NULL DEFAULT 0,
        "error_report_fs_file_id" character varying(255),
        "failure_reason" text,
        CONSTRAINT "PK_campaign_subject_imports" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_campaign_subject_imports_status" CHECK ("status" IN ('PROCESSING', 'DONE', 'FAILED')),
        CONSTRAINT "FK_campaign_subject_imports_campaign" FOREIGN KEY ("campaign_id")
          REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE NO ACTION
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_campaign_subject_imports_campaign_id" ON "campaign_subject_imports" ("campaign_id")`,
    );

    await queryRunner.query(`
      CREATE TABLE "campaign_subjects" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "campaign_id" uuid NOT NULL,
        "import_id" uuid NOT NULL,
        "row_no" integer NOT NULL,
        "subject_code" character varying(100) NOT NULL,
        "full_name" character varying(255) NOT NULL,
        "citizen_id" character varying(20),
        "class_name" character varying(100),
        "faculty" character varying(255),
        "major" character varying(255),
        "date_of_birth" date,
        "card_valid_until" date,
        "status" character varying(10) NOT NULL,
        "error_message" text,
        "extra" jsonb,
        CONSTRAINT "PK_campaign_subjects" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_campaign_subjects_status" CHECK ("status" IN ('VALID', 'ERROR', 'DUPLICATE')),
        CONSTRAINT "FK_campaign_subjects_campaign" FOREIGN KEY ("campaign_id")
          REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_campaign_subjects_import" FOREIGN KEY ("import_id")
          REFERENCES "campaign_subject_imports"("id") ON DELETE CASCADE ON UPDATE NO ACTION
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_campaign_subjects_campaign_id" ON "campaign_subjects" ("campaign_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_campaign_subjects_import_id" ON "campaign_subjects" ("import_id")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_campaign_subjects_campaign_code_valid" ON "campaign_subjects" ("campaign_id", "subject_code") WHERE "status" = 'VALID'`,
    );

    await queryRunner.query(`
      CREATE TABLE "identification_methods" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "code" character varying(30) NOT NULL,
        "name_vi" character varying(255) NOT NULL,
        "description" text,
        "requires_hardware" boolean NOT NULL DEFAULT false,
        "active" boolean NOT NULL DEFAULT true,
        "sort_order" integer NOT NULL DEFAULT 0,
        CONSTRAINT "PK_identification_methods" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_identification_methods_code" UNIQUE ("code")
      )
    `);
    await queryRunner.query(`
      INSERT INTO "identification_methods"
        ("code", "name_vi", "description", "requires_hardware", "sort_order") VALUES
        ('QR_CCCD', 'Quét QR mặt sau CCCD', 'Đọc 12 số từ QR ở mặt sau căn cước công dân', true, 10),
        ('OCR_CCCD', 'Nhận diện mặt trước CCCD (OCR)', 'Kiosk hiện đang dùng cách này — đọc chữ ở mặt trước, kém tin cậy hơn QR', true, 20),
        ('RFID', 'Thẻ RFID', 'Cần đầu đọc RFID gắn kèm kiosk', true, 30),
        ('NFC', 'Thẻ NFC', 'Cần đầu đọc NFC gắn kèm kiosk', true, 40),
        ('BARCODE', 'Mã vạch', 'Quét mã vạch thẻ sinh viên', true, 50),
        ('FACE_ID', 'Nhận diện khuôn mặt', 'Sidecar embedding hiện là mock — chưa dùng cho định danh thật', true, 60),
        ('MANUAL_LOOKUP', 'Tra cứu thủ công', 'Cán bộ nhập tay mã sinh viên', false, 70)
    `);

    await queryRunner.query(`
      ALTER TABLE "sessions"
        ADD COLUMN "identification_method" character varying(30),
        ADD COLUMN "identified_at" TIMESTAMP WITH TIME ZONE,
        ADD COLUMN "finished_at" TIMESTAMP WITH TIME ZONE
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "sessions"
        DROP COLUMN "finished_at",
        DROP COLUMN "identified_at",
        DROP COLUMN "identification_method"
    `);
    await queryRunner.query(`DROP TABLE "identification_methods"`);
    await queryRunner.query(`DROP TABLE "campaign_subjects"`);
    await queryRunner.query(`DROP TABLE "campaign_subject_imports"`);
    await queryRunner.query(`DROP TABLE "campaign_kiosk_assignments"`);
    await queryRunner.query(`
      ALTER TABLE "campaigns"
        DROP COLUMN "location",
        DROP COLUMN "processing_sla_hours"
    `);
  }
}
