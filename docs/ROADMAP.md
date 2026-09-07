# Looka Platform — Roadmap & Status Tracker

> Consolidated on 2026-08-30 from three sources: `FIX-PLAN.md` (re-verified
> against the current code, not just its original 2026-08-13 snapshot),
> `plans/multi-camera-device-management-discussion.md` (new feature backlog,
> not yet an implementation plan), and gaps surfaced while cross-checking the
> two. Update this file as work lands — the whole point is not to go stale
> the way the original FIX-PLAN snapshot did (it credited far less progress
> than the code actually has, two weeks in).

**Legend:** ✅ Done · 🟡 Partial · ❌ Not done · ⚠️ Done but unused (code
complete and tested, but nothing in `apps/desktop`/`apps/web` calls it yet)

---

## 1. FIX-PLAN re-verification (code as of commit `a29c3b3`, 2026-08-30)

Re-checked file-by-file against the current repo; the original doc only
marked step 1 explicitly. **Net result: 12 done, 3 partial, 5 not done, out
of 20 — the codebase is considerably further along than the original
snapshot credits**, except for two steps that are genuinely untouched.

### Group 1 — Data-loss prevention (do first)

| Step | Status | Notes |
|---|---|---|
| 1 — Real persistence | ✅ | `node:sqlite`-backed `PersistentStorageAdapter`, WAL, migrations. Covered by `Persistence.test.ts`. |
| 2 — Drop CDN, bundle WASM | ✅ | **Corrected 2026-08-31 — this row was wrong.** `SQLiteStorageAdapter.ts` has zero CDN reference. `apps/web/src/App.tsx` *does* render `FaceCaptureApp`, which *does* import `SQLiteStorageAdapter`/`SessionRepository` from `@face/database` (`FaceCaptureApp.tsx` lines 26, 423-425) — the previous claim that `apps/web` never imports it was simply false. `apps/web/scripts/fetch-assets.mjs` copies `sql-wasm.wasm`/`sql-wasm-browser.wasm` straight from the local `node_modules/sql.js/dist` (no network) into `public/wasm/` on both `pnpm dev` and `pnpm build`; `.gitignore` deliberately excludes that derived output (`apps/*/public/wasm/`) rather than committing a binary. The doc's own verification (unplug network, DB still initializes) passes — confirmed via `turbo run build --filter=@face/web`, which reproduces the asset locally and completes with zero network-dependent steps. |
| 3 — Remove silent no-op mode | ✅ | No `memoryStore` fallback anywhere; init failures throw / log loudly instead of pretending success. Minor gap: desktop doesn't hard-block the kiosk UI on DB init failure, just disables uploads. |
| 4 — Transaction for attendance write | ✅ | `AttendanceRepository.recordAttendance()` wraps both inserts in one sync transaction. |
| 5 — `getStatus` must check real state | ✅ | `dbConnected`/`dbPath`/`dbSizeBytes`/`pendingSync` were already real. **2026-08-31**: added the two missing fields. `lastWriteAt` — `PersistentStorageAdapter.run()` (the one write path every repository and the `app_settings` key/value surface both now funnel through — `set`/`delete`/`clear` used to call the raw driver directly, bypassing it) stamps `Date.now()` on every successful write; `db.ts` exposes it as `getLastWriteAt()`. `aiServiceReachable` — new `apps/desktop/src/main/aiService.ts`, a `pingFileService()`-style probe hitting `GET /api/v1/health` on the Python sidecar (`AI_SERVICE_BASE_URL` env override, default `http://localhost:8321`, matching the port this project's own docs consistently describe it running on — not otherwise configured anywhere in `services/python-ai`), 5s `AbortSignal.timeout`. Both wired into `app:getStatus` and `SystemStatus` (preload). |

### Group 2 — DB hygiene (before real data)

| Step | Status | Notes |
|---|---|---|
| 6 — Rename mock model | ❌ | Python `extractor.py` still reports `"ArcFace-Python"` / `v1.0.0`, unchanged from the original complaint. (A separate, correctly-named TS mock — `MOCK_MODEL_FAMILY = 'MOCK'` — exists and is what enrollment actually uses, but the Python path is still mislabeled.) |
| 7 — Block profiles built from mock model | ✅ | `ProfileBuilder` marks mock-derived profiles `DRAFT`, never `ACTIVE`. Tested. |
| 8 — Enforce model-version compatibility on match | ✅ | `IdentificationEngine.identify()` filters the gallery by model before comparing, reports skip counts, never silently mixes versions. Tested. |
| 9 — Indexes + anti-duplicate constraint | ✅ | Migration 002 adds `business_day`, a unique index on `(person_id, type, business_day)`, and supporting indexes. |
| 10 — Migration runner | ✅ | Version-tracked, transactional, idempotent on rerun. 5 real migrations exist. |

### Group 3 — Business correctness (before pilot)

⚠️ **Cross-cutting finding, not captured by any single step:** `AttendanceService`,
`IdentificationEngine`, and `TemporalConfirmer` are a complete, well-tested
library — but **nothing in `apps/desktop` or `apps/web` calls any of it**. No
`ipcMain` handler, no renderer code path. The app's actual IPC surface today is
capture/upload/photo-export only. Every "done" step below is done *as a
library*, not yet *in the running kiosk*.

| Step | Status | Notes |
|---|---|---|
| 11 — Wire liveness into attendance flow | ⚠️ | `requireLiveness` gate exists and is correct; never invoked by a real entry point. |
| 12 — Pass real `qualityScore` | ⚠️ | No hardcoded `0.9` remains; a real `QualityEvaluator` exists in the capture pipeline, but nothing threads its output into `AttendanceService` since that service has no caller. |
| 13 — Never leak candidates on UNKNOWN/AMBIGUOUS | ✅ | `personId`/`score` are only populated on `MATCH`; candidates live in a separate audit-only field. Tested. |
| 14 — Temporal M-of-N policy | ✅ | Full `TemporalConfirmer` implementation (5-of-3 default, immediate lock-drop on face loss), 17 tests. |
| 15 — Versioned threshold config | 🟡 | **2026-08-31, scope narrowed — see below.** `ThresholdPolicy.getThreshold(level, overrides?)` now resolves to a real `ThresholdProfile` (`id` + numeric `version`, e.g. `default-balanced@v1`, via the new `formatPolicyVersion()`), not the security-level name standing in for a version. `IdentificationEngine`/`VerificationEngine` thread an optional `thresholdOverrides` param through and populate `RecognitionResult.policyVersion` (new optional field on `@face/core`) in every branch (UNKNOWN/AMBIGUOUS/MATCH), not just on a match. `AttendanceService.processRecognition()` now records `result.policyVersion` into `attendance_records.policy_version` instead of `this.config.securityLevel` — the "mỗi attendance_record truy được về đúng bộ ngưỡng đã dùng" checklist item is satisfied. **Deliberately not built**: reading overrides from `app_settings`, and an `audit_events` write on threshold change. The `overrides` param is the seam for both, but nothing loads or writes real overrides yet — same cross-cutting reason as steps 11/12 (Pillar B has no real caller in the app), and a write path with no caller would be exactly the kind of unused code the Group 4 note below already flags as a problem. Build this out once an admin surface that actually changes thresholds exists, not before. |
| 16 — Attendance business rules | ✅ | Active-person check, per-type cooldown/dedup, and the 4am business-day boundary were already correct. **2026-08-31**: `businessDayOf()` now computes the shifted date via `Intl.DateTimeFormat` pinned to `Asia/Ho_Chi_Minh`, instead of the host process's local time — a kiosk with a misconfigured OS timezone (or a build/test running elsewhere) now buckets attendance the same way production does. `Persistence.test.ts`'s business-day test updated to construct its timestamps with an explicit `+07:00` offset rather than the test runner's local time, so it actually exercises the pin instead of only passing by coincidence on a VN-timezone machine. |
| 17 — Sanitize filenames on export | ✅ | `safeFileToken()` strips to `[a-zA-Z0-9_-]`, truncated, applied at every export call site. |

### Group 4 — Real model (before trusting any accuracy number)

| Step | Status | Notes |
|---|---|---|
| 18 — Replace mock with a real recognition model | ❌ | No InsightFace/ONNX integration anywhere; only a placeholder string in a type union. |
| 19 — `PreprocessingSpec` + golden test vector | ❌ | Doesn't exist. |
| 20 — Benchmark before publishing numbers | ❌ | Moot until 18/19 exist. |

**Also found, not in the original doc:** `packages/database/src/schema.ts`
exports a `CREATE_TABLES_SQL` with `liveness_score REAL NOT NULL`, which
disagrees with the actual runtime schema (migration 001 has it nullable).
This export appears unused by the real startup path — looks like dead code
left over from before the migration system existed. Worth confirming and
deleting rather than leaving two schemas on file that disagree.

---

## 2. Multi-camera & device management (new scope — discussion doc, not yet an implementation plan)

Source: `plans/multi-camera-device-management-discussion.md`. Design
discussion with 8 resolved decisions and 9 open questions (see that doc's
§4) — mostly not yet implemented, except §3.8's default capture mode (see
its row below). Effort is rough-order, in man-days, for sequencing purposes
only.

