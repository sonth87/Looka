# Implementation Plan — Phase 11: Capture-session list and per-campaign capture statistics in the CMS

Status: **IMPLEMENTED AND VERIFIED on 2026-09-06 (see §10) — changes are in the working tree, not yet committed.**
Scope owner: CMS + `apps/api` + kiosk reporting. Companion doc: `docs/photo-upload-storage-flow.md`.

## 1. What exists today (verified in code, commit `5ed11e3`)

| Capability | Status | Where |
|---|---|---|
| Per-campaign counters: devices, sessions completed, uploads OK/failed, retakes, CB Help | ✅ | `GET /v1/campaigns/:id/stats` (`DeviceEventService.campaignStats`), CMS `StatsPanel` on the campaign detail page |
| Cross-campaign totals + per-campaign table | ✅ | `GET /v1/campaigns/stats/summary`, CMS `StatsOverview` ("Tổng quan") |
| Kiosk → server reporting | ✅ counts only | `stats_event_outbox` (kiosk SQLite) → `POST /v1/devices/events` every 60 s → `device_events` (`type`, `occurred_at`, free `metadata`). Events sent: `SESSION_COMPLETED` (no metadata), `RETAKE` (no metadata), `UPLOAD_SUCCESS {jobId}`, `UPLOAD_FAILED {jobId}` (only on quarantine) |
| List of captured sessions per campaign / device | ❌ | no endpoint, no CMS page. Kiosk sessions never reach the server as records; the `session → fs_file_id` link lives only in the kiosk's local `upload_outbox` |
| Per-device breakdown, per-day series | ❌ | stats are grouped by campaign only |
| Viewing a captured photo from the CMS | ❌ | `POST /v1/photos/:id/view-link` exists but only for **web-path** photos (`sessions`/`photos` tables), and only with the API's own fs-core tenant key |
| Retaken (superseded) photos | ❌ stored today | kiosk approval (`UploadOutboxRepository.approveSession`) releases **every** attempt of the session, so a retake uploads both the rejected and the final shot; the web path uploads every attempt immediately |
| "Upload failed" counter accuracy | ❌ | kiosk reports `UPLOAD_FAILED` only for `quarantined`; a `FAILED_PERMANENT` job (quota, 4xx) is never counted |

Net: **statistics exist as bare counters; the list of captures does not exist; retakes are stored although they should not be.**

## 2. Decisions from the product owner (2026-09-06)

| # | Question | Decision | Consequence in this plan |
|---|---|---|---|
| 1 | Superseded attempts | **Not displayed and not stored — only the final photo of each step is kept** | Kiosk approval releases only the last attempt per step and deletes the others (row + local file). `SESSION_REPORT` carries final photos only. No `is_final` column needed. Web path aligned the same way (§6, A.4). |
| 2 | Thumbnails / bytes in Looka | **Bytes live only on the file server; Looka stores paths** | No thumbnail column, no image bytes in Postgres. The CMS shows photos through short-lived fs-core view links. |
| 3 | Who may open full-size photos | **Admin** | Every CMS admin-key holder; no extra permission layer. |
| 4 | Retention | **Photos stay on the file server, records can be kept continuously** | No retention job in Looka; `sessions`/`photos` rows are kept indefinitely. |
| 5 | List scope | **A list of capture sessions is enough** | One `SessionsPanel` inside the campaign detail page (kiosk sessions). No global page; web sessions have no campaign and are out of scope for the list. |

## 3. Design (final)

