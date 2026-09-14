import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * RBAC foundation for `modules/identity` (docs/plans/backend-layering-plan.md
 * §7 Q11: "rbac của CMS 8 màn đặt ở modules/identity") and
 * docs/plans/cms-8-screens-api-plan.md §2.8/P1. Four tables:
 *
 * - `roles`: a named bundle of permissions. `is_system` marks the seeded
 *   `ADMIN`/`REVIEWER` rows — a system role's `code` cannot be changed by
 *   the CMS (enforced in the aggregate, not here).
 * - `permissions`: the catalog of `@RequirePermission(code)` decorators
 *   found on controllers at boot (`PermissionCatalogService`). This
 *   migration creates the table EMPTY — rows are upserted at application
 *   bootstrap, never hand-written into a migration, so adding a new
 *   permission is "add one decorator", not "write a migration" (plan §1.1
 *   E1/E4 in cms-8-screens-api-plan.md).
 * - `role_permissions`: many-to-many, no extra columns.
 * - `user_roles`: many-to-many between `users` (existing table) and
 *   `roles`, with a `granted_by_user_id` audit trail (no FK — same
 *   convention `campaign_members.decided_by_user_id` already uses, since
 *   "who granted this" is informational, not referentially enforced).
 *
 * Data migration at the end: any `users.roles` jsonb array containing
 * `"REVIEWER"` gets an equivalent `user_roles` row against the seeded
 * `REVIEWER` role, so `ReviewerRoleGuard` (which still reads
 * `users.roles` directly) and the new `PermissionsGuard` (which reads
 * `user_roles`) agree on the same people during the compatibility window
 * (cms-8-screens-api-plan.md §9.1 rule 3/4). `users.roles` itself is left
 * untouched — it is not dropped until `ReviewerRoleGuard` is retired.
 */
export class CreateRbac1809000000000 implements MigrationInterface {
  name = 'CreateRbac1809000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "roles" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "code" character varying(50) NOT NULL,
        "name" character varying(255) NOT NULL,
        "description" text,
        "is_system" boolean NOT NULL DEFAULT false,
        CONSTRAINT "PK_roles" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_roles_code" UNIQUE ("code")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_roles_created_at" ON "roles" ("created_at")`,
    );

    await queryRunner.query(`
      CREATE TABLE "permissions" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "code" character varying(100) NOT NULL,
        "group" character varying(50) NOT NULL,
        "method" character varying(10),
        "path" character varying(255),
        "description" text,
        CONSTRAINT "PK_permissions" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_permissions_code" UNIQUE ("code")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_permissions_created_at" ON "permissions" ("created_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_permissions_group" ON "permissions" ("group")`,
    );

    await queryRunner.query(`
      CREATE TABLE "role_permissions" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "role_id" uuid NOT NULL,
        "permission_id" uuid NOT NULL,
        CONSTRAINT "PK_role_permissions" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_role_permissions_role_permission" UNIQUE ("role_id", "permission_id"),
        CONSTRAINT "FK_role_permissions_role" FOREIGN KEY ("role_id")
          REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_role_permissions_permission" FOREIGN KEY ("permission_id")
          REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE NO ACTION
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_role_permissions_role_id" ON "role_permissions" ("role_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_role_permissions_permission_id" ON "role_permissions" ("permission_id")`,
    );

    await queryRunner.query(`
      CREATE TABLE "user_roles" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "user_id" uuid NOT NULL,
        "role_id" uuid NOT NULL,
        "granted_by_user_id" uuid,
        "granted_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_user_roles" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_user_roles_user_role" UNIQUE ("user_id", "role_id"),
        CONSTRAINT "FK_user_roles_user" FOREIGN KEY ("user_id")
          REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_user_roles_role" FOREIGN KEY ("role_id")
          REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE NO ACTION
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_user_roles_user_id" ON "user_roles" ("user_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_user_roles_role_id" ON "user_roles" ("role_id")`,
    );

    // Seed the roles named in cms-8-screens-api-plan.md §2.8. Only ADMIN and
    // REVIEWER are `is_system` (protected — matches the two roles that
    // already have real meaning today via `users.is_admin` / `users.roles`);
    // the other four are ordinary seeded rows the CMS can rename or delete.
    await queryRunner.query(`
      INSERT INTO "roles" ("code", "name", "description", "is_system") VALUES
        ('ADMIN', 'Quản trị viên', 'Toàn quyền — tương đương users.is_admin', true),
        ('REVIEWER', 'Duyệt ảnh', 'Duyệt ảnh AI — tương đương users.roles chứa REVIEWER', true),
        ('CTSV', 'Cán bộ tuyển sinh viên', 'Quản lý đợt chụp, duyệt thành viên', false),
        ('TRUYEN_THONG', 'Truyền thông', 'Duyệt ảnh, sửa AI, upload thay thế', false),
        ('HAU_CAN', 'Hậu cần', 'Vận hành kiosk, bổ sung sinh viên', false),
        ('IT_PRINT', 'IT in thẻ', 'Đợt in, phôi in, máy in', false)
    `);

    // Compatibility bridge (cms-8-screens-api-plan.md §9.1 rule 4): every
    // user whose `users.roles` jsonb already contains "REVIEWER" gets the
    // matching `user_roles` row now, so PermissionsGuard and
    // ReviewerRoleGuard see the same set of reviewers during this phase.
    await queryRunner.query(`
      INSERT INTO "user_roles" ("user_id", "role_id", "granted_at")
      SELECT u."id", r."id", now()
      FROM "users" u, "roles" r
      WHERE r."code" = 'REVIEWER'
        AND u."roles" @> '["REVIEWER"]'::jsonb
      ON CONFLICT ("user_id", "role_id") DO NOTHING
    `);

    // Same bridge for `is_admin` -> the ADMIN role, so the "Nguoi dung &
    // phan quyen" screen shows existing admins as members of ADMIN without
    // requiring a manual grant. `PermissionsGuard` itself still fast-paths
    // on `is_admin` directly (see permissions.guard.ts) - this row is for
    // listing/UI consistency, not the authorization path.
    await queryRunner.query(`
      INSERT INTO "user_roles" ("user_id", "role_id", "granted_at")
      SELECT u."id", r."id", now()
      FROM "users" u, "roles" r
      WHERE r."code" = 'ADMIN'
        AND u."is_admin" = true
      ON CONFLICT ("user_id", "role_id") DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "user_roles"`);
    await queryRunner.query(`DROP TABLE "role_permissions"`);
    await queryRunner.query(`DROP TABLE "permissions"`);
    await queryRunner.query(`DROP TABLE "roles"`);
  }
}
