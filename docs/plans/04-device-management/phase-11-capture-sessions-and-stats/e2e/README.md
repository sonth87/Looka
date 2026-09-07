# Phase 11 D1 — API-level end-to-end verification

Verifies the kiosk-report contract, sessions/stats read side, fs-core
view-link path, and web capture path implemented in `apps/api` for
[phase-11-capture-sessions-and-stats](file:///Users/apple/Son/Work/DaiNam/camera-service/Looka/docs/plans/04-device-management/phase-11-capture-sessions-and-stats/implementation-plan.md).

## Files

- `mock-fs-core.mjs` — a dependency-free Node 22 `http` mock of the fs-core
  file-service (provision, direct upload, get/download/download-link,
  delete). Implements just enough of `packages/fs-client/src/FsClient.ts`'s
  contract for `apps/api` to run against unmodified.
- `run-e2e.sh` — the scenario script. Starts the mock and a built copy of
  `apps/api`, drives scenario steps a-k with curl + jq, asserts each one,
  and stops both processes on exit (via a `trap`, so it cleans up even on
  failure/Ctrl-C).
- `logs/` — created on each run: `run-e2e.log` (everything printed),
  `mock-fs-core.log`, `api.log`, `jest-final.log`, `build-final.log`, plus
  the last view-link download (`photo1-downloaded.bin`).
- `results.md` — narrative writeup of the last real run (command, expected,
  actual, PASS/FAIL, root causes for anything that failed).

## Prerequisites

- Postgres running locally, reachable with the credentials in
  `apps/api/.env`'s `DATABASE_URL` (dev DB, e.g. `looka`) and with
  `postgres://apple@localhost:5432/looka_phase11_test` for the test DB
  jest uses (adjust `TEST_DB` near the bottom of `run-e2e.sh` if your local
  test DB uses different credentials).
- The dev DB migrated to at least `CaptureRecords1787900000000`:
  ```bash
  cd /Users/apple/Son/Work/DaiNam/camera-service/Looka/apps/api
  pnpm typeorm:run-migrations
  ```
  (reads `DATABASE_URL` from `apps/api/.env` via `src/database/db.migrate.config.ts`).
- The test DB migrated the same way, with `TEST_DATABASE_URL` set to it.
- `apps/api/.env` present with `DATABASE_URL`, `API_KEY`, `FS_BASE_URL`
  (must be `http://localhost:8999` to match the mock), `FS_TENANT`,
  `PORT` (must be `3100`, or export `API_PORT` to override both).
- Ports 3100 and 8999 free (the script fails fast with a clear message if
  either the mock or `apps/api` don't come up).
- `node` (22+), `pnpm`, `psql`, `curl`, `jq`, `uuidgen`, `openssl`, `shasum`,
  `file` — all standard on this Mac.

## Run it

```bash
cd /private/tmp/claude-501/-Users-apple-Son-Work-DaiNam-camera-service/841e8936-78e8-4365-a23c-8118279a5997/scratchpad/phase11-e2e
./run-e2e.sh
```

Takes about a minute and a half (build ~10s, scenario ~25s including the
required sleeps, jest ~3s, final build ~10s). Exits 0 iff every assertion
passed. A one-line PASS/FAIL summary is printed at the end, followed by the
list of ids the run left behind in the dev DB.

Override the ports if 3100/8999 are in use for something else:
```bash
API_PORT=3101 MOCK_FS_PORT=8998 ./run-e2e.sh
```
(also update `apps/api/.env`'s `PORT`/`FS_BASE_URL` to match — the script
does not rewrite `.env` for you).

## What it does NOT touch

`apps/cms`, `apps/desktop`, `packages/*`, `docs/` — read-only at most,
never edited or built. No root-level `pnpm build`/`pnpm test`/`turbo` is
run; `pnpm build`/`pnpm test` are always invoked with `apps/api` as the
working directory, equivalent to `pnpm --filter @face/api <script>`. No
git command of any kind. Rows the script inserts (one campaign, one
device, one kiosk session, one web session, plus their photos/events) are
left in the dev DB — harmless, and re-running the script just adds a new
set of them under a fresh, timestamped campaign name
(`Phase11 D1 E2E <UTC timestamp>`), so old and new runs never collide.

## Design notes worth knowing before touching this again

- The device for step b is created with a **direct SQL insert**, not
  `POST /v1/campaigns/:id/devices` — that endpoint streams back a zip
  containing whatever `DESKTOP_INSTALLER_PATH_MAC`/`_WIN` point at, which in
  this repo are real ~240 MB `.dmg`s. The secret hash is computed with
  `shasum -a 256` over the raw plaintext (matches
  `device-secret.util.ts`'s `hashDeviceSecret` exactly: no salt, utf8 bytes).
- `apps/api` is **built once and run as `node dist/main.js`** (cwd =
  `apps/api`, so `dotenv/config` finds `apps/api/.env`) rather than via
  `pnpm start:dev`. `start:dev`'s process tree (pnpm -> nest -> webpack/node)
  does not tear down reliably from a PID captured with bash's `$!` — the
  child that actually binds the port survives a kill of the top-level pnpm
  process. A plain `node dist/main.js` is one PID. The script also sweeps by
  `lsof -iTCP:<port>` on exit as a second line of defense.
- **`psql -c` does not perform `:'var'` interpolation** in this environment
  (confirmed: works via `-f`/stdin, not `-c` — a psql quirk worth
  remembering, not an apps/api bug). The one SQL statement in the script
  that needs script-controlled values (the device insert) interpolates them
  directly into the SQL text via bash instead; safe here because every value
  is a UUID or hex string the script itself generated, never external input.
- **`psql -t -A` prints an INSERT/UPDATE/DELETE's command tag (e.g.
  `INSERT 0 1`) on its own line even under `-t -A`**, RETURNING or not — only
  a plain `SELECT`'s row-count footer is what `-t` actually suppresses. The
  helpers pipe through `head -1` to keep just the returned value.
- The kiosk's F1 upload (step e) goes through the mock directly (provision +
  `POST /api/v1/files`, exactly as `apps/desktop`'s real upload path would),
  so `POST /v1/photos/:id/view-link` in step h has a real file on the mock
  to resolve — not just a made-up id sitting in Postgres.
- The mock remembers upload **metadata**, not bytes: `GET .../download`
  always returns the same embedded 1x1 PNG regardless of what was actually
  posted, per the task's "generate bytes in code" instruction.

## Re-running just the mock, standalone

```bash
node mock-fs-core.mjs 8999
# in another shell:
curl -s http://localhost:8999/healthz
```
`MOCK_FS_READY_DELAY_MS` (default 2000) controls how long an uploaded file
stays `SCANNING` before flipping to `READY`.