| # | Decision | Why |
|---|---|---|
| D1 | **One record store for both paths**: reuse `sessions` and `photos`; add `source` (`WEB`/`KIOSK`), `device_id`, `campaign_id`, kiosk timestamps and upload-state columns. Only final photos are ever written. | The web path already writes these tables; `GET /v1/sessions/:id/photos` and `view-link` already read them. One list, one stats query. |
| D2 | **Kiosk reports through the existing device-authenticated event channel** with two new event types carrying self-sufficient metadata: `SESSION_REPORT` (at approval, session + final photos) and `PHOTO_STATUS` (every upload outcome). The server **upserts**; duplicates are harmless. | No new transport, no new kiosk table, offline-safe (events wait in `stats_event_outbox`), idempotent by construction (`sessions.id` = kiosk session uuid, `photos` unique on `(session_id, step_id, attempt)`). |
| D3 | **Deterministic ids**: `sessions.id` = kiosk session uuid; `photos.id` = kiosk `jobId` (uuid5 of the idempotency key). | Stable ids across retries; `view-link` and CMS links never change. |
| D4 | **Full-size viewing via fs-core with the per-device tenant key**: `FileStorageService.clientForTenant(name)`; for a kiosk photo the tenant name is the device id; the key is obtained with the same idempotent `POST /api/v1/self-service/provision` the kiosk uses (it returns the existing key) and cached in memory. | Keys never leave the backend; no fs-admin whitelist. Requires the API host to be inside `FS_PROVISION_ALLOW_CIDR` (already required for its own tenant). |
| D5 | **Approval = keep the last attempt per step, drop the rest**: `approveSession()` approves rows with the highest `attempt` per `(kind, step_id)` and deletes the other rows of that session in the same SQLite transaction; the main process then unlinks their local files (best-effort). | Implements decision 1 without a schema change: the SQLite `status` CHECK has no "superseded" value, and a deleted row can never be picked up by `claimDue()`. The `RETAKE` counter event is unaffected. |
| D6 | Existing counter events keep flowing, and `UPLOAD_FAILED` is **also** emitted for `failed` (permanent) jobs. | Old kiosk builds keep working; retake / CB Help counters have no other source. |

## 4. Data model — one additive migration `apps/api/src/database/migrations/1787900000000-CaptureRecords.ts`

`sessions`
- `source` enum `sessions_source_enum ('WEB','KIOSK')` NOT NULL DEFAULT `'WEB'`
- `device_id uuid NULL` FK `devices(id)` ON DELETE SET NULL, index
- `campaign_id uuid NULL` FK `campaigns(id)` ON DELETE SET NULL, index `(campaign_id, captured_at DESC)`
- `captured_at timestamptz NULL` (kiosk clock, session start), `approved_at timestamptz NULL`
- `workflow_id varchar(100) NULL`

`photos`
- `step_type varchar(20) NULL`, `camera_role varchar(10) NULL`
- `captured_at timestamptz NULL`, `uploaded_at timestamptz NULL`, `ready_at timestamptz NULL`, `fs_status_at timestamptz NULL`
- `local_status varchar(20) NULL` (`PENDING|SENDING|UPLOADED|DONE|FAILED_PERMANENT`), `upload_error text NULL`
- `bytes > 0`, `sha256`, `mime_type` stay NOT NULL — both kiosk events carry them

`device_events`
- enum values `SESSION_REPORT`, `PHOTO_STATUS` added (raw event kept for audit)

Rollback: additive only; `down()` drops the columns and enum values.

## 5. Kiosk → server contract (`DeviceEventInput.metadata`)

`SESSION_REPORT` — enqueued by the main process inside `session:approveUpload` once `approveSession()` returned > 0; contains **only the approved (final) photos**:

```json
{
  "sessionId": "uuid", "startedAt": "ISO", "approvedAt": "ISO", "workflowId": "default",
  "subjectCode": null, "subjectName": null,
  "photos": [{
    "photoId": "uuid(jobId)", "stepId": "step-front", "stepType": "FRONT", "cameraRole": "CENTER",
    "attempt": 2, "mimeType": "image/jpeg", "sizeBytes": 231044, "sha256": "…",
    "virtualPath": "face/2026/<session>/step-front-2.jpg", "capturedAt": "ISO",
    "localStatus": "PENDING", "fsFileId": null, "fsStatus": null
  }]
}
```

