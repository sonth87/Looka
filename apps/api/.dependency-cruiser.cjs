/**
 * Architecture dependency gate (plan §9). Most rules here are "ready, not
 * yet triggering" — Phase 0 only builds `shared/`; no module has its own
 * `domain/`/`application/`/`infrastructure/`/`presentation/` split yet
 * (that starts with `campaign` in Phase 1). The rules stay at `warn` for
 * all of Phase 0 (plan §6: "cổng lint ở mức warn, để thấy vi phạm hiện có
 * mà chưa chặn build") and tighten to `error` module-by-module as each one
 * migrates (plan §9's own table) — do not flip this whole file to `error`
 * in one step, or every un-migrated module fails at once.
 *
 * Run with `pnpm lint:arch` (added to package.json). Not yet wired into
 * `pnpm build` or CI — that wiring is a Phase 5 item (plan §9), once
 * enough of the codebase has actually migrated that failing loudly is
 * useful signal rather than permanent noise.
 */
module.exports = {
  forbidden: [
    {
      name: 'shared-no-modules',
      severity: 'warn',
      comment:
        'shared/** must not import modules/** (plan §4.7, §8 ban list). ' +
        'Known, documented exception: shared/auth/sso-auth.guard.ts still ' +
        'imports the User entity from modules/shared — identity extraction ' +
        'is Phase 3 scope (plan §6), not fixed here.',
      from: { path: '^src/shared' },
      to: { path: '^src/modules' },
    },
    {
      name: 'domain-no-framework',
      severity: 'warn',
      comment:
        'A module domain/aggregate never imports typeorm, @nestjs/*, ' +
        'shared/database, or shared/integrations (plan §4.3, §8 #3). ' +
        'Matches zero files until a module gets a domain/ folder (Phase 1+).',
      from: { path: '^src/modules/[^/]+/domain' },
      to: {
        path: [
          '^node_modules/typeorm',
          '^node_modules/@nestjs',
          '^src/shared/database',
          '^src/shared/integrations',
        ],
      },
    },
    {
      name: 'application-presentation-no-typeorm',
      severity: 'warn',
      comment:
        'application/ and presentation/ never import typeorm directly — ' +
        'only infrastructure/ (via repositories/read-repositories) does ' +
        '(plan §4.2, §7 Q7). Matches zero files until a module has these ' +
        'folders (Phase 1+).',
      from: { path: '^src/modules/[^/]+/(application|presentation)' },
      to: { path: '^node_modules/typeorm' },
    },
    {
      name: 'application-no-other-module-infrastructure',
      severity: 'warn',
      comment:
        'A module must not import another module\'s infrastructure/ or ' +
        '*.service.ts directly — cross-module reads go through QueryBus, ' +
        'writes through CommandBus (plan §8 #1, §9 last row). This is the ' +
        'exact shape of the device-self.controller.ts → capture services ' +
        'coupling the plan calls out (§2 row 9) — not yet cut, so this ' +
        'rule already has real violations today and stays at warn until ' +
        'that cut happens (Phase 2).',
      from: { path: '^src/modules/([^/]+)/' },
      to: {
        path: '^src/modules/([^/]+)/(infrastructure|services)',
        pathNot: '^src/modules/$1/',
      },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsConfig: { fileName: 'tsconfig.json' },
    tsPreCompilationDeps: true,
    exclude: { path: '\\.spec\\.ts$' },
  },
};
