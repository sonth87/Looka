# Phase 11 D1 — end-to-end verification results

Run: 2026-09-06, ~03:04:42–03:05:03 UTC (10:04–10:05 Asia/Ho_Chi_Minh).
Command: `./run-e2e.sh` (third attempt — see "Issues found and fixed" for
the first two). Full raw output: `logs/run-e2e.log`. Exit code: `0`
(23/23 assertions passed).

Environment: Postgres 14 local, dev DB `looka` (migrated through
`CaptureRecords1787900000000` by this run — see below), mock fs-core on
`:8999`, `apps/api` built and run as `node dist/main.js` on `:3100`.
`apps/api/.env`'s `FS_API_KEY` is empty, so `FileStorageService` self-
provisioned its default tenant (`looka-face-capture`) at boot — visible as
the first `PROVISIONED` line in the mock log below.

## 1. Scenario steps a–k

| Step | Assertion | Result | Key actual values |
|---|---|---|---|
| a | `POST /v1/campaigns` (admin key) creates a campaign | PASS | `201`, id `2f2426f4-a6ad-4c85-998e-15ecd696bcd6` |
| b | Device row inserted directly (known secret, hash via `device-secret.util.ts`'s algorithm); `GET /v1/devices/config` with `x-device-id`/`x-device-secret` | PASS | `200`, returned campaign id matches |
| c | `POST /v1/devices/events` batch with one `SESSION_REPORT` (session S1, CENTER/step-front attempt 2 + LEFT/step-left attempt 1, `localStatus: PENDING`) | PASS | `202 {"accepted":1}` |
| d | `GET /v1/sessions?campaignId=…` → 1 item, `photoCount 2`, `photosPending 2`, `deviceName` set; `GET /v1/sessions/S1` → 2 photos with `stepType`/`cameraRole`/`attempt` | PASS | `items=1 photoCount=2 photosPending=2 deviceName=phase11-e2e-kiosk`; detail has both photos with all three fields |
| e | `PHOTO_STATUS`: photo1 `uploaded` (F1, `SCANNING`) → `ready` (`READY`); photo2 `failed` (`FAILED_PERMANENT`, quota error) → list `photosReady 1`/`photosFailed 1`; detail shows `fsFileId`/`readyAt`/`uploadError` | PASS | `photosReady=1 photosFailed=1`; photo1 `fsFileId=d0f9688d-…`, `readyAt=2026-09-06T03:04:53.000Z`; photo2 `uploadError` contains `QUOTA_EXCEEDED` |
| f | Idempotency: resend identical `SESSION_REPORT` + a stale `PHOTO_STATUS` (earlier `at`, `SCANNING`) for photo1 | PASS | `202 {"accepted":2}`; still 1 session under the campaign; photo1 `fsStatus` still `READY` (not regressed to `SCANNING`) |
| g | `GET /v1/campaigns/:id/stats` → `sessions 1`, `photos{total 2,ready 1,pending 0,failed 1}`, `byDevice`/`byDay` populated; `GET /v1/campaigns/stats/summary` → totals ≥ scenario values, old counters present | PASS | stats exactly as expected (see JSON below); summary `totalSessions=1 totalPhotos.total=2`, `totalSessionsCompleted`/`totalUploadSuccess`/`totalUploadFailed`/`totalRetakes` fields present (0, since no old-style counter events were sent) |
| h | View-link: photo1 → `{url, expiresAt}`, mock log shows per-device provision + `X-Viewer-ID`; `curl` the url → 200 image bytes. Photo2 (no `fsFileId`) → 503 | PASS | `201 {"url":"http://localhost:8999/api/v1/files/d0f9688d-…/download?token=…","expiresAt":"2026-09-06T03:14:54.095Z"}`; curl → `HTTP 200`, 68 bytes, valid PNG; photo2 → `503 {"errorCode":3000,"message":"This photo has not reached the file-service yet"}` |
| i | Web path: 2 attempts staged unapproved (worker doesn't touch them for 5 s) → `complete` keeps only attempt 2, approves its outbox row, worker uploads it once, `fsStatus` reaches `READY`; second `complete` is a no-op | PASS (all 6 sub-checks) | 2 unapproved outbox rows pre-complete → after complete: 1 photo (attempt 2), 1 approved outbox row, exactly 1 `UPLOADED` line in the mock log, `fsStatus=READY` within ~6 s; second complete: still 1 photo, `200`-family response |
| j | Malformed `SESSION_REPORT` (no `photos`) → 400 with documented code; wrong device credentials → 401 | PASS | `400 {"errorCode":1002,"message":"SESSION_REPORT payload invalid: photos must be an array"}`; `401 {"errorCode":401,"message":"Device credential check failed: INVALID_SECRET"}` |
| k | `TEST_DATABASE_URL=postgres://apple@localhost:5432/looka_phase11_test pnpm --filter @face/api test`; `pnpm --filter @face/api build` | PASS | `Test Suites: 4 passed, 4 total` / `Tests: 42 passed, 42 total`; build exits 0 |

**Total: 23/23 checks PASS, 0 FAIL.**

## 2. Bugs found

**None in `apps/api`.** Every one of the 23 checks above passed against the
implementation as it stands in the working tree — no code under `apps/api`
was changed.

Two bugs were found and fixed **in this verification harness itself**
(`run-e2e.sh`), both purely mechanical `psql` quoting/output issues, not
application bugs:

1. **`psql -c` does not interpolate `:'var'`-style variables** in this
   environment (verified: works via `-f`/stdin, silently produces a plain
   SQL syntax error via `-c`). The device-insert statement was written with
   `-v camp=… -c "... VALUES (:'camp', …)"` and failed with
   `ERROR: syntax error at or near ":"` every time, so no device secret hash
   ever reached the DB and every downstream step correctly got `401`
   (`x-device-id and x-device-secret are both required` — the guard was
   doing exactly the right thing with what it was given). Fixed by
   interpolating the values directly into the SQL text via bash instead
   (safe here: every value is a script-generated UUID or hex string with no
   quote characters).
2. **`psql -t -A` still prints an INSERT/UPDATE/DELETE's command completion
   tag (e.g. `INSERT 0 1`) on its own line**, `RETURNING` or not — only a
   `SELECT`'s row-count footer is what `-t` suppresses. The device-id
   capture piped through `tr -d '[:space:]'`, which merged the returned
   UUID with the following `INSERT 0 1` tag into one string
   (`4de88693-…INSERT01`), an invalid id that made every subsequent
   `x-device-id` header wrong (masked as generic `500`s once step 1 above
   was fixed, since the malformed header still parsed as *a* string, just
   not a UUID the DB could find). Fixed by piping through `head -1` before
   stripping whitespace, in both the device-insert capture and the
   `psql_scalar` helper (defensive; every other use of it is a plain
   `SELECT`, which was never actually affected).

Both fixes are in `run-e2e.sh` (see its `psql_scalar`/`psql_run` helpers and
the step-b device insert); no test was "added" for them since they are
shell-script bugs in the harness, not product code — the existing jest
suite and this scenario script's own 23 assertions are the regression
coverage. Two intermediate broken runs left 2 orphaned campaigns, 1 device,
and 2 web sessions in the dev `looka` DB; these were deleted (verified 0
rows remaining matching their names) before the final successful run below,
so only the row set in §3 remains.

## 3. Real output for the notable steps

### Step g — campaign stats (`GET /v1/campaigns/2f2426f4-.../stats`)

```json
{"campaignId":"2f2426f4-a6ad-4c85-998e-15ecd696bcd6","deviceCount":1,"sessionsCompleted":0,"uploadSuccess":0,"uploadFailed":0,"retakes":0,"cbHelpInterventions":0,"sessions":1,"photos":{"total":2,"ready":1,"pending":0,"failed":1},"byDevice":[{"deviceId":"e8656d2d-ea48-4987-9dc5-5a3914fae106","deviceName":"phase11-e2e-kiosk","sessions":1,"photosReady":1,"photosFailed":1,"lastCaptureAt":"2026-09-06T03:04:49.000Z"}],"byDay":[{"date":"2026-09-06","sessions":1,"photos":2}]}
```

### Step h — mock log excerpt (provision with `tenant_name` = device id, viewer id on the download-link call)

```
[mock-fs-core] 2026-09-06T03:04:50.978Z POST /api/v1/self-service/provision X-API-Key=(none)
[mock-fs-core] 2026-09-06T03:04:50.978Z   PROVISIONED tenant_name="e8656d2d-ea48-4987-9dc5-5a3914fae106" -> api_key=fsc_mock_e8656d2d-ea48-4987-9dc5-5a3914fae106 namespace=/apps/e8656d2d-ea48-4987-9dc5-5a3914fae106
[mock-fs-core] 2026-09-06T03:04:51.003Z POST /api/v1/files X-API-Key=fsc_mock_e86...
[mock-fs-core] 2026-09-06T03:04:51.004Z   UPLOADED file_id=d0f9688d-dc55-4f45-a5fd-7d7ae1851e52 virtual_path="face/2026/665201fd-b43a-4cc3-8f7a-055f659c147b/step-front-2.jpg" size=30 visibility=private sha256=ffee638972ef...
[mock-fs-core] 2026-09-06T03:04:53.006Z   file_id=d0f9688d-dc55-4f45-a5fd-7d7ae1851e52 scan complete -> READY
[mock-fs-core] 2026-09-06T03:04:54.089Z POST /api/v1/self-service/provision X-API-Key=(none)
[mock-fs-core] 2026-09-06T03:04:54.090Z   provision replay for tenant_name="e8656d2d-ea48-4987-9dc5-5a3914fae106" -> api_key=fsc_mock_e8656d2d-ea48-4987-9dc5-5a3914fae106
[mock-fs-core] 2026-09-06T03:04:54.093Z GET /api/v1/files/d0f9688d-dc55-4f45-a5fd-7d7ae1851e52 X-API-Key=fsc_mock_e86...
[mock-fs-core] 2026-09-06T03:04:54.095Z POST /api/v1/files/d0f9688d-dc55-4f45-a5fd-7d7ae1851e52/download-link?ttl_seconds=600&allow_download=true X-API-Key=fsc_mock_e86... X-Viewer-ID=cms-admin
[mock-fs-core] 2026-09-06T03:04:54.095Z   download-link file_id=d0f9688d-dc55-4f45-a5fd-7d7ae1851e52 viewer=cms-admin ttl_seconds=600
[mock-fs-core] 2026-09-06T03:04:54.135Z GET /api/v1/files/d0f9688d-dc55-4f45-a5fd-7d7ae1851e52/download?token=dff80666a4b58763d71a10801b149d39 X-API-Key=(none)
```

The first `PROVISIONED` call is the "kiosk" (the test script, acting as one)
provisioning its own tenant to upload F1 directly to the mock, exactly as
`apps/desktop`'s real upload path would. The `provision replay` line 3.1s
later is `apps/api`'s own `FileStorageService.clientForTenant()` call
during the `view-link` request — same tenant name (the device id), same
key returned both times, confirming the idempotent-provisioning design (D4
in the implementation plan) actually round-trips end to end. The
`X-API-Key` prefix (`fsc_mock_e86...`) on the `GET`/`download-link` calls
is the same per-device key both times, never the default tenant's key.

`curl` of the returned url: `HTTP 200`, 68 bytes, `file` reports
`PNG image data, 1 x 1, 8-bit gray+alpha, non-interlaced` (the mock's fixed
stand-in image bytes, per the brief's "generate bytes in code" instruction —
the mock remembers upload metadata, not content).

### Step i — web path timing (worker cron ticks every 3s, mock scan delay 2s)

- Before `complete`: 2 `upload_outbox` rows, both `approved_at IS NULL`; 5 s
  of watching `logs/mock-fs-core.log` shows no `UPLOADED` line for this
  session.
- After `complete` (`201`, `status: COMPLETED`): exactly 1 `photos` row
  left (`attempt=2`), exactly 1 approved `upload_outbox` row.
- Within ~6 s: `GET /v1/sessions/:id/photos` shows `fsFileId` set; within
  ~8 s more, `fsStatus` reaches `READY`; mock log shows exactly 1 `UPLOADED`
  line for `sessions/<id>/FRONT-2.jpg`.
- Second `complete` call: `201`, still exactly 1 photo row (no error, no
  further deletion — the no-op path in `SessionService.completeSession`'s
  `if (session.status !== SessionStatus.COMPLETED)` guard).

## 4. Ids created (dev `looka` DB, left in place per instructions)

| What | Id |
|---|---|
| Campaign | `2f2426f4-a6ad-4c85-998e-15ecd696bcd6` (name `Phase11 D1 E2E 20260906T030449Z`) |
| Device | `e8656d2d-ea48-4987-9dc5-5a3914fae106` (name `phase11-e2e-kiosk`) |
| Kiosk session (S1) | `665201fd-b43a-4cc3-8f7a-055f659c147b` (2 photos: `1044c19a-…` step-front/CENTER attempt 2, `522a2c64-…` step-left/LEFT attempt 1) |
| Web session | `a4474cd7-5f89-42ee-beca-ed012318fe24` (1 surviving photo, `75108c26-…` on the mock) |

Two earlier failed dry-run attempts (before the harness bugs above were
fixed) also created a campaign/device/web-session each; those were deleted
after diagnosis, before the run recorded here, and are not left behind.

## 5. Housekeeping performed

- Dev DB (`looka`) migrated: `AddRecordVideo1787800000000` and
  `CaptureRecords1787900000000` were pending and are now applied (the test
  DB `looka_phase11_test` already had both).
- `apps/api` was built (`pnpm build`, cwd `apps/api`) and run as
  `node dist/main.js` on port 3100; both the mock (`:8999`) and the API
  were stopped at the end of the run — confirmed via
  `lsof -nP -iTCP:3100 -sTCP:LISTEN` / `-iTCP:8999` returning nothing, and
  `ps aux | grep -E "dist/main.js|mock-fs-core.mjs"` finding no process.
- No file outside `apps/api` (build output) and this scratchpad directory
  was written. `apps/cms`, `apps/desktop`, `packages/*`, `docs/` untouched.
  No git command was run.

## 6. Not verified / out of scope

- **Chunked upload** (`X-Upload-ID`/`Content-Range`, files > 10 MiB) is not
  exercised — every test photo is a few dozen bytes, well under the direct-
  upload ceiling, and the mock does not implement the chunked path (noted
  in its own header comment). `FsClient.uploadChunked`/`probeOffset` are
  therefore unverified by this run.
- **`DELETE /api/v1/files/:id`** (fs-core file delete) is implemented in the
  mock but never actually called in this scenario: the only place `apps/api`
  calls it is `SessionService.completeSession`'s best-effort cleanup of a
  superseded attempt that had *already* reached the file-service before
  completion — which cannot happen on the web path here, since the upload
  worker never sends an unapproved row and `complete()` deletes the
  superseded photo row (and, via cascade, its outbox row) before the worker
  could ever have raced it. Confirmed by design reading of
  `session.service.ts`, not by an observed call.
- **Real fs-core** (SeaweedFS, ClamAV, actual quota/dedup behaviour) is
  obviously not exercised — this is a mock standing in for its HTTP
  contract only, per the brief.
- **CMS UI** (`SessionsPanel`, `SessionDetailDrawer`, etc., Phase C) is out
  of scope for this API-level pass and was not touched or run.
- Did not test multiple API replicas draining the same `upload_outbox`
  concurrently (`FOR UPDATE SKIP LOCKED`) — only one `apps/api` process was
  ever running.
