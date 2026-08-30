# Device Management & Capture Pipeline Update — 2026-08-30

Summary of the code shipped in this update, for reference alongside
`ROADMAP.md` (which tracks ongoing status of every feature, not just what
changed here) and `plans/multi-camera-device-management-discussion.md` (the
design source these features implement).

## Backend (`apps/api`)

- **Device management module** (`src/modules/device-management`): `Campaign`
  and `Device` entities, device registration that streams back an activation
  zip (installer + `activation.json`), a device-credential-gated self-service
  config endpoint that doubles as the expiry check, and device event
  ingestion with per-campaign stats aggregation.
- **Routing bug fix**: `DeviceController`'s unconstrained `GET devices/:id`
  was shadowing `DeviceSelfController`'s `devices/config`/`devices/events`
  routes at both the Express router and `ApiKeyMiddleware` layers — every
  real kiosk request was rejected demanding an admin API key before ever
  reaching `DeviceCredentialsGuard`. Found via a live round-trip test against
  a real Postgres, not by any unit test. Fixed via controller registration
  order (`device-management.module.ts`) plus an explicit middleware
  `.exclude()` (`app.module.ts`).

## Desktop (`apps/desktop`)

- Imports the activation zip on first run; a dedicated camera-setup window
  for mapping CENTER/LEFT/RIGHT to physical cameras; local video-stream
  recording alongside captures; a read-only CB Help secondary display; a
  background worker pushing queued stats events to the admin backend.
- **24h fail-closed device access** (`deviceApi.ts`'s `getDeviceAccessStatus`):
  distinguishes a confirmed rejection (`401` — blocks immediately) from
  merely being unreachable (tolerated up to 24h since the last confirmed-good
  contact, persisted to disk via `secrets.ts` so a restart doesn't reset the
  clock). A kiosk with no device identity at all keeps failing open, same as
  before device management existed.
- **Per-device fs-core key**: self-provisioning now keys the fs-core tenant
  by `device.id` when this kiosk has one, so revoking one device only
  invalidates that device's own key.

## CMS (`apps/cms`)

New admin app — campaign list/create/edit, device registration with
activation-zip download, and a stats panel reading live event counts. Light
sidebar-layout theme, single shared admin API key in `localStorage`.

## Capture pipeline (`packages/*`)

- Camera-role mapping is consumed by the real capture pipeline: the active
  camera switches per step instead of requiring a head turn for LEFT/RIGHT.
- `captureMode`/`autoHoldMs` are read from the campaign config at every
  session start, falling back to this machine's local settings when a
  campaign hasn't set one.
- **Absolute face-resolution floor** (`FACE_RESOLUTION_TOO_LOW`, ≥250px):
  computed against the resolution the capture will actually be *saved* at,
  not the — possibly downscaled — analysis frame. Required
  `BrowserCameraService`/`MediaPipeCVEngine`/`StepEvaluator` changes to
  thread the camera's native resolution through to the quality gate.

## Verification

- Full monorepo build and test run clean from a cold cache (0 cached, all
  tasks re-executed): 27/27 test tasks pass.
- Live round-trip against a real Postgres: created a campaign, registered
  devices through both the CMS UI and a direct API call, fetched a device's
  config with its real credentials, pushed real stats events, edited
  campaign settings, and watched the CMS stats panel update from the real
  numbers.

## Known gaps (see `ROADMAP.md` for the full, maintained list)

- True simultaneous multi-channel recording — today the pipeline switches
  which single camera is active per step, rather than recording all three at
  once.
- KYC enrollment (§3.7) — blocked on the external system's protocol.
- 3.1's video recording has no real-browser `MediaRecorder` test pass yet (no
  display/simulator was available in this environment).