`PHOTO_STATUS` — enqueued from `startUploads().onEvent` for `uploaded`, `ready`, `failed`, `quarantined`, looked up by `jobId` in the outbox so the event stands on its own:

```json
{ "sessionId": "uuid", "photoId": "uuid", "stepId": "…", "attempt": 2, "at": "ISO",
  "localStatus": "UPLOADED", "fsFileId": "…", "fsStatus": "SCANNING", "error": null,
  "mimeType": "image/jpeg", "sizeBytes": 231044, "sha256": "…", "virtualPath": "…",
  "stepType": "FRONT", "cameraRole": "CENTER" }
```

Server rules: `SESSION_REPORT` upserts the session (`source = KIOSK`, `status = COMPLETED`, `approved_at`) and every photo by `(session_id, step_id, attempt)`; `PHOTO_STATUS` creates the photo row when missing and updates status columns only if `at` ≥ stored `fs_status_at` (out-of-order safe). Both are idempotent, so the existing "duplicates are fine" transport stays.

## 6. Work breakdown

### Phase A — `apps/api` (≈ 2 days)

| # | File | Change |
|---|---|---|
| A.1 | `src/database/migrations/1787900000000-CaptureRecords.ts` | §4 |
| A.2 | `modules/capture/entities/session.entity.ts`, `photo.entity.ts`; `modules/device-management/entities/device-event.entity.ts`, `dto/create-device-events.dto.ts` | new columns, `SessionSource` enum, new event types; `metadata` stays free-form, validated per type in the service |
| A.3 | **new** `modules/capture/services/capture-report.service.ts` | `applySessionReport()`, `applyPhotoStatus()` as raw-SQL upserts (same style as `PhotoService.addPhoto`), payload validation with clear 400 messages; wired from `DeviceEventService.recordBatch()` inside the same transaction as the audit row |
| A.4 | `modules/capture/services/session.service.ts` (`completeSession`), `photo.service.ts`, `upload-worker.service.ts` | **web path aligned with decision 1**: Postgres `upload_outbox` gains `approved_at`; `claimNext()` requires it; `completeSession()` approves the highest attempt per step and deletes the other `photos` rows (cascade removes their outbox rows). Optional if `apps/web` is not deployed — strike this row to skip. |
| A.5 | **new** `modules/capture/dao/session-list.dao.ts` | `SessionListItemDao` (id, source, deviceId, deviceName, subjectCode/Name, status, capturedAt, completedAt, approvedAt, photoCount, photosReady, photosPending, photosFailed); `SessionDetailDao` (+ photos: id, stepId, stepType, cameraRole, attempt, fsFileId, fsStatus, localStatus, virtualPath, capturedAt) |
| A.6 | `modules/capture/controllers/session.controller.ts` | `GET /v1/sessions?campaignId&deviceId&from&to&state&page&limit` (admin key; `modules/shared/common/pagination.ts`), `GET /v1/sessions/:id` |
| A.7 | `modules/capture/controllers/photo.controller.ts`, `modules/file-storage/services/file-storage.service.ts` | `clientForTenant(tenantName)` with provisioning + cache; `POST /v1/photos/:id/view-link` resolves the tenant from the session's `device_id` (web photos keep the default tenant) |
| A.8 | `modules/device-management/services/device-event.service.ts`, `dao/campaign-stats.dao.ts` | `campaignStats()` gains `sessions`, `photos {total, ready, pending, failed}`, `byDevice[]` (deviceId, name, sessions, photosReady, photosFailed, lastCaptureAt), `byDay[]` (last 30 days, `Asia/Ho_Chi_Minh`) from `sessions`/`photos`; `allCampaignsStats()` gains the totals |
| A.9 | `modules/capture/capture-persistence.spec.ts` (extend, real Postgres via `TEST_DATABASE_URL`) | duplicate `SESSION_REPORT` → one session; `PHOTO_STATUS` before and after the report; stale status ignored; list filters + pagination; stats aggregation; (A.4) complete keeps only the last attempt |
| A.10 | Swagger (`common/swagger`), `ERROR_CODE` | new DAOs / params / errors |

