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
| 2 — Drop CDN, bundle WASM | 🟡 | `SQLiteStorageAdapter.ts` no longer points at `sql.js.org` — but `apps/web` doesn't import it at all yet, and the wasm asset was never copied into `apps/web/public`. Doc's own verification ("unplug network, open web app, DB still initializes") can't currently pass. |
| 3 — Remove silent no-op mode | ✅ | No `memoryStore` fallback anywhere; init failures throw / log loudly instead of pretending success. Minor gap: desktop doesn't hard-block the kiosk UI on DB init failure, just disables uploads. |
| 4 — Transaction for attendance write | ✅ | `AttendanceRepository.recordAttendance()` wraps both inserts in one sync transaction. |
| 5 — `getStatus` must check real state | 🟡 | `dbConnected`/`dbPath`/`dbSizeBytes`/`pendingSync` are now real. Missing: no `lastWriteAt`, and no AI-service reachability check (only file-service ping exists). |

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
| 15 — Versioned threshold config | ❌ | `ThresholdPolicy` is still a hardcoded switch on security level; `policyVersion` is still just the level name (e.g. `'BALANCED'`), not an actual version — exactly the bug originally described. No audit-on-change either. |
| 16 — Attendance business rules | 🟡 | Active-person check, per-type cooldown/dedup, and the 4am business-day boundary are all correct. Missing: no pinned timezone (`Asia/Ho_Chi_Minh`) — `businessDayOf()` resolves in the host process's local time, which will silently break if a kiosk's OS clock/timezone isn't set correctly. |
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
| 3.3 | 🟡 | Two-layer expiry blocking + kiosk↔backend connectivity | **Web flow**: `DeviceExpiryMiddleware` in `apps/api`, pass-through when no device headers sent (no client sends them yet — see its own doc comment), checks `campaigns.expires_at` via `DeviceService.verifyCredentials` when present. **Kiosk self-service**: `GET /v1/devices/config` (`DeviceCredentialsGuard`, `x-device-id`/`x-device-secret`) doubles as the expiry check — an expired/invalid device gets `401` instead of a config. First successful call flips a device `REGISTERED` → `ACTIVATED`. **Stats-event push now done** — see the new row below. **Not done**: the originally-designed ~24h fail-closed cache for kiosk offline resilience (current cache is a simple 15-min soft TTL, not tied to a fail-closed policy); per-kiosk fs-core key issuance (still 1 shared key). | 3.2 |
| 3.4 | ✅ | Event log + stats (the rest of §3.4) | **Backend**: `DeviceEvent` entity/migration (`device_events`, campaign_id denormalized), `DeviceEventService.recordBatch`/`campaignStats`, `POST /v1/devices/events` (device-authenticated batch ingest, `DeviceSelfController`) and `GET /v1/campaigns/:id/stats` (admin-key gated) — counts only, no dedup/idempotency (see the service's own doc comment for why that's an acceptable trade for a number nobody acts on). **Kiosk**: `stats_event_outbox` (packages/database, migration 007, real in-memory-SQLite-tested) — much simpler than `upload_outbox` on purpose (no backoff schedule, no dependency chain); `statsEvents.ts` polls every 60s and pushes whatever's `PENDING`, leaving it untouched on failure for the next tick. **Wired to real triggers**: `SESSION_COMPLETED` fires from `onAccept` (the true confirm-and-approve moment, not merely reaching the last step); `RETAKE` from `handleRestart`; `UPLOAD_SUCCESS`/`UPLOAD_FAILED` from the existing `UploadWorker` event stream (mapped from `'uploaded'`/`'quarantined'` only — transient retries are deliberately not counted). `CB_HELP_INTERVENTION` has no trigger yet (no UI surface for it exists — open question §4 #16) and will always read zero, correctly. **CMS**: `StatsPanel` on the campaign detail page, stat tiles pulling from the new endpoint. | 3.2, 3.4 (CMS) |
| 3.4 | 🟡 | Admin portal | Backend built inside `apps/api` (monorepo, not a separate service yet — split out later): Campaign/Device CRUD + zip issuance (`CampaignController`, `DeviceController`, `DeviceSelfController`). **Frontend**: `apps/cms` (React 19 + Vite + Tailwind 4, no router — the two views are small enough for plain state), light/white admin theme throughout (sidebar layout, gray-50/white/gray-900 palette). One shared admin `x-api-key` (matches the server's actual auth model — no per-user login exists to build a real one against), entered once and kept in `localStorage`. Campaign list + create form; campaign detail with an edit form (expiry/consent/capture mode), a device panel (list + register-and-download-zip, using the real `Content-Disposition` filename), and now a `StatsPanel` reading the live event counts from `GET /v1/campaigns/:id/stats` (see 3.4 event-log row above). Live-verified in-browser (screenshots, form submit, graceful error display on an unreachable API) — real, working UI, unlike the Electron pieces this pass couldn't run. **Not built**: audit trail for extend/expire actions, and the actual create/edit/stats round-trip against a real Postgres (no instance available in this environment — the UI's request/response handling was verified, not a live save). | 3.4 (event-log) |
| 3.8 | ✅ | Capture trigger mode (AUTO/MANUAL) as a campaign setting | Product defaults to click-to-capture (`settingsStore.ts`, with a migration for pre-existing installs). `WorkflowEngine`'s own class-level default deliberately stays `AUTO` — that's the library's base contract its test suite assumes; the product-level default is what actually governs the shipped app. **Not done**: reading `captureMode`/`autoHoldMs` from the campaign config into the engine — `campaigns.capture_mode`/`auto_hold_ms` columns exist and are returned by `GET /v1/devices/config`, but `FaceCaptureApp.tsx` doesn't consume them yet (deliberately deferred — the trigger-mode code path has a history of subtle bugs per its own comments, not touched further without being able to run the app to verify). | 3.2 |
| 3.7 | ❌ | KYC/FaceID enrollment as a campaign purpose | Not built. `campaigns.purpose` enum (`STUDENT_CARD`/`KYC_ENROLLMENT`) exists in the schema; nothing reads it yet to change capture-angle defaults or route captured data anywhere but fs-core. Still blocked on the external KYC/AI Vision system's protocol either way (§2.9). | 3.2, 3.6 |
| — | ✅ | Camera role mapping (CENTER/LEFT/RIGHT ↔ physical device) | Done: a dedicated window (`Ctrl/Cmd+Shift+K`, `cameraSetupWindow.ts` → `CameraSetupScreen.tsx`) opens a live preview for every detected camera at once and a per-device CENTER/LEFT/RIGHT dropdown (each role held by at most one device at a time); saved via `secrets.dat` (`camera.roleMapping`, JSON) through new `camera:getRoleMapping`/`camera:setRoleMapping` IPC. Deliberately a standalone window rather than a panel on the kiosk screen or the CB Help display — where a CB-Help-only surface belongs in the main window is still open (§4 #16), and the CB Help display is read-only by its own decision (§3.5). **Now consumed** by the capture pipeline — see the updated 3.1 row below. | — |
| — | ✅ | Capture pipeline reads the camera role mapping (no head-turn for LEFT/RIGHT) | **Decided 2026-08-30**: LEFT/RIGHT capture triggers stay manual-click, same as §3.8; the product decision is that the subject looks straight ahead and a side camera captures the angle instead of turning their head, when one is mapped. Implemented as one new, self-contained `useEffect` in `FaceCaptureApp.tsx` that switches the *active* camera stream on step change by calling the existing `handleSelectCamera()` (the same `camera.start({ deviceId })` the manual camera picker already uses) — `WorkflowEngine`/`StepEvaluator`/`CaptureController`/`BrowserCameraService` are completely untouched, deliberately, given this codebase's own documented history of subtle capture-trigger bugs. FRONT/UP/DOWN stay on the CENTER camera (no "up"/"down" camera exists — those two steps still need a head tilt). No mapping configured (today's common case) → this effect never fires, identical to current behavior. **Known gap**: `defaultWorkflow`'s LEFT/RIGHT pose targets are still tuned for head-turning (±22.5° yaw) — a site with real side cameras and "look straight ahead" behavior needs its campaign's `captureAngles` (§3.6) to override those targets to something like `yaw: 0`, or the pose gate will still ask for an unnecessary head turn even though the correct camera is now active. This is a config change on that site's campaign, not new code. | Camera role mapping |
| 3.5 | ✅ | Secondary read-only display for CB Help | Done: `cbHelpWindow.ts` opens a second `BrowserWindow` on whichever display isn't the kiosk's own (`screen.getAllDisplays()`), loading the same renderer bundle at `#cb-help` (`main.tsx` branches on the hash — no second Vite entry needed) into `CbHelpMonitor.tsx`. `capture:queue`'s handler broadcasts every capture to it; `FaceCaptureApp.tsx` reports the active workflow's steps at session start via `notifyCbHelpSessionStarted`. **Not done**: camera alive/dead status (that state lives in the main renderer's `BrowserCameraService`, deliberately not wired out to avoid touching that code again); the doc's still-open question about masking identifying info on this screen. | None |
| 3.1 | ✅ | Local video "stream" recording | Done: `capture_streams` table + `CaptureStreamRepository` (migration 006, real in-memory-SQLite-tested) mirror `upload_outbox`'s shape but with no upload/status/retry columns — recording never leaves the kiosk today (open question #3 is still open; this only implements the "local-only" half). `streams.ts` + `stream:start`/`stream:end` IPC write the file and close out the row. `FaceCaptureApp.tsx` has a new, self-contained `useEffect` (independent of the capture/quality-gate logic) that starts a `MediaRecorder` on the current camera stream when a session is running and saves it on stop. Records whichever camera is currently active — since the pipeline now switches the active camera per step (see the row above), a full session's recording is really 1-3 separate clips (one per camera actually used), not 3 simultaneous streams recorded together. True simultaneous 3-channel recording (all cameras rolling at once, not just whichever is active) is still not built. **Verification caveat**: this specific piece (real-browser `MediaRecorder` behavior) could not be exercised live — no display/simulator available — unlike the DB layer, which has real passing tests. | Camera role mapping (done) |
| 2.3 | ❌ | Student-info lookup API (`GET /v1/identify/lookup`) in `apps/api` | Not built. Would take `code` (+ optional disambiguation fields), call out to the external Admin system to resolve it, map the result to `FOUND`/`NOT_FOUND`/`AMBIGUOUS` (the `DUPLICATE` branch is a separate local check against Looka's own captured sessions, not this API). **Blocked**, same shape as §2.9/3.7: the Admin system's actual API/protocol isn't available yet. | Blocked on external protocol |

**What's actually left, in order:** true simultaneous multi-channel
capture/recording (today the pipeline switches which single camera is
active per step — see the row above — rather than running all three at
once) → the 24h-fail-closed device-status cache 3.3 was originally designed
with (today it's a plain 15-min soft cache) → per-kiosk fs-core keys (still
1 shared key) → campaign-driven `captureMode`/`autoHoldMs` into the engine
(3.8's remaining half — deliberately deferred, see that row's notes) → KYC
enrollment (3.7, still blocked on an external protocol either way). 3.1's
video recording and the CMS's create/edit/stats round-trip should both get a
real-environment test pass (MediaRecorder in an actual browser/Electron
window; the CMS against a live Postgres) before either is trusted in
production — both were only verified by static review, unit/integration
tests, and (for the CMS) live-browser UI testing against an intentionally
unreachable API, not an end-to-end run.

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

- **Face resolution <250×250px** (discussion doc §2.8): `QualityEvaluator`
  only checks a relative ratio, not absolute pixel size — a real gap in the
  *current* single-camera 5-angle flow, not just future multi-camera design.
  Independent of everything else here; safe to fix now.
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
