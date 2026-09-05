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
| 3.8 | ✅ | Capture trigger mode (AUTO/MANUAL) as a campaign setting | Product defaults to click-to-capture (`settingsStore.ts`, with a migration for pre-existing installs). `WorkflowEngine`'s own class-level default deliberately stays `AUTO` — that's the library's base contract its test suite assumes; the product-level default is what actually governs the shipped app. **Now reads `captureMode`/`autoHoldMs` from the campaign config**: `resolveActiveWorkflow()` resolves them alongside the capture-angle workflow at every session start (`campaignMode ?? settings.captureMode ?? 'MANUAL'`) and calls `setCaptureTriggerConfig()` on the active engine — a campaign that hasn't set either still falls back to this machine's own local settings, unchanged from before. | 3.2 |
| 3.7 | ❌ | KYC/FaceID enrollment as a campaign purpose | Not built. `campaigns.purpose` enum (`STUDENT_CARD`/`KYC_ENROLLMENT`) exists in the schema; nothing reads it yet to change capture-angle defaults or route captured data anywhere but fs-core. Still blocked on the external KYC/AI Vision system's protocol either way (§2.9). | 3.2, 3.6 |
| — | ✅ | Camera role mapping (CENTER/LEFT/RIGHT ↔ physical device) | Done: a dedicated window (`Ctrl/Cmd+Shift+K`, `cameraSetupWindow.ts` → `CameraSetupScreen.tsx`) opens a live preview for every detected camera at once and a per-device CENTER/LEFT/RIGHT dropdown (each role held by at most one device at a time); saved via `secrets.dat` (`camera.roleMapping`, JSON) through new `camera:getRoleMapping`/`camera:setRoleMapping` IPC. Deliberately a standalone window rather than a panel on the kiosk screen or the CB Help display — where a CB-Help-only surface belongs in the main window is still open (§4 #16), and the CB Help display is read-only by its own decision (§3.5). **Now consumed** by the capture pipeline — see the updated 3.1 row below. | — |
| — | ✅ | Capture pipeline reads the camera role mapping (no head-turn for LEFT/RIGHT) | **Decided 2026-08-30**: LEFT/RIGHT capture triggers stay manual-click, same as §3.8; the product decision is that the subject looks straight ahead and a side camera captures the angle instead of turning their head, when one is mapped. Implemented as one new, self-contained `useEffect` in `FaceCaptureApp.tsx` that switches the *active* camera stream on step change by calling the existing `handleSelectCamera()` (the same `camera.start({ deviceId })` the manual camera picker already uses) — `WorkflowEngine`/`StepEvaluator`/`CaptureController`/`BrowserCameraService` are completely untouched, deliberately, given this codebase's own documented history of subtle capture-trigger bugs. FRONT/UP/DOWN stay on the CENTER camera (no "up"/"down" camera exists — those two steps still need a head tilt). No mapping configured (today's common case) → this effect never fires, identical to current behavior. **Known gap**: `defaultWorkflow`'s LEFT/RIGHT pose targets are still tuned for head-turning (±22.5° yaw) — a site with real side cameras and "look straight ahead" behavior needs its campaign's `captureAngles` (§3.6) to override those targets to something like `yaw: 0`, or the pose gate will still ask for an unnecessary head turn even though the correct camera is now active. This is a config change on that site's campaign, not new code. | Camera role mapping |
| 3.5 | ✅ | Secondary read-only display for CB Help | Done: `cbHelpWindow.ts` opens a second `BrowserWindow` on whichever display isn't the kiosk's own (`screen.getAllDisplays()`), loading the same renderer bundle at `#cb-help` (`main.tsx` branches on the hash — no second Vite entry needed) into `CbHelpMonitor.tsx`. `capture:queue`'s handler broadcasts every capture to it; `FaceCaptureApp.tsx` reports the active workflow's steps at session start via `notifyCbHelpSessionStarted`. **Not done**: camera alive/dead status (that state lives in the main renderer's `BrowserCameraService`, deliberately not wired out to avoid touching that code again); the doc's still-open question about masking identifying info on this screen. | None |
| 3.1 | ✅ | Local video "stream" recording, incl. true simultaneous multi-channel | Done: `capture_streams` table + `CaptureStreamRepository` (migration 006, real in-memory-SQLite-tested) mirror `upload_outbox`'s shape but with no upload/status/retry columns — recording never leaves the kiosk today (open question #3 is still open; this only implements the "local-only" half). `streams.ts` + `stream:start`/`stream:end` IPC write the file and close out the row (already generic — a new row per call, keyed by whatever `cameraId` is passed — so this needed zero changes for the multi-channel work below). **2026-08-31**: `FaceCaptureApp.tsx` now has two recording effects instead of one. The original single-stream effect (starts a `MediaRecorder` on whichever camera is currently active, independent of the capture/quality-gate logic) is now the **fallback**, used only when fewer than 2 physical cameras are mapped to roles — unchanged behavior for every single-camera site. A **new** effect takes over once ≥2 unique physical devices are mapped (CENTER/LEFT/RIGHT via §2.1's role mapping): it opens one dedicated `MediaStream` (raw `getUserMedia`, independent of `cameraServiceRef.current`) + `MediaRecorder` per physical camera at session start and keeps all of them rolling for the whole session, regardless of which one the CV pipeline has "active" for capture at any given step — this is the actual "true simultaneous 3-channel recording" gap this file previously listed as the top item still unbuilt. **Known, unmitigated risk**: when a mapped role's device is also the CV pipeline's currently-active device, that physical camera gets opened twice concurrently — the same kind of USB/driver contention §2.1 already documented hitting with even a single camera; not solved here, deliberately, to avoid touching the CV/capture pipeline. **Verification caveat (unchanged from before)**: no display/simulator was available to exercise either recording effect's real-browser `MediaRecorder`/multi-`getUserMedia` behavior live — both are verified only by static review and (for the DB layer) real passing tests. Needs a real ≥2-camera hardware test pass before either is trusted in production. | Camera role mapping (done) |
| 2.3 | ❌ | Student-info lookup API (`GET /v1/identify/lookup`) in `apps/api` | Not built. Would take `code` (+ optional disambiguation fields), call out to the external Admin system to resolve it, map the result to `FOUND`/`NOT_FOUND`/`AMBIGUOUS` (the `DUPLICATE` branch is a separate local check against Looka's own captured sessions, not this API). **Blocked**, same shape as §2.9/3.7: the Admin system's actual API/protocol isn't available yet. | Blocked on external protocol |

| 3.6b | ✅ | Campaign-configured 3–5 frames + simultaneous multi-camera capture (2026-09-04, `b4aa392`) | **Decided with the product owner**: frames are the campaign's `captureAngles` (3–5, FRONT always present), `simultaneousCapture` is a campaign flag set in the CMS, the kiosk shows the frames as a live grid on the capture screen, camera assignment stays in the kiosk's Camera Setup (now 5 roles: CENTER/LEFT/RIGHT/UP/DOWN), and a session **refuses to start** when any frame lacks a connected, distinct camera (`FramesBlockedPanel` lists what is missing and opens Camera Setup via the new `camera:openSetup` IPC). **Backend**: `campaigns.simultaneous_capture` (migration 1787700000000), `validateCaptureAngles` on create/update (count, exactly one FRONT, allowed roles, distinct effective roles when simultaneous — Vietnamese messages), field on campaign responses and `GET /v1/devices/config`. **Engine**: `WorkflowEngine.recordExternalCapture(stepId, imagePath)` marks a step COMPLETED through the normal bookkeeping and emits the same `capture-trigger`, so the existing store → review → approve → upload pipeline is unchanged; `advanceToNextStep` skips steps completed out of order. **Kiosk**: `packages/ui/src/lib/multiFrame.ts` (`framesForWorkflow`, `checkFramesReadiness`, `snapshotVideoFrame`), one raw stream per side frame, the CENTER frame stays the analysed camera; when the CENTER step captures, every other pending frame is snapshotted at that instant and recorded via `recordExternalCapture`; side-frame retakes snapshot immediately (no pose gate); multi-channel recording reuses the frame streams (no double-open in this mode). **Verified 2026-09-04**: API validation + device registration + device config round-trip against local Postgres (curl); 27/27 test tasks; and end to end from the *downloaded* activation zip on the Intel test Mac — installed from the dmg inside the zip, `activation.json` dropped next to the executable, device flipped to ACTIVATED on first config fetch, and the operator confirmed the "Chưa đủ camera cho chế độ chụp đồng thời" panel on session start (one camera, none mapped). **Not verifiable here**: the actual simultaneous shot needs ≥3 physical cameras. **Noted while testing**: each ad-hoc build is a new identity to TCC, so macOS asks for camera permission again per build (a Developer ID signature would persist the grant); on macOS the activation file must live inside `Looka.app/Contents/MacOS/`, which is awkward for an operator — consider also probing next to the `.app`; registration takes 47–85 s because the zip embeds the 240 MB installer. Resolves open questions #13 (toggle within the fixed 5, FRONT mandatory) and #14 (config applies next session). | 3.6, camera role mapping |

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