### Phase B — kiosk `apps/desktop` + `packages/database` + `packages/ui` (≈ 2 days)

| # | File | Change |
|---|---|---|
| B.1 | `packages/database/src/repositories/UploadOutboxRepository.ts` (`approveSession`) | approve only `MAX(attempt)` per `(kind, step_id)`; delete the other rows of the session in the same transaction; return `{ approved, superseded: [{ id, localPath }] }` |
| B.2 | `apps/desktop/src/main/uploads.ts` (`approveSessionUpload`) + `index.ts` (`session:approveUpload`) | unlink superseded local files after commit (best-effort, logged); build `SESSION_REPORT` from the approved rows + the `steps` info the renderer sends (`stepType`, `cameraRole`, `capturedAt`); `recordStatsEvent('SESSION_REPORT', …)`; reply `{ ok, approved, superseded }` |
| B.3 | `apps/desktop/src/main/uploads.ts` (`startUploads().onEvent`) | emit `PHOTO_STATUS` for `uploaded` / `ready` / `failed` / `quarantined`; count `failed` as `UPLOAD_FAILED` (D6) |
| B.4 | `apps/desktop/src/main/statsEvents.ts` | tick 60 s → 15 s; cap a push at 50 events; keep "whole batch or retry" semantics |
| B.5 | `apps/desktop/src/preload/index.ts`, `packages/ui/src/lib/CaptureSink.ts`, `packages/ui/src/components/screens/FaceCaptureApp.tsx` (`onAccept`) | `approveUpload(sessionId, steps)` carries `stepId`, `stepType`, `cameraRole` (via `defaultCameraRoleForStepType`), `attempts`, `timestamp` from the completed session |
| B.6 | tests: `packages/database` outbox tests (approve keeps the last attempt, deletes the rest, idempotent second call), `apps/desktop/src/main/__tests__/sessionReport.test.ts` (report builder with a fake repo, same pattern as `streams.test.ts`), `packages/ui` CaptureSink tests updated for the new signature |

### Phase C — `apps/cms` (≈ 2 days)

| # | File | Change |
|---|---|---|
| C.1 | `src/api.ts` | `listSessions()`, `getSession()`, `issuePhotoViewLink()`, extended `CampaignStats` / `AllCampaignsStats` types |
| C.2 | **new** `src/components/SessionsPanel.tsx` | table on the campaign detail page: time, device, subject (when known), photos (n ready / n pending / n failed), state badge; filters (device, from/to, state); pagination; row → `SessionDetailDrawer` |
| C.3 | **new** `src/components/SessionDetailDrawer.tsx` | photo grid rendered from fs-core view links issued when the drawer opens (`<img src>` with the tokenised url, TTL 10 min, refreshed on expiry); role + attempt, fs-core status, "Mở ảnh gốc" (new tab), copy `fs_file_id`; placeholder while `SCANNING` / on `FAILED` |
| C.4 | `src/components/StatsPanel.tsx`, `StatsOverview.tsx` | tiles for photos ready / pending / failed; per-device table; per-day bars (plain CSS); totals on the overview |
| C.5 | `src/components/CampaignDetail.tsx` | mount `SessionsPanel` under `StatsPanel` |

### Phase D — verification and docs (≈ 1 day)

1. `pnpm --filter @face/api test` with `TEST_DATABASE_URL` (migrated), `pnpm --filter @face/database test`, `pnpm --filter @face/desktop test`, `pnpm --filter @face/ui test`, `pnpm build`.
2. Manual e2e on the Intel test Mac: run a session with one retake, approve → the kiosk keeps only the last attempt per step locally, the CMS lists the session within 15 s with the final photos; with fs-core reachable the status moves to READY and "Mở ảnh gốc" opens the image; with fs-core unreachable the rows show `PENDING`, then `FAILED_PERMANENT` after a 4xx.
3. Old kiosk build against the new API: counters still work, the list stays empty (show "kiosk chưa cập nhật" hint in the CMS).
4. Update `docs/ROADMAP.md` §2 (new row "3.4b Capture-session list, retakes not stored") and `docs/photo-upload-storage-flow.md` §2.1/§9 (items 2, 12, 14).

