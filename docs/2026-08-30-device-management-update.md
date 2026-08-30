# Session Report — 2026-08-30

What was asked for and what was delivered in this session, end to end. For
ongoing feature-by-feature status (including everything still open), see
`ROADMAP.md` — this file is a one-time record of the session, not a tracker.

## 1. What was asked

In order:

1. Review the code/docs changes on branch `sontt`, evaluate the project, and
   summarize a docs file pushed 3 days earlier — to discuss further.
2. Read the newly-added design docs more deeply for a clearer analysis.
3. Inventory every feature planned in `FIX-PLAN.md` and the multi-camera
   design discussion, then extend that inventory: re-verify FIX-PLAN's 20
   steps against the actual code (not just trust its own checkboxes), add
   effort estimates for the multi-camera features, and create a persistent
   tracking file.
4. Iteratively refine the multi-camera device-management design
   (`plans/multi-camera-device-management-discussion.md`) through many
   rounds: CMS-first device registration, activation-code/zip packaging, a
   campaign concept grouping devices with campaign-level expiry, KYC/FaceID
   as a campaign purpose, capture-trigger-mode as a campaign setting —
   explicitly without bloating the doc with changelog-style callouts.
5. Build everything the design unblocked, continuously, inside `apps/api`
   (the existing monorepo package, not a new service) using NestJS.
6. In sequence: §3.5 (CB-Help secondary display) → §3.1 (local video
   recording) → camera-role mapping (CENTER/LEFT/RIGHT ↔ physical camera) →
   wiring the real capture pipeline to that mapping → a real CMS frontend,
   built to an admin-CMS design standard, light/white theme → the
   stats/event-log feature (backend ingestion, desktop queue, CMS display).
7. Set up the backend database against a real local Postgres instance.
8. Produce a status table: what the system has and doesn't have yet.
9. Finish the four items that table showed as partial: device-expiry
   fail-closed cache + per-device fs-core key, the CMS admin page's Postgres
   round-trip, campaign-driven AUTO/MANUAL capture mode, and the minimum
   face-resolution check.
10. Write a document, in this `docs/` folder, covering what this session
    needed to do and managed to do.

## 2. What was delivered

### Docs & tracking
- `ROADMAP.md` — created and kept current throughout: FIX-PLAN's 20 steps
  re-verified against real code (12 done / 3 partial / 5 not done, further
  along than the original snapshot credited), plus every multi-camera
  feature with real status, key work, and dependencies.
- `plans/multi-camera-device-management-discussion.md` — extended across
  device registration, campaign concept, expiry, event log, KYC purpose, and
  capture-trigger-mode sections, replacing content in place rather than
  layering changelog callouts on top.

### Backend (`apps/api`)
- `src/modules/device-management`: `Campaign`/`Device`/`DeviceEvent`
  entities and migrations, campaign and device CRUD, device registration
  that streams back an activation zip (installer + `activation.json`), a
  device-credential-gated self-service config endpoint that doubles as the
  §3.3 expiry check, and device event ingestion with per-campaign stats
  aggregation.
- Fixed a real routing bug found via live testing: `DeviceController`'s
  unconstrained `GET devices/:id` was shadowing the device self-service
  routes at both the Express router and `ApiKeyMiddleware` layers, so every
  real kiosk request was rejected demanding an admin key before ever
  reaching `DeviceCredentialsGuard`.
- Local Postgres wired up end to end (`DATABASE_URL`, migrations run,
  verified with `psql`).

### Desktop (`apps/desktop`)
- Imports the activation zip on first run; a dedicated camera-setup window
  mapping CENTER/LEFT/RIGHT to physical cameras with live per-camera
  preview; local video-stream recording alongside captures; a read-only
  CB Help secondary display (extended-monitor window); a background worker
  pushing queued stats events to the admin backend, mirroring the existing
  upload-outbox queue-and-retry pattern (deliberately simpler — no
  idempotency key).
- 24h fail-closed device access: a confirmed rejection (`401`) blocks
  immediately, while being merely unreachable is tolerated up to 24h since
  the last confirmed-good contact (persisted to disk, survives restarts);
  past that, capture is refused with a blocking screen instead of silently
  falling back to defaults. A kiosk with no device identity at all still
  fails open, unchanged from before device management existed.
- Per-device fs-core key: self-provisioning now keys the fs-core tenant by
  device id when one exists, so revoking a device only invalidates that
  device's own key.

### CMS (`apps/cms`)
New admin app: campaign list/create/edit, device registration with
activation-zip download, and a stats panel reading live event counts.
Sidebar layout, light/white theme throughout, single shared admin API key.
Round-trip verified live against the real Postgres instance: created a
campaign, registered devices through both the UI and a direct API call,
fetched a device's config with real credentials, pushed real stats events,
edited campaign settings, watched the stats panel update from real numbers.

### Capture pipeline (`packages/*`)
- Camera-role mapping is consumed by the real pipeline: the active camera
  switches per step instead of requiring a head turn for LEFT/RIGHT.
- `captureMode`/`autoHoldMs` are read from the campaign config at every
  session start, falling back to this machine's local settings otherwise.
- Absolute face-resolution floor (`FACE_RESOLUTION_TOO_LOW`, ≥250px),
  computed against the resolution a capture is actually *saved* at rather
  than the possibly-downscaled analysis frame — required threading the
  camera's native resolution through `BrowserCameraService` →
  `MediaPipeCVEngine` → `StepEvaluator`.

### Verification
- Full monorepo build and test run clean from a cleared cache (0 cached, 27
  test tasks re-executed, all passing) — this specifically caught a second
  real bug (`MockCVEngine`'s mock quality object missing the two new
  required fields) that a stale cache had been masking.
- Live round-trip testing via the browser (CMS) and `curl` (device
  self-service API) against the real Postgres instance, not mocks.
- All work committed on `claude/project-review-docs-update-ed2c06` and
  merged into the main checkout's `sontt` branch after each verified batch.

## 3. What's still open

Tracked in `ROADMAP.md`, not repeated in full here. The two items that
remain genuinely unbuilt as of this session:
- True simultaneous multi-channel recording — the pipeline switches which
  single camera is active per step; it does not record all three at once.
- KYC/FaceID enrollment (§3.7) — blocked on the external system's protocol,
  which was never made available during this session.
