import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { AppModule } from '../app.module';

/**
 * `pnpm --filter @face/api seed:role-permissions` — standalone CLI-style
 * script, NOT a TypeORM migration (2026-09-21 — was originally written as
 * migration `1833000000000-SeedDefaultRolePermissions.ts`, converted on
 * request: role→permission bundles are ops configuration an admin may want
 * to re-run or adjust, not a one-time schema change belonging in migration
 * history). Follows the same shape a sibling project's `permission dump`
 * CLI command uses (`NestFactory.createApplicationContext(AppModule)` +
 * `app.get(DataSource)` + raw SQL) — minus that project's `nestjs-console`
 * decorator layer, which this repo has no other use for and would add a
 * new dependency + a whole CLI module just to parse zero arguments.
 *
 * Booting the REAL `AppModule` (not a hand-rolled subset) matters for one
 * concrete reason: `PermissionCatalogService.onApplicationBootstrap()` —
 * already wired into `IdentityModule`, which `AppModule` imports — walks
 * every controller's `@RequirePermission(...)` decorator and upserts the
 * `permissions` catalog itself as part of ordinary app startup. Letting
 * that real bootstrap path run here means this script's own list of codes
 * below is checked against the SAME discovery Nest already does at every
 * normal boot, instead of a second, hand-maintained copy that could
 * silently drift the next time a route's decorator changes. `AppModule`
 * also runs `ScheduleModule.forRoot()` (registering every `@Cron()` in the
 * app) as a side effect of this — accepted here the same way the app's own
 * normal startup accepts it: those workers are already designed to be safe
 * no-ops when there is nothing queued.
 *
 * Lives under `src/` (not a sibling `apps/api/scripts/` dir) and is run
 * through `dist/`, NEVER through `ts-node` directly — confirmed live
 * 2026-09-21 why that distinction is load-bearing, not stylistic:
 * `TypeOrmConfigService.createTypeOrmOptions()` hardcodes
 * `entities: ['dist/modules/**\/*.entity.js']` (no dev/prod branch, unlike
 * `db.migrate.config.ts`). Running this file straight off `src/` via
 * `ts-node` still boots `AppModule` from source, but TypeORM's entity
 * metadata gets registered from the COMPILED `dist/*.entity.js` classes —
 * a different JS class identity than the source `.ts` classes
 * `IdentityModule`'s `TypeOrmModule.forFeature([...])` then tries to
 * register repositories for, so `PermissionCatalogService`'s very first
 * query threw `EntityMetadataNotFoundError: No metadata for
 * "PermissionEntity" was found` — the app never even reached this file's
 * own `main()`. Building first and running the compiled output (exactly
 * how `start:prod`/`node dist/main` already work) uses one consistent set
 * of class identities throughout, same as any other real boot.
 *
 * Also explicitly calls `process.exit()` at the end (success and failure)
 * rather than trusting the process to exit once `main()` resolves —
 * `ScheduleModule.forRoot()`'s registered timers (and any other long-lived
 * handle a full app boot opens) can keep the event loop alive well past
 * `app.close()`, confirmed live as an honest several-minute hang before
 * this was added; the DB work itself is already done by the time
 * `app.close()` runs, so forcing the exit here loses nothing.
 *
 * `1809000000000-CreateRbac.ts` seeded 6 roles but left `role_permissions`
 * completely EMPTY (its own comment: "This migration creates the table
 * EMPTY — rows are upserted at application bootstrap, never hand-written
 * into a migration" — that line is about the `permissions` CATALOG table,
 * not about who gets what; nothing ever populated the join table). The
 * practical effect: every non-system role (CTSV/TRUYEN_THONG/HAU_CAN/
 * IT_PRINT) is decorative today — `PermissionsGuard` fast-paths on
 * `users.is_admin` and otherwise checks `user_roles` → `role_permissions`
 * → `permissions`, and that last join has always returned nothing for any
 * role but ADMIN once ADMIN is manually granted every code below.
 *
 * Found live 2026-09-18 debugging "Cấp quyền" (`docs/plans/
 * 13-features-and-2-blockers-plan-2026-09-18.md` §1.2): a CTSV account got
 * `403 Thiếu quyền "user:read"` from the people-picker, and would have got
 * the exact same 403 from the grant call itself (`campaign-member.
 * controller.ts`'s `grantMembers` route is switched from `AdminRoleGuard` to
 * `PermissionsGuard` + `campaign:write` in this same change) — nobody but an
 * `is_admin` account could ever use the feature.
 *
 * Default bundle per role, matching each role's own Vietnamese description
 * from `1809000000000-CreateRbac.ts`:
 *   - ADMIN: every code that exists today (this row is informational only —
 *     `PermissionsGuard` already fast-paths `is_admin` before ever
 *     consulting `role_permissions`, same as that migration's own comment
 *     for the `is_admin`→ADMIN bridge).
 *   - CTSV ("Quản lý đợt chụp, duyệt thành viên"): campaign:write,
 *     campaign:delete, identification-method:write, and user:read (to
 *     search people in the "Cấp quyền" picker — "duyệt thành viên" is
 *     exactly this feature).
 *   - HAU_CAN ("Vận hành kiosk, bổ sung sinh viên"): campaign:write (roster
 *     import lives behind this code — device/kiosk management itself has no
 *     `@RequirePermission` anywhere yet, nothing to grant).
 *   - IT_PRINT ("Đợt in, phôi in, máy in"): every printer, print-batch,
 *     print-item and card-template code.
 *   - REVIEWER, TRUYEN_THONG: intentionally left with NO catalog grant.
 *     Photo review (`modules/photo-review`) has never adopted the
 *     `@RequirePermission` system — it is still gated entirely by the
 *     legacy `ReviewerRoleGuard` reading `users.roles` jsonb (plan §5.2's
 *     own finding). There is no `photo-review:*` code to grant them;
 *     inventing one here would be enforcing something no guard reads.
 *     Bringing photo-review into the permission catalog is listed as
 *     later, separate work in that same plan section.
 *
 * Fully idempotent (every write is `ON CONFLICT ... DO NOTHING`) — safe to
 * re-run any time, e.g. after a fresh dev DB reset or in a deploy step. A
 * code named below that no controller actually declares (typo, or a route
 * since removed) simply grants nothing for that code — `WHERE p.code = ANY(...)`
 * only ever matches rows the real catalog walk produced.
 */