| # | Status | Feature | Key work | Depends on |
|---|---|---|---|---|
| 3.2 | ✅ | Device registration (identity backbone) | **Backend**: `Campaign`/`Device` entities + migration, `CampaignService`/`DeviceService`, `POST /v1/campaigns/:id/devices` registers a device and streams back the activation zip (installer copied in as-is if `DESKTOP_INSTALLER_PATH` is set, else `activation.json` alone). **Desktop**: `secrets.ts` stores `device.id`/`device.secret`/`device.campaignId`/`device.apiBaseUrl`; `findAndImportActivationFileIfPresent()` reads `activation.json` next to the install on first run. **CMS**: `apps/cms`'s device panel has the actual click-through form (name, capture angles come from the campaign; register-and-download-zip using the real `Content-Disposition` filename) — no more API-only. Camera role assignment (CENTER/LEFT/RIGHT) still has to happen on the kiosk itself after install, since that depends on which physical camera is plugged into which USB port on that machine. | — |
| 3.6 | ✅ | Per-device configurable capture angles | Done end to end: `campaigns.capture_angles` (jsonb `CaptureStep[]`) → `GET /v1/devices/config` (device-credential-gated) → desktop's `DeviceApiClient`/`getCampaignConfig()` (15-min in-memory cache) → `FaceCaptureApp.tsx`'s `resolveActiveWorkflow()`, called fresh at every session start (resolves open question #3: config changes apply next session, no restart needed). Falls back to the hardcoded `defaultWorkflow` on any error — never blocks capture. | 3.2 |
| 3.3 | ✅ | Two-layer expiry blocking + kiosk↔backend connectivity | **Web flow**: `DeviceExpiryMiddleware` in `apps/api`, pass-through when no device headers sent (no client sends them yet — see its own doc comment), checks `campaigns.expires_at` via `DeviceService.verifyCredentials` when present. **Kiosk self-service**: `GET /v1/devices/config` (`DeviceCredentialsGuard`, `x-device-id`/`x-device-secret`) doubles as the expiry check — an expired/invalid device gets `401` instead of a config. First successful call flips a device `REGISTERED` → `ACTIVATED`. **24h fail-closed cache**: `deviceApi.ts`'s `getDeviceAccessStatus()` distinguishes a *confirmed* `401` (blocks immediately) from merely being unreachable (tolerated up to 24h since the last confirmed-good contact, persisted to disk via `secrets.ts`'s `device.lastVerified` so a restart doesn't reset the clock; past 24h, fails closed). A kiosk with no device identity at all is left alone — not participating in this system, fails open exactly as before device management existed. `FaceCaptureApp.tsx` refuses to start a session and shows a full-screen blocking message when blocked, instead of silently falling back to defaults. **Per-kiosk fs-core key**: `getFileServiceCredentials()`'s self-provisioning now keys the fs-core tenant by `device.id` when this kiosk has one (falls back to the old shared tenant for a kiosk that predates registration), so revoking one device only needs invalidating that one fs-core key. | 3.2 |
| 3.4 | ✅ | Event log + stats (the rest of §3.4) | **Backend**: `DeviceEvent` entity/migration (`device_events`, campaign_id denormalized), `DeviceEventService.recordBatch`/`campaignStats`, `POST /v1/devices/events` (device-authenticated batch ingest, `DeviceSelfController`) and `GET /v1/campaigns/:id/stats` (admin-key gated) — counts only, no dedup/idempotency (see the service's own doc comment for why that's an acceptable trade for a number nobody acts on). **Kiosk**: `stats_event_outbox` (packages/database, migration 007, real in-memory-SQLite-tested) — much simpler than `upload_outbox` on purpose (no backoff schedule, no dependency chain); `statsEvents.ts` polls every 60s and pushes whatever's `PENDING`, leaving it untouched on failure for the next tick. **Wired to real triggers**: `SESSION_COMPLETED` fires from `onAccept` (the true confirm-and-approve moment, not merely reaching the last step); `RETAKE` from `handleRestart`; `UPLOAD_SUCCESS`/`UPLOAD_FAILED` from the existing `UploadWorker` event stream (mapped from `'uploaded'`/`'quarantined'` only — transient retries are deliberately not counted). `CB_HELP_INTERVENTION` has no trigger yet (no UI surface for it exists — open question §4 #16) and will always read zero, correctly. **CMS**: `StatsPanel` on the campaign detail page, stat tiles pulling from the new endpoint. | 3.2, 3.4 (CMS) |
| 3.4 | ✅ | Admin portal | Backend built inside `apps/api` (monorepo, not a separate service yet — split out later): Campaign/Device CRUD + zip issuance (`CampaignController`, `DeviceController`, `DeviceSelfController`). **Frontend**: `apps/cms` (React 19 + Vite + Tailwind 4, no router — the two views are small enough for plain state), light/white admin theme throughout (sidebar layout, gray-50/white/gray-900 palette). One shared admin `x-api-key` (matches the server's actual auth model — no per-user login exists to build a real one against), entered once and kept in `localStorage`. Campaign list + create form; campaign detail with an edit form (expiry/consent/capture mode), a device panel (list + register-and-download-zip, using the real `Content-Disposition` filename), and a `StatsPanel` reading live event counts from `GET /v1/campaigns/:id/stats`. **Round-trip verified live against a real Postgres** (2026-08-30): created a campaign, registered 2 devices through both the CMS UI and a direct API call, fetched a device's config with its real credentials, pushed real stats events, edited campaign settings (consent-version bump confirmed on change), and watched the CMS stats panel update from the real numbers — not a mock. **Found and fixed in the process**: `DeviceController`'s unconstrained `GET devices/:id` was shadowing `DeviceSelfController`'s `devices/config`/`devices/events` routes at both the Express router and `ApiKeyMiddleware` layers, rejecting every real kiosk request with "API key required" before it ever reached `DeviceCredentialsGuard` — invisible to unit tests, since none exercise both controllers composed through Nest's actual router. Fixed via controller registration order (`device-management.module.ts`) plus an explicit middleware `.exclude()` (`app.module.ts`) — see both files' own comments. **2026-08-31**: added a cross-campaign overview — `GET /v1/campaigns/stats/summary` (`AllCampaignsStatsDao`, two grouped queries — device counts and event counts, each by campaign — not one call to the per-campaign endpoint per campaign) sums every campaign's stats and returns the per-campaign breakdown they were summed from; CMS gained a second nav item (`StatsOverview.tsx`, the new landing page) showing the grand total plus a table linking into each campaign's own `StatsPanel`. Route declared as a 3-segment `stats/summary` path specifically so it can't collide with `:id` or `:id/stats`, given this exact class of bug already bit `DeviceController` once. Verified live: real Postgres numbers (2 campaigns, 4 devices) rendered correctly, nav + deep-link into a campaign's detail page from the overview table both confirmed working via real Chrome. **Not built**: audit trail for extend/expire actions. | 3.4 (event-log) |
| 3.4b | ✅ | Capture-session list + per-device / per-day stats in the CMS; retakes no longer stored (Phase 11, 2026-09-06) | **Decisions (product owner, 2026-09-06)**: only the final attempt of each step is kept — kiosk approval deletes the superseded outbox rows and their local files, and the web path's `complete` prunes the same way (best-effort `DELETE` on fs-core for a superseded file that had already uploaded); Looka stores paths only (`fs_file_id`, `virtual_path`, statuses) and the CMS shows photos through short-lived fs-core view links issued with the per-device tenant key; every CMS admin key may open full-size photos; no retention job; one per-campaign list, no global page. **Backend**: migration `1787900000000-CaptureRecords` (`sessions.source/device_id/campaign_id/captured_at/approved_at/workflow_id`, `photos.step_type/camera_role/captured_at/uploaded_at/ready_at/fs_status_at/local_status/upload_error`, `upload_outbox.approved_at`, event types `SESSION_REPORT`/`PHOTO_STATUS`); `CaptureReportService` upserts kiosk reports idempotently from `POST /v1/devices/events`; `GET /v1/sessions` (paginated; filters campaign/device/source/date/state) and `GET /v1/sessions/:id`; `POST /v1/photos/:id/view-link` resolves the device tenant through `FileStorageService.clientForTenant` (idempotent self-service provision); campaign stats gain `sessions`, `photos{total,ready,pending,failed}`, `byDevice[]`, `byDay[]`. **Kiosk**: `UploadOutboxRepository.approveSession` keeps `MAX(attempt)` per `(kind, step_id)` (migration 008 adds `step_id`/`attempt`), `approveSessionUpload` unlinks superseded files and enqueues `SESSION_REPORT`; `startUploads` emits `PHOTO_STATUS` on uploaded/ready/failed/quarantined and now counts `failed` as `UPLOAD_FAILED`; stats push every 15 s, ≤ 50 events per push. **CMS**: `SessionsPanel` + `SessionDetailDrawer` on the campaign page, extra stat tiles, per-device table, 30-day bars. Plan and verification notes: `docs/plans/04-device-management/phase-11-capture-sessions-and-stats/`. **Verified 2026-09-06**: 42 API tests on real Postgres, 35 database + 44 ui + 22 desktop node tests, CMS build clean; API-level e2e 23/23 (`e2e/results.md` in the plan folder: mock fs-core, kiosk event simulation, web-path pruning, view-link with per-device tenant); CMS checked live in the browser against that data (stats tiles, per-device table, 30-day strip, session list, drawer rendering the photo through a fs-core view link, failed photo shown as "Chưa upload lên file server"). **Not verified**: a real kiosk run (no multi-camera rig here) and the real fs-core. | 3.2, 3.4 |
| 3.8 | ✅ | Capture trigger mode (AUTO/MANUAL) as a campaign setting | Product defaults to click-to-capture (`settingsStore.ts`, with a migration for pre-existing installs). `WorkflowEngine`'s own class-level default deliberately stays `AUTO` — that's the library's base contract its test suite assumes; the product-level default is what actually governs the shipped app. **Now reads `captureMode`/`autoHoldMs` from the campaign config**: `resolveActiveWorkflow()` resolves them alongside the capture-angle workflow at every session start (`campaignMode ?? settings.captureMode ?? 'MANUAL'`) and calls `setCaptureTriggerConfig()` on the active engine — a campaign that hasn't set either still falls back to this machine's own local settings, unchanged from before. | 3.2 |
| 3.7 | ❌ | KYC/FaceID enrollment as a campaign purpose | Not built. `campaigns.purpose` enum (`STUDENT_CARD`/`KYC_ENROLLMENT`) exists in the schema; nothing reads it yet to change capture-angle defaults or route captured data anywhere but fs-core. Still blocked on the external KYC/AI Vision system's protocol either way (§2.9). | 3.2, 3.6 |
| — | ✅ | Camera role mapping (CENTER/LEFT/RIGHT ↔ physical device) | Done: a dedicated window (`Ctrl/Cmd+Shift+K`, `cameraSetupWindow.ts` → `CameraSetupScreen.tsx`) opens a live preview for every detected camera at once and a per-device CENTER/LEFT/RIGHT dropdown (each role held by at most one device at a time); saved via `secrets.dat` (`camera.roleMapping`, JSON) through new `camera:getRoleMapping`/`camera:setRoleMapping` IPC. Deliberately a standalone window rather than a panel on the kiosk screen or the CB Help display — where a CB-Help-only surface belongs in the main window is still open (§4 #16), and the CB Help display is read-only by its own decision (§3.5). **Now consumed** by the capture pipeline — see the updated 3.1 row below. **Updated 2026-09-05 (product owner decision — "Gán camera cho các góc, chứ không phải các góc cho camera")**: `CameraSetupScreen.tsx` rewritten as one row per capture angle the active campaign needs — derived from `captureAngles` (§3.6) via `getDeviceAccessStatus()`, falling back to all five roles when there is no campaign — instead of one tile per detected camera; roles the campaign doesn't need move to a collapsed "Góc khác" section so CB Help can still pre-assign them. Picking a camera already used by another role now moves it there (with an inline note) rather than silently ignoring the conflict, and a warning banner surfaces a still-unassigned needed role or two needed roles sharing one device — the same conditions `checkFramesReadiness` (packages/ui/src/lib/multiFrame.ts) treats as blocking a session. Also re-enumerates on `navigator.mediaDevices`' `devicechange` instead of only once at mount (a plug/unplug while the window was open used to go unnoticed — reported as a bug). Persisted mapping shape (`Record<CameraRole, deviceId>`) is unchanged. | — |
| — | ✅ | Capture pipeline reads the camera role mapping (no head-turn for LEFT/RIGHT) | **Decided 2026-08-30**: LEFT/RIGHT capture triggers stay manual-click, same as §3.8; the product decision is that the subject looks straight ahead and a side camera captures the angle instead of turning their head, when one is mapped. Implemented as one new, self-contained `useEffect` in `FaceCaptureApp.tsx` that switches the *active* camera stream on step change by calling the existing `handleSelectCamera()` (the same `camera.start({ deviceId })` the manual camera picker already uses) — `WorkflowEngine`/`StepEvaluator`/`CaptureController`/`BrowserCameraService` are completely untouched, deliberately, given this codebase's own documented history of subtle capture-trigger bugs. FRONT/UP/DOWN stay on the CENTER camera (no "up"/"down" camera exists — those two steps still need a head tilt). No mapping configured (today's common case) → this effect never fires, identical to current behavior. **Known gap**: `defaultWorkflow`'s LEFT/RIGHT pose targets are still tuned for head-turning (±22.5° yaw) — a site with real side cameras and "look straight ahead" behavior needs its campaign's `captureAngles` (§3.6) to override those targets to something like `yaw: 0`, or the pose gate will still ask for an unnecessary head turn even though the correct camera is now active. This is a config change on that site's campaign, not new code. | Camera role mapping |
| 3.5 | ✅ | On-demand extended-display capture-frames monitor for CB Help | **Changed again 2026-09-05, product owner decision — supersedes the exact-mirror version of this row from earlier the same day**: the extended display no longer mirrors the whole kiosk app. It now shows only the capture frames themselves — **simultaneous mode**: every frame tile live at once, swapping to the captured photo the instant that frame completes; **sequential (per-step) mode**: one tile per step, the current step's tile live, completed steps show their photo, pending steps a placeholder — plus a small header line (current role/step + "N/M đã chụp"). Still opened/closed only on demand via `Ctrl/Cmd+Shift+H` or the kiosk UI's "Màn hình mở rộng" button (unchanged from the same-day mirror version), still placed on whichever display isn't the kiosk's own, still closes with the main window. **Data flow**: `FaceCaptureApp.tsx`'s `publishCbHelpState` sends a compact snapshot (`{ running, simultaneous, currentStepId, frames: [{ stepId, stepType, role, label, deviceId, status, capturedDataUrl?, attempt }] }`) over a new `cbhelp:publish` IPC on session start, every step change (de-duped against `state-change`'s per-frame firing), every capture/retake, and goes idle (`running:false`, empty frames) on complete/cancel/restart or leaving live mode. `apps/desktop/src/main/cbHelpWindow.ts` caches the latest snapshot and broadcasts it (`cbhelp:update`) to the CB Help window, and answers `cbhelp:getState` for one that opens or reloads mid-session; preload exposes `publishCbHelpState`/`getCbHelpState`/`onCbHelpUpdate` alongside the unchanged `toggleCbHelpWindow`/`isCbHelpWindowOpen`. **`apps/desktop/src/renderer/CbHelpFrames.tsx`** (replacing `CbHelpMirror.tsx`, which itself briefly replaced `CbHelpMonitor.tsx`) owns turning each live frame's `deviceId` into its own `getUserMedia({ video: { deviceId: { exact } } })` stream — Chromium shares one physical camera across windows of the same session, so this doesn't conflict with the main window's own stream on that device — reusing `@face/ui`'s `FrameTile`/`MultiFrameGrid`/`CAMERA_ROLE_LABELS_VI`/`CAPTURE_MIRRORED` for a consistent look. Removed as dead code: `session.defaultSession.setDisplayMediaRequestHandler` and `isCbHelpWebContents` in `index.ts` (the mirror-only mechanism). **Also this pass**: a new "Cài đặt camera" toolbar button next to "Màn hình mở rộng" (`FaceCaptureApp.tsx`, desktop-only, gated on `faceAPI.openCameraSetup`) opens the existing per-angle Camera Setup window without needing the `Ctrl/Cmd+Shift+K` shortcut. **Per-angle retake, and a real bug found while verifying it**: retaking CENTER in simultaneous mode was already correctly *not* fanning back out to the side frames (`recordExternalCapture`'s own "already COMPLETED" guard, plus the capture-trigger handler's own not-COMPLETED filter) — but retaking a **side frame** was silently broken: `WorkflowEngine.retakeStep` never reset the retaken step's own `status` away from `COMPLETED`, so the `recordExternalCapture` call `handleRetakeStep` makes right after it (a side frame has no shutter/gesture/AUTO trigger of its own) was rejected by that very guard, and nothing checked the return value — the operator saw "retake" succeed but the old photo never actually changed. Fixed in `retakeStep` (resets that one step's `status` to `PENDING`; `capturedImagePath` stays until the real replacement lands, unchanged); regression coverage in `packages/workflow-engine/src/__tests__/SimultaneousRetake.test.ts`. **Not verified**: no real second display or ≥2-camera rig was available to exercise the live `getUserMedia` tiles or dual-monitor placement here — verified only by `pnpm --filter @face/ui test`/`build`, `pnpm --filter @face/desktop test`/`build`, and `pnpm --filter @face/workflow-engine test` passing, plus static review. **Updated 2026-09-05 (product owner, second pass):** captured photos now stay visible on the extended display after the shot instead of dropping to idle a few seconds later — `publishCbHelpState` gained a `phase: 'idle' | 'live' | 'review' | 'done'` field (threaded through `CbHelpPublishState` in `cbHelpWindow.ts`/preload too) so the engine's `completed` handler and `SessionReviewModal`'s `onAccept` now publish a `running:false` snapshot built from the finished session's own `capturedImagePath`s (`'review'` while the modal is open, `'done'` once accepted) instead of the old `idle: true`; `CbHelpFrames.tsx` renders that snapshot as the completed photo grid with a "Đã chụp xong — đang chờ xác nhận"/"Đã chụp xong" header, releasing any live camera streams the same way it already did for completed frames. Still goes idle only on a genuinely abandoned/replaced run: cancel, "Chụp lại toàn bộ", a fresh session starting, or leaving live mode. Per-angle retake already worked (verified, not changed): the existing capture-trigger publish updates just that frame while the others stay visible. | None |
| 3.1 | ✅ | Local video "stream" recording, incl. true simultaneous multi-channel | Done: `capture_streams` table + `CaptureStreamRepository` (migration 006, real in-memory-SQLite-tested) mirror `upload_outbox`'s shape but with no upload/status/retry columns — recording never leaves the kiosk today (open question #3 is still open; this only implements the "local-only" half). `streams.ts` + `stream:start`/`stream:end` IPC write the file and close out the row (already generic — a new row per call, keyed by whatever `cameraId` is passed — so this needed zero changes for the multi-channel work below). **2026-08-31**: `FaceCaptureApp.tsx` now has two recording effects instead of one. The original single-stream effect (starts a `MediaRecorder` on whichever camera is currently active, independent of the capture/quality-gate logic) is now the **fallback**, used only when fewer than 2 physical cameras are mapped to roles — unchanged behavior for every single-camera site. A **new** effect takes over once ≥2 unique physical devices are mapped (CENTER/LEFT/RIGHT via §2.1's role mapping): it opens one dedicated `MediaStream` (raw `getUserMedia`, independent of `cameraServiceRef.current`) + `MediaRecorder` per physical camera at session start and keeps all of them rolling for the whole session, regardless of which one the CV pipeline has "active" for capture at any given step — this is the actual "true simultaneous 3-channel recording" gap this file previously listed as the top item still unbuilt. **Known, unmitigated risk**: when a mapped role's device is also the CV pipeline's currently-active device, that physical camera gets opened twice concurrently — the same kind of USB/driver contention §2.1 already documented hitting with even a single camera; not solved here, deliberately, to avoid touching the CV/capture pipeline. **Verification caveat (unchanged from before)**: no display/simulator was available to exercise either recording effect's real-browser `MediaRecorder`/multi-`getUserMedia` behavior live — both are verified only by static review and (for the DB layer) real passing tests. Needs a real ≥2-camera hardware test pass before either is trusted in production. **Fixed 2026-09-05 — recordings never finalized**: field evidence on a Windows kiosk showed every `capture_streams` row stuck at `size_bytes=0`/`duration_ms=0`/`ended_at=null`, no .webm data, no error logged, for both recording effects. **Root cause**: both effects' cleanup — the only code path that calls `MediaRecorder.stop()` and therefore `faceAPI.endVideoStream()` — only runs when their `useEffect` dependency array actually changes (or the renderer unmounts). They keyed that off `isWorkflowStarted`, but the normal "all steps shot → review → 'Xác nhận & Lưu hồ sơ'" completion path never flips `isWorkflowStarted` back to `false` (only `handleCancelWorkflow`/`handleRestart` did) — so for a session that completes normally, the recorder just kept running, unstopped, until the whole kiosk app quit; the row `stream:start` created was left exactly as inserted. Secondary bug: `endVideoStream`'s `{ ok: false, error }` reply was never inspected, so even a save failure on the days this path *did* trigger would have stayed invisible. **Fix**: a new `isRecordingSession` state, entirely separate from `isWorkflowStarted`, drives both effects instead — set `true` only in `handleStartWorkflow` right before `engine.startSession`, and set `false` explicitly at every real end-of-session point: the engine's `completed` event (live and simulation), `handleCancelWorkflow`, `handleRestart`, and leaving live mode. `endVideoStream`'s result is now checked and a failure logged via `console.error`. Both effects are additionally gated on a new campaign-level `recordVideo` switch — "Quay video trong lúc chụp" checkbox in the CMS create/settings forms, `campaigns.record_video` (migration `1787800000000-AddRecordVideo`), threaded through `GET /v1/devices/config` same as `simultaneousCapture`, default off — no `capture_streams` row is created at all unless a campaign turns recording on. `apps/desktop/src/main/streams.ts`'s `endVideoStream` gained an injectable repo parameter (defaults to the real Electron-backed singleton, unchanged for every production call site) purely so `apps/desktop/src/main/__tests__/streams.test.ts` can exercise its write-to-disk + repo-update logic with a fake repo, without a running Electron `app` or database. **Not re-verified live** (no display/hardware available here) — fixed by static review + the new unit test only; still needs the same real ≥2-camera hardware pass noted above, this time also confirming `ended_at`/`size_bytes`/`duration_ms` actually populate after a real session. | Camera role mapping (done) |
| 2.3 | ❌ | Student-info lookup API (`GET /v1/identify/lookup`) in `apps/api` | Not built. Would take `code` (+ optional disambiguation fields), call out to the external Admin system to resolve it, map the result to `FOUND`/`NOT_FOUND`/`AMBIGUOUS` (the `DUPLICATE` branch is a separate local check against Looka's own captured sessions, not this API). **Blocked**, same shape as §2.9/3.7: the Admin system's actual API/protocol isn't available yet. | Blocked on external protocol |

| 3.6b | ✅ | Campaign-configured 2–5 frames + simultaneous multi-camera capture (2026-09-04, `b4aa392`; minimum lowered to 2 on 2026-09-05) | **Update 2026-09-05 (product owner decision)**: the minimum frame count is now **2** (was 3) — a campaign may declare 2 to 5 capture frames, FRONT still mandatory. Reason: a 2-camera kiosk must be able to run simultaneous capture, which needs at least 2 distinct frames/roles; a 3-frame floor made that impossible. Everything else below (roles, `simultaneousCapture` semantics, distinct-role check) is unchanged. Updated: `capture-angles.validator.ts` (`MIN_STEPS` 3→2) + spec, `CaptureFramesEditor.tsx` (`MIN_FRAMES` 3→2), `CampaignList.tsx`/`CampaignDetail.tsx` (`tooFewFrames` threshold); see also docs/plans/multi-camera-device-management-discussion.md §3.6 and open question #13. **Decided with the product owner (2026-09-04)**: frames are the campaign's `captureAngles` (originally 3–5, FRONT always present), `simultaneousCapture` is a campaign flag set in the CMS, the kiosk shows the frames as a live grid on the capture screen, camera assignment stays in the kiosk's Camera Setup (now 5 roles: CENTER/LEFT/RIGHT/UP/DOWN), and a session **refuses to start** when any frame lacks a connected, distinct camera (`FramesBlockedPanel` lists what is missing and opens Camera Setup via the new `camera:openSetup` IPC). **Backend**: `campaigns.simultaneous_capture` (migration 1787700000000), `validateCaptureAngles` on create/update (count, exactly one FRONT, allowed roles, distinct effective roles when simultaneous — Vietnamese messages), field on campaign responses and `GET /v1/devices/config`. **Engine**: `WorkflowEngine.recordExternalCapture(stepId, imagePath)` marks a step COMPLETED through the normal bookkeeping and emits the same `capture-trigger`, so the existing store → review → approve → upload pipeline is unchanged; `advanceToNextStep` skips steps completed out of order. **Kiosk**: `packages/ui/src/lib/multiFrame.ts` (`framesForWorkflow`, `checkFramesReadiness`, `snapshotVideoFrame`), one raw stream per side frame, the CENTER frame stays the analysed camera; when the CENTER step captures, every other pending frame is snapshotted at that instant and recorded via `recordExternalCapture`; **Updated 2026-09-05**: a side-frame retake no longer snapshots instantly with no gate — it now closes the review modal and returns to a live capture screen showing only that frame, reopening its stream if needed, and waits for a real shutter/gesture/AUTO trigger (routed to that frame's own camera via `WorkflowEngine.retakeStep`'s new `externalCapture` option) before replacing the photo, exactly like every other retake; see §3's "Per-frame retake" entry for the full fix; multi-channel recording reuses the frame streams (no double-open in this mode). **Verified 2026-09-04**: API validation + device registration + device config round-trip against local Postgres (curl); 27/27 test tasks; and end to end from the *downloaded* activation zip on the Intel test Mac — installed from the dmg inside the zip, `activation.json` dropped next to the executable, device flipped to ACTIVATED on first config fetch, and the operator confirmed the "Chưa đủ camera cho chế độ chụp đồng thời" panel on session start (one camera, none mapped). **Not verifiable here**: the actual simultaneous shot needs ≥3 physical cameras. **Noted while testing**: each ad-hoc build is a new identity to TCC, so macOS asks for camera permission again per build (a Developer ID signature would persist the grant); on macOS the activation file must live inside `Looka.app/Contents/MacOS/`, which is awkward for an operator — consider also probing next to the `.app`; registration takes 47–85 s because the zip embeds the 240 MB installer. Resolves open questions #13 (toggle within the fixed 5, FRONT mandatory) and #14 (config applies next session). | 3.6, camera role mapping |

**What's actually left, in order:** KYC enrollment (3.7) — still blocked on
an external protocol, not a Looka-side task until that arrives. True
simultaneous multi-channel recording (3.1) is now implemented, closing what
was previously the top item here, but — same as the single-stream recorder
before it — still needs a real-environment test pass (`MediaRecorder` +
concurrent `getUserMedia` in an actual browser/Electron window, ideally with
≥2 real cameras plugged in — no display/simulator was available here) before
either recording effect is trusted in production; both are verified only by
static review and the DB layer's real tests. Also unmitigated: the
double-open-same-device risk noted in 3.1's row above, whenever a mapped
role's camera coincides with the CV pipeline's active one.

**9 open questions still blocking a real implementation plan** (see the
discussion doc §4 for full context): retry/timeout thresholds, video
upload-vs-local-only, per-kiosk fs-core key count acceptable, head-turn
behavior when C0 covers for a failed C1/C2, priority when C0 itself fails,
capture-angle configurability granularity (toggle vs. free-form) and whether
FRONT can be disabled, whether angle-config changes apply immediately or need
a restart, upload timing log granularity (single column vs. a separate
attempt-log table), and the UI surface for CB-Help actions now that the
secondary display (§3.5) is view-only.

---

## 3. Other known gaps (outside both lists above)

- **Face resolution <250×250px** (discussion doc §2.8) — ✅ done.
  `QualityEvaluator.evaluateQuality` now checks absolute pixel size
  (`FACE_RESOLUTION_TOO_LOW`, ≥250px) alongside the existing ratio check,
  computed against the resolution the capture actually gets SAVED at (an
  optional `saveFrameSize` param) rather than the — possibly downscaled —
  analysis frame: `BrowserCameraService.getFrame()` now reports the camera's
  native resolution (`FrameInput.nativeWidth/nativeHeight`), threaded through
  `MediaPipeCVEngine`/`FaceState.captureFrameWidth/captureFrameHeight` into
  `StepEvaluator`'s real capture gate — not just a cosmetic debug reading.
  Applies to the current single-camera 5-angle flow too, not only the
  multi-camera design.
  **Update 2026-09-05**: floor is now FRONT-only, by product decision —
  "Chỉ cần cam chính diện >= 250px là được, các cam khác không cần". The
  ≥250px check still runs in `QualityEvaluator.evaluateQuality`, but a new
  `enforceFaceResolution` option (defaults to `true`) lets a caller opt a
  capture out of it; `StepEvaluator` passes `false` whenever the step's
  camera role (`step.cameraRole`, else `defaultCameraRoleForStepType`)
  resolves to anything but `CENTER`, so LEFT/RIGHT/UP/DOWN steps can no
  longer be blocked by `FACE_RESOLUTION_TOO_LOW` — they are process evidence,
  not the printed/matched photo. Simultaneous mode already snapshotted side
  frames with no quality gate at all (`snapshotVideoFrame` in
  `FaceCaptureApp.tsx`), so nothing there needed to change. Side-frame
  streams (`openFrameStreams`) also now request 1280x720 instead of
  1920x1080, so the FRONT camera keeps the USB bandwidth for its own 1080p
  capture when three cameras share one bus — the likely cause of the field
  report "FRONT face < 250px with three cameras open". Both
  `BrowserCameraService.start()` and `openFrameStreams` now log the
  resolution actually granted (`[BrowserCameraService] stream started` /
  `[FaceCaptureApp] frame stream opened`) so a silent downgrade shows up in
  `main.log` instead of only surfacing later as a quality failure.
- **FRONT smile ceiling ignored sensitivity level** — found 2026-09-05 (field
  report "cười vẫn cho chụp": a visibly smiling subject was still captured on
  the FRONT step), **fixed 2026-09-05**. `QualityEvaluator`'s `maxSmileScore`
  came entirely from the sensitivity preset (LOW 0.60 down to VERY_HIGH
  0.20), so a moderate smile stayed under the ceiling at the kiosk's default
  sensitivity. **Product decision**: an ID photo must be neutral regardless
  of sensitivity level — the FRONT/CENTER step's smile ceiling is now capped
  at `min(levelCeiling, 0.30)` (`MAX_FRONT_SMILE_SCORE` in
  `QualityEvaluator.ts`), applied via a new `options.maxSmileScoreOverride`
  that only ever tightens, never loosens, the level's ceiling.
  `StepEvaluator` passes it using the same `cameraRole` resolution as the
  §2.8 resolution floor above (`step.cameraRole ??
  defaultCameraRoleForStepType(step.type)`); side-angle (LEFT/RIGHT/UP/DOWN)
  steps keep the level's own ceiling since they are process evidence, not
  the printed/matched photo. Both `WorkflowEngine.triggerManualCapture`
  (OFF-shutter/MANUAL-gesture) and AUTO-mode auto-fire re-run
  `StepEvaluator.evaluate` as their capture gate, so the strict FRONT
  ceiling applies under every trigger mode without further change. Guidance
  text for `SMILING` (`GuidanceEngine.MESSAGES`) reviewed against this
  change: "Vui lòng giữ biểu cảm bình thường, không cười" already tells the
  operator what to correct, so it was left unchanged.
- **macOS kiosk: black camera preview, no error** — ✅ fixed 2026-09-04
  (commits `04a475b`, `a40a0bb`, `34c6533`). Root cause: the packaged x64
  app was completely unsigned (`codesign`: "not signed at all"), carried no
  camera entitlement, and main never called
  `systemPreferences.askForMediaAccess('camera')`, so macOS never showed the
  TCC prompt and `getUserMedia` resolved with a stream that delivers no
  frames ("Live Camera Ready", 30 FPS, 0 CV). Reproduced with an isolated
  page in the signed dev Electron binary: gUM resolved at 1280x720,
  `video.play()` never resolved, access status stayed `not-determined`.
  Fix: ad-hoc signing (`mac.identity: "-"`, hardened runtime,
  `apps/desktop/build/entitlements.mac.plist` with
  `com.apple.security.device.camera`), Vietnamese
  `NSCameraUsageDescription`, `ensureMacCameraAccess()` fired after
  `createWindow()` (never awaited — a pending dialog must not hide the
  kiosk window), every permission request logged to `main.log`, and
  `startLiveMode` now starts the camera before MediaPipe init (20s timeout,
  mock fallback). Also bundled sql.js wasm into the desktop build (was
  fetched from `file:///wasm/` and aborted on every launch) and stopped
  `prepackage` from wiping `release/`, which used to delete the other OS's
  installer that `apps/api/.env` points at. **Verified 2026-09-04** on the
  Intel test Mac: the rebuilt x64 app launched via `open` showed the macOS
  camera prompt, the operator accepted it, and the live preview rendered
  frames. Launching the binary directly from a shell does NOT reproduce
  this (TCC attributes the request to the parent process), so always test
  with `open <app>` or from Finder. Diagnostics to check in `main.log`:
  `[camera] macOS media access status` / `askForMediaAccess ... result`
  and the absence of `[BrowserCameraService] getFrame(): video not ready`.
- **Stills were mirrored** — ✅ fixed 2026-09-04. `BrowserCameraService`
  defaulted `mirrorStills = true` to match the mirrored selfie-style preview,
  so every saved FRONT photo was a mirror image (wrong for an ID photo).
  **Product decision**: nothing is mirrored anywhere — stills are the raw
  sensor orientation, and `CameraPreview`/`FaceOverlay`/`GestureOverlay`
  default to unmirrored. The pose pipeline (`PoseEstimator`, yaw sign) and
  guidance text were already defined in unmirrored image space, so they
  needed no change and are now consistent with what the screen shows.
  Multi-frame tiles and their snapshots were unmirrored from the start.
  **Update 2026-09-05**: reversed for the live preview only, by product
  decision after testing the unmirrored preview on a kiosk. The preview
  (`CameraPreview`/`FaceOverlay`/`GestureOverlay` in the capture views, plus
  the multi-frame grid's `FrameTile` tiles) is mirrored again so the subject
  can position themselves the way they would in front of a real mirror
  (raising their right hand appears on the screen's right side). Saved
  stills (`BrowserCameraService.mirrorStills`) and the multi-frame side-shot
  snapshots (`snapshotVideoFrame`) stay raw/unmirrored — only the display is
  flipped (a CSS transform on the `<video>`), so nothing downstream of the
  actual pixel data changes. The pose pipeline and guidance text
  ("Quay mặt sang trái/phải") still operate on the raw, unmirrored frame and
  were deliberately left alone: verified that a mirrored preview still reads
  naturally, the same way a real mirror does — turning your head to your own
  right moves your face toward the screen's right, matching the instruction.
  Every on-screen rendering of a captured still (step thumbnails, the flying
  capture animation, the freeze-frame, multi-frame tiles, and the
  review/retake screen) is now display-mirrored to match, via a shared
  `CAPTURE_MIRRORED` constant — the saved/exported/uploaded files remain raw.
- **Capture-mode naming trap (CMS vs. engine)** — found 2026-09-05, **fixed
  2026-09-05**. `CaptureTriggerMode` (`packages/core/src/types/face.ts`) names
  its two non-AUTO modes for *how* the operator triggers a shot: `MANUAL`
  means a 500ms-held hand-gesture trigger, `OFF` means a physical
  shutter-button click (see `CaptureTriggerEvaluator.evaluate`). The CMS
  campaign-settings picker (`apps/cms/src/components/CampaignDetail.tsx`,
  `CampaignSettingsForm`) had this backwards and also dropped a mode
  entirely: its `MANUAL` option was labelled "MANUAL — bấm nút chụp" ("MANUAL
  — press the capture button"), describing what `OFF` actually does, not
  `MANUAL`'s real gesture-hold behavior; and `OFF` wasn't offered as a
  `<select>` option at all, so there was no way to configure plain
  click-to-capture from the CMS. **Now fixed**: the select offers all three
  modes with labels matching the engine (`AUTO` → "Tự động (giữ đúng tư
  thế)", `MANUAL` → "Cử chỉ tay (giơ tay để chụp)", `OFF` → "Bấm nút chụp
  (thủ công)"), enum values unchanged.

  **A second, more serious bug came from an admin actually using the fixed
  form to pick `OFF`**: `FaceCaptureApp.tsx`'s `resolveActiveWorkflow()`
  correctly resolved the campaign's `captureMode` and handed it to the
  engine via `setCaptureTriggerConfig`, but the capture views
  (`DesktopCaptureView`/`MobileCaptureView`) never received that resolved
  value — `GuidedCaptureScreen` read its own `captureMode` straight from
  this machine's *local* settings store instead, entirely independent of
  what the campaign said. A kiosk with campaign mode `OFF` kept rendering
  the MANUAL/AUTO UI: no shutter button, and (worse) a countdown ring /
  "CAPTURING" status that implied an automatic capture was imminent — while
  the engine sat waiting for a shutter press the UI gave no way to make,
  and the gesture-capture path (`captureTriggerRef`, a second, independent
  copy of the trigger mode used only by the hand-gesture animation loop)
  would have been equally broken for a campaign-set `MANUAL`, since nothing
  synced it from the campaign either — only a local, manual toggle ever
  touched it. **Fix**: `FaceCaptureApp` now keeps one
  `effectiveTriggerConfig` state (`{ mode, autoHoldMs, fromCampaign }`), set
  at every site that resolves a campaign config and hands it to an engine
  (init, start, restart, cancel) and by the local mode/hold-time handlers,
  and synced to `captureTriggerRef` at the same sites as the two
  `WorkflowEngine`s. `captureMode`/`autoHoldMs` now flow into
  `GuidedCaptureScreen`/`DesktopCaptureView`/`MobileCaptureView` as override
  props (same pattern the existing `sensitivity` prop already used) instead
  of the views reading local settings independently. The countdown ring and
  the footer's "CAPTURING" status/instruction are now gated on
  `captureMode === 'AUTO'` (UI-only change, `WorkflowEngine`'s own
  stability/status tracking is unchanged) — OFF shows "Bấm nút chụp", MANUAL
  shows "Giơ cử chỉ tay để chụp" once the pose itself is fine. The AUTO/
  MANUAL/OFF selector (`DesktopCaptureView`'s telemetry drawer and
  `OverlayConfigPanel`) shows a "Theo cấu hình campaign" hint and disables
  itself while `effectiveTriggerConfig.fromCampaign` is true, rather than
  offering a local override that could desync again.
- **Simultaneous capture split one shutter press into two sessions** — found
  2026-09-05 from field evidence (Windows kiosk, campaign with 2 frames
  FRONT+LEFT, `simultaneousCapture=true`, shutter-button mode), **fixed
  2026-09-05**. One shutter press captured both frames at the same instant,
  but the kiosk staged them under two different session ids: the FRONT photo
  stayed in `upload_outbox` as `PENDING` (never approved, `fs_file_id` null)
  while the LEFT photo reached `DONE`. The operator only approved once in
  the review screen, but `approve()` released only the session id
  `RunScopedCaptureSession` had cached last, so the FRONT photo stayed
  staged forever and one of the two expected `UPLOAD_SUCCESS` stats events
  never fired. Root cause:
  `RunScopedCaptureSession.ensure()` (`packages/ui/src/lib/CaptureSink.ts`)
  cached only the resolved session id, not the in-flight `startSession` call
  itself. Simultaneous capture fires the CENTER frame's own `storePhoto` and
  every side frame's `recordExternalCapture` → `capture-trigger` →
  `storePhoto` synchronously, in the same tick (see
  `FaceCaptureApp.tsx`'s shared `capture-trigger` handler), so both
  concurrent `savePhoto()` calls observed `sessionId === null` before either
  had awaited `startSession`, and each opened (and cached) its own session.
  **Fix**: `ensure()` now memoises the in-flight `startSession` promise
  (`sessionPromise`) so concurrent callers all await the one call in
  progress instead of racing separate ones; cleared in `complete()`/
  `reset()` alongside `sessionId`, and also cleared on a failed
  `startSession` so a later call can retry instead of forever awaiting the
  same rejection. Covered by new tests in
  `packages/ui/src/lib/__tests__/CaptureSink.test.ts` (concurrent calls
  share one `startSession` call and one session id; sequential calls are
  unaffected; a failed `startSession` is retried, not stuck). The stuck
  `PENDING` `upload_outbox` row from the 2026-09-05 15:53 field test is a
  leftover from before this fix on the dev kiosk's local database, not a
  live issue — no cleanup needed beyond that row itself.

  Also checked, not changed: `WorkflowEngine.recordExternalCapture`
  (`packages/workflow-engine/src/WorkflowEngine.ts`) increments a step's
  `attempts` *before* emitting `capture-trigger`, so a side frame's very
  first capture already carries `attempts === 1` by the time
  `FaceCaptureApp.tsx`'s handler reads it — and that handler unconditionally
  adds one more (`(step?.attempts ?? 0) + 1`), producing `attempt: 2` for a
  first-ever shot (matches the field evidence's
  `face-step-left-2.jpg`). The ordered/CENTER capture path never increments
  `attempts` on a successful capture (only on a rejected attempt or a
  retake), which is exactly why the same `+ 1` formula is correct there.
  Reconciling the two is not a one-line change: `WorkflowEngine.ts`'s
  existing `ExternalCapture.test.ts` (lines ~145-152) asserts
  `attempts === 1` right after a first `recordExternalCapture`, so changing
  the increment there breaks a green test; and the two capture-trigger call
  sites' payload shape is itself asserted (`assert.deepEqual(triggers, ...)`
  in the same file), so widening the event to carry the already-correct
  attempt number isn't free either. The safe fix lives entirely in
  `FaceCaptureApp.tsx`: distinguish the re-entrant `recordExternalCapture`
  call from the ordinary one (e.g. a ref-backed flag set only around the
  `recordExternalCapture` loop in the `capture-trigger` handler) and skip
  the extra `+ 1` for that case. Left as a follow-up — off-by-one attempt
  numbers do not lose or misfile a photo the way the session-id bug did,
  since idempotency keys are per-step, so the risk here is lower.
- **Approve reported success while nothing was ever approved** — found
  2026-09-05 from field evidence (Windows kiosk, two 3-frame simultaneous
  shutter-mode sessions, 16:56 and 17:03), **fixed 2026-09-05**. Each session
  staged 3 photos under one `upload_outbox` session_id (`PENDING`,
  `approved_at` NULL) as expected; the operator pressed "Xác nhận & Lưu hồ
  sơ", the modal closed exactly like a successful confirm, yet `approved_at`
  never got set, no `SESSION_COMPLETED` stats row appeared, and nothing
  uploaded — with no error anywhere. Root cause:
  `ElectronCaptureSink.approveUpload()` (`packages/ui/src/lib/CaptureSink.ts`)
  only checked the IPC reply's `ok` field. `session:approveUpload`'s
  main-process handler (`apps/desktop/src/main/index.ts`) deliberately
  returns `{ ok: true, approved: 0 }` — not an error — whenever the sessionId
  it receives matches zero still-staged rows (see
  `UploadOutboxRepository.approveSession`), so a genuine no-op approve
  (already approved, or a sessionId that for whatever reason does not match
  the rows this run actually queued) resolved exactly like a real release:
  `RunScopedCaptureSession.approve()` never threw, `onAccept` ran
  `finishSession()` + `reportStatsEvent('SESSION_COMPLETED')` + closed the
  modal, and the 3 rows this run staged were left `PENDING` forever,
  invisible to `claimDue()`. Traced whether `RunScopedCaptureSession`'s own
  id-caching could explain the mismatch: no — its `ensure()`/`approve()`
  (hardened by the memoised-`sessionPromise` fix above, earlier the same
  day) cache and reuse one id consistently across every `savePhoto`/`approve`
  call on the same instance, and that path already has thorough test
  coverage; the remaining, unexercised gap was purely this one
  silent-success branch in the Electron sink. **Fix**:
  `ElectronCaptureSink.approveUpload` now also requires `result.approved >
  0`, throwing a Vietnamese error ("Không tìm thấy ảnh nào của phiên này để
  duyệt…") otherwise, which routes through `RunScopedCaptureSession`'s
  existing reject path so the review modal stays open instead of closing on
  a no-op (see `FaceCaptureApp.approveUpload`'s existing catch/retry
  handling). Added `console.warn` diagnostics on both sides of the IPC call
  so a future mismatch is diagnosable from `main.log` alone: main's
  `session:approveUpload` handler now logs `sessionId`/`approved` (and any
  thrown error) on every call, and `FaceCaptureApp`'s `onAccept` logs the
  `RunScopedCaptureSession`'s cached id (a new `cachedSessionId` getter)
  right before approving. New tests in
  `packages/ui/src/lib/__tests__/CaptureSink.test.ts` exercise
  `ElectronCaptureSink.approveUpload` directly for the first time (previously
  only `RunScopedCaptureSession`, via a fake sink, was tested): rejects on
  `approved: 0` and on a missing `approved` field, resolves when rows were
  actually released, still rejects on an explicit `ok: false`.
- **Per-frame retake in simultaneous mode: instant snapshot, no gate, no
  live view** — product decision 2026-09-05 (second pass), **fixed
  2026-09-05**. Pressing "Chụp lại" on one frame in the review modal, in
  simultaneous-capture mode, used to snapshot a side frame's video
  *instantly*, synchronously, inside `handleRetakeStep` itself — no return to
  a live capture screen, so the operator saw nothing happen and the extended
  (CB Help) display never went live. **Fix**
  (`packages/ui/src/components/screens/FaceCaptureApp.tsx`):
  `handleRetakeStep` now closes the review modal and returns to the capture
  screen exactly like every other retake, defensively re-opens any closed
  frame streams (`openFrameStreams` is already idempotent), and republishes
  CB Help state so the extended display shows that frame `CURRENT`/live while
  every other frame stays `COMPLETED` with its still (`isFrameLive` in
  `CbHelpFrames.tsx` already handled this correctly once the published state
  says so — no change needed there). The actual snapshot now waits for a
  real trigger, routed through a new `captureRetakingSideFrame` helper shared
  by the shutter button (OFF mode), the gesture loop (MANUAL mode), and a new
  `external-capture-ready` event the engine emits for AUTO mode's own
  auto-fire — all three snapshot the retaken frame's own `<video>` element
  and hand it to `recordExternalCapture`, never the engine's own (CENTER-only)
  capture path. **Engine** (`packages/workflow-engine/src/WorkflowEngine.ts`):
  `retakeStep(stepId, { externalCapture: true })` — set only for a
  simultaneous-capture side frame — makes `processFrame`'s AUTO auto-fire
  emit `external-capture-ready` instead of calling `triggerManualCapture`
  (whose snapshot provider only ever reads the CENTER-analysed camera, the
  wrong physical camera for a side frame), and makes `triggerManualCapture`
  itself refuse outright as a defence-in-depth backstop; the flag clears
  automatically once the retaken step completes (`advanceToNextStep`), so it
  can never leak into an unrelated later step. CENTER's retake and every
  sequential (non-simultaneous) per-step retake are unchanged — both already
  returned to a live capture screen correctly. New tests in
  `packages/workflow-engine/src/__tests__/SimultaneousRetake.test.ts`: AUTO
  mode emits `external-capture-ready` (not `capture-trigger`) and leaves the
  step un-completed until the caller supplies the photo; `triggerManualCapture`
  is a no-op while the flag is set; the flag does not leak into a later,
  unrelated retake. `pnpm --filter @face/workflow-engine test`: 44/44 passing
  (41 existing + 3 new).
- **Recording never tied to the actual session — a stuck abandoned run kept
  recording, the next real session got no recording at all** — found
  2026-09-05 from field evidence (Windows kiosk, 3-camera simultaneous
  campaign, `recordVideo=true`): a session started at 17:40, was abandoned
  by the operator with no cancel/complete/restart ever firing, and its
  recorders kept running — two `capture_streams` rows eventually closed at
  ~234 MB each, one was left OPEN (`size_bytes=0`, `ended_at=null`). The
  *next* real session (17:58, photos captured/approved/uploaded normally)
  created NO recording rows at all. **Root cause**: the two recording
  effects in `FaceCaptureApp.tsx` were gated on `recordVideo &&
  isRecordingSession`, a plain **boolean** (itself a 2026-08-31 fix — see
  this row's earlier history two entries up — that correctly separated
  "is a session running" from "should recording be on," but still couldn't
  tell two different sessions apart). Nothing ever reset the flag on mere
  inactivity (there was no idle/runaway cap at all), so the abandoned run
  left it stuck `true`; the next session's `setIsRecordingSession(true)` was
  therefore a no-op (same value in, no re-render), the effects' dependency
  arrays never changed, and they never re-ran — the stale recorder from the
  abandoned run just kept going while the new session got no recorder of
  its own. **Fix**: replaced the boolean with `recordingSessionKey: string |
  null`, set to the engine's actual `currentSession.id` the moment a real
  session starts (`handleStartWorkflow`, the only call site that ever set
  the old flag) and reset to `null` at every real end-of-session point
  (engine `completed`, `handleCancelWorkflow`, `handleRestart`, leaving live
  mode) — a brand-new session always has a genuinely different id, so the
  effects' dependency arrays always change and always restart, even when the
  previous session's teardown never ran. Both effects now also log
  `console.warn('[FaceCaptureApp] recording stopped', { sessionId, files })`
  once every recorder they own has actually stopped and finalized. **Also
  added, since this bug's root scenario is "operator walked away, nothing
  ever fired"**: a runaway cap — `isRecordingOverCap`/
  `MAX_RECORDING_DURATION_MS` (10 minutes) in the new
  `packages/ui/src/lib/recordingGate.ts` — checked every 30s inside both
  effects; a session left open past the cap stops and finalizes its
  recording on its own, logged, regardless of whether any operator action
  ever happens. The gating itself was extracted into pure, unit-tested
  helpers (`shouldRecordSingleStream`/`shouldRecordMultiChannel`) in that
  same file, covered by `packages/ui/src/lib/__tests__/recordingGate.test.ts`
  (including a test that reproduces the exact "stuck boolean vs. new session
  key" scenario). **Not re-verified live** (no ≥2-camera hardware available
  here) — fixed by static review plus the new unit tests; still needs the
  same real hardware pass this feature's earlier rows already flagged as
  outstanding, this time also confirming an abandoned session's recording
  actually stops within the 10-minute cap.
- **Black side-frame snapshots accepted — a fully black photo was stored,
  approved, and uploaded** — found 2026-09-05 from field evidence (the same
  17:58 session above): the RIGHT frame's first capture
  (`face-step-right-2.jpg`) was a fully black 1280x720 JPEG (13 KB) — the
  RIGHT Rapoo camera's tile still showed "Chờ" (stream not yet delivering
  frames) when the CENTER shutter fired. **Root cause**: side frames are
  snapshotted with no gate at all — `snapshotVideoFrame`
  (`packages/ui/src/lib/multiFrame.ts`), called from the CENTER
  capture-trigger fan-out and from `captureRetakingSideFrame` in
  `FaceCaptureApp.tsx` — only ever checked `video.videoWidth === 0`, which a
  side camera's offscreen `<video>` can already report non-zero for while
  still delivering the driver's placeholder/negotiation buffer, well before
  it renders a real frame. **Fix, two layers**: (1) **Readiness** — a new
  `frameReadiness` map in `FaceCaptureApp.tsx` tracks, per non-CENTER frame,
  whether its offscreen `<video>` has actually rendered a real frame
  (`markFrameReadyWhenPlaying`, preferring `requestVideoFrameCallback`,
  falling back to polling `readyState`/`videoWidth`); the multi-frame tile
  now shows **'READY'** ("Sẵn sàng") instead of staying on 'PENDING' ("Chờ")
  once that happens, and the OFF-mode shutter
  (`DesktopCaptureView`/`MobileCaptureView`) stays disabled — with a
  "Đang chờ camera &lt;role&gt;…" hint (new `ShutterButton.disabledHint`
  prop) — until every side frame reports ready (`allSideFramesReady`, new
  pure helper in `multiFrame.ts`). (2) **Snapshot guard** — `snapshotVideoFrame`
  now draws to canvas as before, then downscales to a small sample and runs
  a new pure luminance/variance check (`isFrameLikelyBlank`, over a plain
  `Uint8ClampedArray` so it's unit-testable without a DOM/canvas — this
  package's tests run under plain `node:test`) that rejects a frame whose
  mean luminance is near-black OR whose variance is near-zero (a stuck
  driver returning a solid gray/white frame is just as unusable as black);
  a rejected frame returns `null`, same "treat as no snapshot, leave pending
  for retake" path the existing `videoWidth === 0` guard already used. The
  operator now actually sees this happen — the previously console-only "no
  snapshot" warning also surfaces a Vietnamese banner ("Khung &lt;label&gt;
  (&lt;role&gt;): camera chưa sẵn sàng, chụp lại góc này.") via the existing
  `storeError` banner mechanism. Layer 1 covers the OFF-mode shutter
  specifically; layer 2 is trigger-mode-agnostic and also protects the
  AUTO/MANUAL paths, which have no shutter to disable. New tests in
  `packages/ui/src/lib/__tests__/multiFrame.test.ts` for `isFrameLikelyBlank`
  (black/solid-gray/solid-white all rejected, a varied checkerboard frame
  accepted, zero-size input treated as blank) and for
  `allSideFramesReady`/`firstNotReadyFrameRole`. **Also fixed in the same
  pass**: `console.warn('[FaceCaptureApp] frame stream opened', {…})` and
  the `BrowserCameraService` `'stream started'` warn were reaching
  `main.log` as a bare message with the object argument dropped entirely
  (`[object Object]` once anything tried to print it) — Electron's
  `console-message` forwarding only ever carries the renderer console call's
  first string argument. Both now `JSON.stringify` their payload into a
  single formatted string. **Not re-verified live** (no ≥2-camera hardware
  available here) — fixed by static review plus the new unit tests for the
  luminance math and readiness helpers; still needs a real multi-camera
  hardware pass to confirm the readiness signal (`requestVideoFrameCallback`
  vs. the polling fallback) fires correctly on real camera negotiation
  timing, not just in theory.
- **24h fail-closed trap on activation** (§3.3): the CMS "API endpoint"
  field at device registration is optional. When left empty,
  `activation.json` carries no `authApiEndpoint`, `DeviceApiClient` reports
  `unreachable` forever, and exactly 24h after first launch the kiosk shows
  the full-screen "Thiết bị đã bị khoá" overlay with no recovery short of
  re-activation. Either make the field mandatory in the CMS, or treat "no
  endpoint configured" as "not participating" (fail open) in
  `getDeviceAccessStatus()`. Not decided yet.
- **AI Vision server integration protocol** (discussion doc §2.9): external
  dependency — needs the API/protocol docs from whichever team owns that
  system before client-side preprocessing can be designed.
- **Dangling doc reference**: a comment in `BrowserCameraService.ts`
  (removed auto-zoom code, 2026-08-26 commit) points to
  `card-photo-quality-checks.md`, which does not exist anywhere in the repo's
  history. Minor doc debt — either restore the file or drop the reference.
- **Stale schema export**: see the Group 4 note above
  (`packages/database/src/schema.ts`).

---

## 4. How this file should be maintained

Re-verify a step's status here by reading the referenced code directly, the
same way this file was built — don't just trust the checkbox from last time.
Add new rows for new scope as it's decided; move resolved "open questions"
out of §2 and into the feature row they unblock.
