import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The dynamic capture-angle catalog table (§3.1.6) + seed of the 5 original
 * hardcoded angles as `is_system = true` rows — exact pose values copied
 * from `apps/cms/src/captureAngles.ts`'s `CAPTURE_STEP_DEFS` (FRONT yaw/
 * pitch/roll 0±12, LEFT yaw -22.5±7.5, RIGHT yaw 22.5±7.5, UP pitch 25±10,
 * DOWN pitch -25±10) so a campaign created against this catalog before this
 * pass produces identical steps to the old hardcoded toggle.
 */
export class CaptureAnglePresets1793001000000 implements MigrationInterface {
  name = 'CaptureAnglePresets1793001000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "capture_angle_presets" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "code" character varying(50) NOT NULL,
        "label_vi" character varying(255) NOT NULL,
        "instruction_vi" text NOT NULL,
        "pose_default" jsonb NOT NULL,
        "preferred_camera_role" character varying(10) NOT NULL,
        "is_system" boolean NOT NULL DEFAULT false,
        "active" boolean NOT NULL DEFAULT true,
        "sort_order" integer NOT NULL DEFAULT 0,
        CONSTRAINT "PK_capture_angle_presets" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_capture_angle_presets_code" UNIQUE ("code"),
        CONSTRAINT "CHK_capture_angle_presets_camera_role"
          CHECK ("preferred_camera_role" IN ('CENTER', 'LEFT', 'RIGHT', 'UP', 'DOWN'))
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_capture_angle_presets_created_at" ON "capture_angle_presets" ("created_at")`,
    );

    await queryRunner.query(`
      INSERT INTO "capture_angle_presets"
        ("code", "label_vi", "instruction_vi", "pose_default", "preferred_camera_role", "is_system", "active", "sort_order")
      VALUES
        (
          'FRONT', 'Thẳng', 'Nhìn thẳng vào camera',
          '{"yaw":{"target":0,"tolerance":12},"pitch":{"target":0,"tolerance":12},"roll":{"target":0,"tolerance":12}}'::jsonb,
          'CENTER', true, true, 0
        ),
        (
          'LEFT_30', 'Trái', 'Quay mặt sang trái (15° - 30°)',
          '{"yaw":{"target":-22.5,"tolerance":7.5}}'::jsonb,
          'LEFT', true, true, 1
        ),
        (
          'RIGHT_30', 'Phải', 'Quay mặt sang phải (15° - 30°)',
          '{"yaw":{"target":22.5,"tolerance":7.5}}'::jsonb,
          'RIGHT', true, true, 2
        ),
        (
          'UP', 'Trên', 'Ngẩng đầu lên (15° - 35°)',
          '{"pitch":{"target":25,"tolerance":10}}'::jsonb,
          'UP', true, true, 3
        ),
        (
          'DOWN', 'Dưới', 'Cúi đầu xuống (15° - 35°)',
          '{"pitch":{"target":-25,"tolerance":10}}'::jsonb,
          'DOWN', true, true, 4
        )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "capture_angle_presets"`);
  }
}