const ROLE_CODES: Record<string, string[]> = {
  ADMIN: [
    'workflow:read',
    'workflow:write',
    'workflow:delete',
    'ai-pipeline-step:read',
    'ai-pipeline-step:write',
    'campaign:read',
    'campaign:write',
    'campaign:delete',
    'identification-method:write',
    'stats:rebuild',
    'user:read',
    'user:write',
    'role:read',
    'role:write',
    'role:delete',
    'permission:read',
    'printer:read',
    'printer:write',
    'print-batch:read',
    'print-batch:write',
    'print-item:read',
    'print-item:write',
    'card-template:read',
    'card-template:write',
    'card-template:delete',
  ],
  // `campaign:read` on every operational role below (not just ADMIN):
  // discovered live 2026-09-21, via the real catalog walk this script now
  // reuses, that it is NOT decorative — `MeController.getMyCampaigns`
  // (`GET /v1/me/campaigns`) requires it for any NON-admin to see their own
  // assigned campaigns at all (`me.controller.ts`'s own doc comment: "the
  // self-join/browse model is being retired in favor of admin-assigns-you
  // ... non-admins now need `campaign:read` granted AND an APPROVED
  // `campaign_members` row per campaign"). Omitting it would 403 every
  // non-admin CTSV/HAU_CAN/IT_PRINT user on the one screen they need to
  // start any work at all — caught only because this script asks the real
  // catalog what exists instead of a hand-typed list.
  CTSV: [
    'campaign:read',
    'campaign:write',
    'campaign:delete',
    'identification-method:write',
    'user:read',
  ],
  HAU_CAN: ['campaign:read', 'campaign:write'],
  IT_PRINT: [
    'campaign:read',
    'printer:read',
    'printer:write',
    'print-batch:read',
    'print-batch:write',
    'print-item:read',
    'print-item:write',
    'card-template:read',
    'card-template:write',
    'card-template:delete',
  ],
  // REVIEWER, TRUYEN_THONG: deliberately absent — see file doc comment.
};

async function main(): Promise<void> {
  // Booting the real app — the `Permission catalog: upserted N code(s)`
  // line from `PermissionCatalogService` on this next line IS the "make
  // sure every code below has a real permissions row" step; nothing else
  // in this script needs to do that work a second time.
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  try {
    const dataSource = app.get(DataSource);
    console.log('Granting default role permissions...');

    for (const [roleCode, codes] of Object.entries(ROLE_CODES)) {
      if (codes.length === 0) continue;
      // Plain rows array for an INSERT ... RETURNING via `DataSource.query()`
      // — verified live 2026-09-21, NOT the `[rows, affectedCount]` tuple
      // shape `EntityManager.query()` inside a transaction returns (see
      // `UploadWorkerService.claimNext`'s doc comment for that other case).
      // This codebase has hit "misread this shape" three times already
      // (P4/P6 stats + bulk-template counters); confirmed via a throwaway
      // debug run rather than assumed, to not make it a fourth.
      const inserted: Array<{ id: string }> = await dataSource.query(
        `INSERT INTO "role_permissions" ("role_id", "permission_id")
         SELECT r."id", p."id"
           FROM "roles" r, "permissions" p
          WHERE r."code" = $1
            AND p."code" = ANY($2)
         ON CONFLICT ("role_id", "permission_id") DO NOTHING
         RETURNING id`,
        [roleCode, codes],
      );
      console.log(
        `  ${roleCode}: ${codes.length} code(s) requested, ${inserted.length} new grant(s) inserted (rest already existed).`,
      );
    }

    console.log('Done.');
  } finally {
    await app.close();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('seed-default-role-permissions failed:', err);
    process.exit(1);
  });