## 7. Risks and mitigations

- **Deleting superseded rows at approval** removes the local audit of retakes; the `RETAKE` counter event and the server-side `device_events` row keep the count. A retake that happens *after* approval cannot happen (the review modal is the last step).
- **Clock skew**: kiosk timestamps order events only; the server's `created_at` remains the receipt time.
- **Provisioning from the API** for per-device tenants fails with 403 when the API host is outside `FS_PROVISION_ALLOW_CIDR`; surfaced as `FILE_STORAGE_UPSTREAM_ERROR` with the tenant name in the log.
- **View links in `<img>`**: tokens expire after 10 min; the drawer re-issues links on a 401/expired image load. Links are issued only to admin-key holders (decision 3).
- **Kiosk attempt off-by-one** (ROADMAP §3): side frames report `attempt: 2` for a first shot; harmless for "highest attempt wins" but visible in the CMS. Fix separately in `FaceCaptureApp.tsx`.
- **Old kiosk builds** keep uploading every attempt until updated; the CMS shows whatever they report (counts only).

## 8. Estimate

Phase A 2 days · Phase B 2 days · Phase C 2 days · Phase D 1 day → about **7 developer-days**. A and B can run in parallel once §5 is fixed; C depends on A. Implementation is to be delegated to a Sonnet agent per the repo rules, with this document as the brief.

## 10. Verification record (2026-09-06)

Implemented by Sonnet agents (A/B/C/D1) under review; status of the plan: **DONE, not yet committed**.

| Check | Result |
|---|---|
| `apps/api` jest on real Postgres (`looka_phase11_test`) | 4 suites, 42 tests pass; `nest build` clean; migration `down()` round-tripped on a scratch DB |
| `packages/database` / `packages/ui` / `apps/desktop` node tests | 35 / 44 / 22 pass; `apps/desktop` vite + tsc build clean |
| `apps/cms` `tsc -b && vite build` | clean |
| API-level end-to-end (`e2e/run-e2e.sh`, mock fs-core in `e2e/mock-fs-core.mjs`) | 23/23 PASS — campaign + device, `SESSION_REPORT`, list/detail, `PHOTO_STATUS` ready/failed, idempotent resend + stale event ignored, stats incl. `byDevice`/`byDay`, view-link through the per-device tenant (mock log shows provision with `tenant_name` = device id and `X-Viewer-ID`), web path keeps only the last attempt and uploads once, 400/401 negatives. Full narrative: `e2e/results.md` |
| CMS in the browser against the e2e data | Overview tiles (Phiên chụp, Ảnh), campaign stats tiles + "Theo thiết bị" + "30 ngày gần nhất", "Phiên chụp" list with filters and badges, drawer: CENTER photo rendered from the fs-core view link (network: `view-link` 201 → image 200), LEFT photo shown as "Chưa upload lên file server" with `FAILED_PERMANENT`; "Mở ảnh gốc" opens the image; no new console errors |

Not verified here: a real kiosk session on hardware (approval pruning + `SESSION_REPORT` were exercised only by unit tests and the pure report builder), the real fs-core (SeaweedFS, ClamAV, quota), chunked uploads, multi-replica draining of the Postgres outbox.

Follow-ups noted during verification: the kiosk still has no UI for `FAILED_PERMANENT` retries or for entering the fs-core address (see `docs/photo-upload-storage-flow.md` §9 items 11–13); side-frame `attempt` off-by-one (ROADMAP §3) is visible in the CMS as "lần 2" on a first shot.
