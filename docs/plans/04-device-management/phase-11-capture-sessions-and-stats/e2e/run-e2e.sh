#!/usr/bin/env bash
# Phase 11 D1 — end-to-end verification at the API level.
#
# Exercises apps/api's kiosk-report contract (SESSION_REPORT/PHOTO_STATUS),
# the sessions/stats read side, the fs-core view-link path, and the web
# capture path, against a real Postgres and a mock fs-core (mock-fs-core.mjs
# in this same directory). See README.md in this directory for how to
# (re-)run this, and docs/plans/04-device-management/phase-11-capture-sessions-and-stats/implementation-plan.md
# for the contract this asserts against.
#
# Does NOT touch apps/cms, apps/desktop, packages/*, or docs/. Only starts
# processes it also stops before exiting (trap below). Leaves rows it wrote
# in the dev DB (harmless, ids are printed at the end).
set -uo pipefail
# Deliberately no `set -e`: a failed assertion should be recorded and the
# script should keep going through the rest of the scenario, not abort.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="/Users/apple/Son/Work/DaiNam/camera-service/Looka"
API_DIR="$REPO_ROOT/apps/api"
ENV_FILE="$API_DIR/.env"

MOCK_PORT="${MOCK_FS_PORT:-8999}"
API_PORT="${API_PORT:-3100}"
API_BASE="http://localhost:$API_PORT"
MOCK_BASE="http://localhost:$MOCK_PORT"

LOG_DIR="$SCRIPT_DIR/logs"
mkdir -p "$LOG_DIR"
MOCK_LOG="$LOG_DIR/mock-fs-core.log"
API_LOG="$LOG_DIR/api.log"
RUN_LOG="$LOG_DIR/run-e2e.log"
: > "$RUN_LOG"

log() { echo "$*" | tee -a "$RUN_LOG"; }
section() { log ""; log "=== $* ==="; }

# ---- read what we need from apps/api/.env, without ever printing secrets ----
env_get() { grep -E "^$1=" "$ENV_FILE" | head -1 | cut -d'=' -f2-; }
API_KEY="$(env_get API_KEY)"
DATABASE_URL="$(env_get DATABASE_URL)"
if [ -z "$API_KEY" ] || [ -z "$DATABASE_URL" ]; then
  echo "FATAL: could not read API_KEY / DATABASE_URL from $ENV_FILE"
  exit 1
fi

# ---- bookkeeping ----
PASS_COUNT=0
FAIL_COUNT=0
declare -a RESULT_LINES=()
declare -a CREATED_IDS=()

record() {
  local step="$1" status="$2" detail="$3"
  RESULT_LINES+=("$step|$status|$detail")
  log "[$status] $step - $detail"
  if [ "$status" = "PASS" ]; then PASS_COUNT=$((PASS_COUNT+1)); else FAIL_COUNT=$((FAIL_COUNT+1)); fi
}

note_id() { CREATED_IDS+=("$1: $2"); }

# HTTP helper. Sets HTTP_STATUS and HTTP_BODY. Usage:
#   http_call METHOD URL [JSON_BODY] [HEADER]...
http_call() {
  local method="$1" url="$2" data="${3:-}"
  shift; shift; [ $# -gt 0 ] && shift
  local -a curl_args=(-s -w '\n%{http_code}' -X "$method" "$url")
  local h
  for h in "$@"; do curl_args+=(-H "$h"); done
  if [ -n "$data" ]; then
    curl_args+=(-H 'Content-Type: application/json' --data-binary "$data")
  fi
  local raw
  raw="$(curl "${curl_args[@]}" 2>>"$RUN_LOG")"
  HTTP_STATUS="$(printf '%s' "$raw" | tail -1)"
  HTTP_BODY="$(printf '%s' "$raw" | sed '$d')"
}

jd() { printf '%s' "$HTTP_BODY" | jq -r "$1" 2>/dev/null; }

now_iso() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }
new_uuid() { uuidgen | tr 'A-Z' 'a-z'; }
sha_of() { printf '%s' "$1" | shasum -a 256 | awk '{print $1}'; }

# NOTE: psql -t -A suppresses the SELECT row-count footer, but NOT the
# command completion tag of a data-modifying statement (e.g. "INSERT 0 1",
# "DELETE 2") - that tag is printed on its own line even under -t/-A, RETURNING
# or not. `head -1` keeps this safe for scalar SELECTs (only ever one line
# anyway) and for INSERT...RETURNING (keeps the returned value, drops the tag).
psql_scalar() { psql "$DATABASE_URL" -t -A -v ON_ERROR_STOP=1 -c "$1" 2>>"$RUN_LOG" | head -1 | tr -d '[:space:]'; }
psql_run() { psql "$DATABASE_URL" -t -A -v ON_ERROR_STOP=1 -c "$1" 2>>"$RUN_LOG"; }

MOCK_PID=""
API_PID=""
cleanup() {
  section "cleanup"
  if [ -n "$API_PID" ]; then
    log "stopping api pid=$API_PID"
    kill "$API_PID" 2>/dev/null
  fi
  if [ -n "$MOCK_PID" ]; then
    log "stopping mock fs-core pid=$MOCK_PID"
    kill "$MOCK_PID" 2>/dev/null
  fi
  sleep 1
  [ -n "$API_PID" ] && kill -9 "$API_PID" 2>/dev/null
  [ -n "$MOCK_PID" ] && kill -9 "$MOCK_PID" 2>/dev/null
  # also sweep by port in case pnpm spawned a child with a different pid
  local pid
  for pid in $(lsof -nP -iTCP:"$API_PORT" -sTCP:LISTEN -t 2>/dev/null); do kill -9 "$pid" 2>/dev/null; done
  for pid in $(lsof -nP -iTCP:"$MOCK_PORT" -sTCP:LISTEN -t 2>/dev/null); do kill -9 "$pid" 2>/dev/null; done
  sleep 1
  log "port $API_PORT listeners: $(lsof -nP -iTCP:"$API_PORT" -sTCP:LISTEN 2>/dev/null | wc -l | tr -d ' ')"
  log "port $MOCK_PORT listeners: $(lsof -nP -iTCP:"$MOCK_PORT" -sTCP:LISTEN 2>/dev/null | wc -l | tr -d ' ')"
}
trap cleanup EXIT

# =============================================================================
section "startup: mock fs-core"
# =============================================================================
node "$SCRIPT_DIR/mock-fs-core.mjs" "$MOCK_PORT" > "$MOCK_LOG" 2>&1 &
MOCK_PID=$!
log "mock fs-core pid=$MOCK_PID, log=$MOCK_LOG"

mock_ready=0
for _ in $(seq 1 20); do
  code="$(curl -s -o /dev/null -w '%{http_code}' "$MOCK_BASE/healthz" 2>/dev/null)"
  if [ "$code" = "200" ]; then mock_ready=1; break; fi
  sleep 0.5
done
if [ "$mock_ready" != "1" ]; then
  log "FATAL: mock fs-core did not become ready"; tail -50 "$MOCK_LOG" | tee -a "$RUN_LOG"; exit 1
fi
log "mock fs-core is ready"

# =============================================================================
section "startup: apps/api"
# =============================================================================
# Built once and run as a single `node dist/main.js` process (cwd=apps/api,
# so `dotenv/config` picks up apps/api/.env) rather than `start:dev`'s
# pnpm->nest->webpack process tree, which is unreliable to fully tear down
# from a PID captured with `$!` (the child that actually binds the port
# survives a kill of the top-level pnpm process). A plain node process is
# one PID, trivially killed, and this build doubles as an early check that
# the code actually compiles before step k re-confirms it at the end.
cd "$API_DIR"
pnpm build > "$LOG_DIR/build-initial.log" 2>&1
build_initial_exit=$?
if [ "$build_initial_exit" != "0" ]; then
  log "FATAL: initial 'pnpm --filter @face/api build' failed (exit $build_initial_exit)"
  tail -150 "$LOG_DIR/build-initial.log" | tee -a "$RUN_LOG"
  exit 1
fi
log "initial build OK"

node dist/main.js > "$API_LOG" 2>&1 &
API_PID=$!
cd "$REPO_ROOT"
log "api pid=$API_PID, log=$API_LOG"

api_ready=0
for _ in $(seq 1 60); do
  code="$(curl -s -o /dev/null -w '%{http_code}' -H "x-api-key: $API_KEY" "$API_BASE/v1/campaigns" 2>/dev/null)"
  if [ "$code" = "200" ]; then api_ready=1; break; fi
  sleep 2
done
if [ "$api_ready" != "1" ]; then
  log "FATAL: apps/api did not become ready on port $API_PORT"
  tail -150 "$API_LOG" | tee -a "$RUN_LOG"
  exit 1
fi
log "apps/api is ready on $API_BASE"

# =============================================================================
section "step a: create campaign"
# =============================================================================
CAMPAIGN_NAME="Phase11 D1 E2E $(date -u +%Y%m%dT%H%M%SZ)"
campaign_payload=$(jq -nc --arg name "$CAMPAIGN_NAME" '{
  name: $name,
  description: "Automated Phase D1 end-to-end verification (safe to delete)",
  purpose: "STUDENT_CARD",
  captureAngles: [
    {id: "step-front", type: "FRONT", cameraRole: "CENTER", instruction: "Nhin thang vao camera"},
    {id: "step-left", type: "LEFT", cameraRole: "LEFT", instruction: "Quay mat sang trai"}
  ],
  simultaneousCapture: false,
  recordVideo: false
}')
http_call POST "$API_BASE/v1/campaigns" "$campaign_payload" "x-api-key: $API_KEY"
log "POST /v1/campaigns -> $HTTP_STATUS"
log "$HTTP_BODY"
CAMPAIGN_ID="$(jd '.data.id')"
if [ "$HTTP_STATUS" = "201" ] && [ -n "$CAMPAIGN_ID" ] && [ "$CAMPAIGN_ID" != "null" ]; then
  record "a. create campaign" PASS "201, id=$CAMPAIGN_ID"
  note_id "campaign" "$CAMPAIGN_ID"
else
  record "a. create campaign" FAIL "status=$HTTP_STATUS body=$HTTP_BODY"
fi

# =============================================================================
section "step b: create device (direct DB insert) + confirm GET /v1/devices/config"
# =============================================================================
DEVICE_SECRET="$(openssl rand -hex 32)"
DEVICE_SECRET_HASH="$(sha_of "$DEVICE_SECRET")"
DEVICE_NAME="phase11-e2e-kiosk"
# Note: psql's `-c` does NOT perform `:'var'` interpolation in this
# environment (verified: it works via -f/stdin but not -c). Values here are
# script-controlled (a fixed device name, a hex hash, UUIDs from uuidgen /
# the API's own JSON response) with no quote characters, so direct bash
# interpolation into the SQL text is safe for this internal test harness.
DEVICE_ID="$(psql "$DATABASE_URL" -t -A -v ON_ERROR_STOP=1 \
  -c "INSERT INTO devices (campaign_id, name, device_secret_hash, status) VALUES ('$CAMPAIGN_ID', '$DEVICE_NAME', '$DEVICE_SECRET_HASH', 'ACTIVATED') RETURNING id;" \
  2>>"$RUN_LOG" | head -1 | tr -d '[:space:]')"
log "inserted device id=$DEVICE_ID (name=$DEVICE_NAME)"
if [ -n "$DEVICE_ID" ]; then
  note_id "device" "$DEVICE_ID"
  http_call GET "$API_BASE/v1/devices/config" "" "x-device-id: $DEVICE_ID" "x-device-secret: $DEVICE_SECRET"
  log "GET /v1/devices/config -> $HTTP_STATUS"
  log "$HTTP_BODY"
  cfg_id="$(jd '.data.id')"
  if [ "$HTTP_STATUS" = "200" ] && [ "$cfg_id" = "$CAMPAIGN_ID" ]; then
    record "b. create device + GET /v1/devices/config" PASS "200, campaign id matches ($cfg_id)"
  else
    record "b. create device + GET /v1/devices/config" FAIL "status=$HTTP_STATUS body=$HTTP_BODY"
  fi
else
  record "b. create device + GET /v1/devices/config" FAIL "device insert failed, see $RUN_LOG"
fi

# =============================================================================
section "step c: kiosk SESSION_REPORT"
# =============================================================================
SESSION_ID="$(new_uuid)"
PHOTO1_ID="$(new_uuid)"   # step-front / CENTER / attempt 2
PHOTO2_ID="$(new_uuid)"   # step-left / LEFT / attempt 1
PHOTO1_SHA="$(sha_of "photo1-$SESSION_ID")"
PHOTO2_SHA="$(sha_of "photo2-$SESSION_ID")"
VP1="face/2026/$SESSION_ID/step-front-2.jpg"
VP2="face/2026/$SESSION_ID/step-left-1.jpg"

STARTED_AT="$(now_iso)"
sleep 1
APPROVED_AT="$(now_iso)"

session_report_metadata=$(jq -nc \
  --arg sessionId "$SESSION_ID" --arg startedAt "$STARTED_AT" --arg approvedAt "$APPROVED_AT" \
  --arg p1 "$PHOTO1_ID" --arg p1sha "$PHOTO1_SHA" --arg vp1 "$VP1" \
  --arg p2 "$PHOTO2_ID" --arg p2sha "$PHOTO2_SHA" --arg vp2 "$VP2" \
  '{
    sessionId: $sessionId, startedAt: $startedAt, approvedAt: $approvedAt,
    workflowId: "default", subjectCode: null, subjectName: null,
    photos: [
      {photoId: $p1, stepId: "step-front", stepType: "FRONT", cameraRole: "CENTER", attempt: 2,
       mimeType: "image/jpeg", sizeBytes: 231044, sha256: $p1sha, virtualPath: $vp1,
       capturedAt: $approvedAt, localStatus: "PENDING", fsFileId: null, fsStatus: null},
      {photoId: $p2, stepId: "step-left", stepType: "LEFT", cameraRole: "LEFT", attempt: 1,
       mimeType: "image/jpeg", sizeBytes: 198234, sha256: $p2sha, virtualPath: $vp2,
       capturedAt: $approvedAt, localStatus: "PENDING", fsFileId: null, fsStatus: null}
    ]
  }')
session_report_events_payload=$(jq -nc --argjson meta "$session_report_metadata" --arg occurredAt "$APPROVED_AT" \
  '{events: [{type: "SESSION_REPORT", occurredAt: $occurredAt, metadata: $meta}]}')

http_call POST "$API_BASE/v1/devices/events" "$session_report_events_payload" "x-device-id: $DEVICE_ID" "x-device-secret: $DEVICE_SECRET"
log "POST /v1/devices/events (SESSION_REPORT) -> $HTTP_STATUS"
log "$HTTP_BODY"
accepted="$(jd '.data.accepted')"
if [ "$HTTP_STATUS" = "202" ] && [ "$accepted" = "1" ]; then
  record "c. SESSION_REPORT" PASS "202, accepted=1 (session=$SESSION_ID)"
  note_id "kiosk session (S1)" "$SESSION_ID"
else
  record "c. SESSION_REPORT" FAIL "status=$HTTP_STATUS body=$HTTP_BODY"
fi

# =============================================================================
section "step d: GET /v1/sessions?campaignId + GET /v1/sessions/:id"
# =============================================================================
http_call GET "$API_BASE/v1/sessions?campaignId=$CAMPAIGN_ID" "" "x-api-key: $API_KEY"
log "GET /v1/sessions?campaignId=... -> $HTTP_STATUS"
log "$HTTP_BODY"
item_count="$(jd '.data.items | length')"
photo_count="$(jd '.data.items[0].photoCount')"
photos_pending="$(jd '.data.items[0].photosPending')"
device_name_in_list="$(jd '.data.items[0].deviceName')"
if [ "$HTTP_STATUS" = "200" ] && [ "$item_count" = "1" ] && [ "$photo_count" = "2" ] && [ "$photos_pending" = "2" ] && [ "$device_name_in_list" = "$DEVICE_NAME" ]; then
  record "d1. GET /v1/sessions?campaignId" PASS "items=1, photoCount=2, photosPending=2, deviceName=$device_name_in_list"
else
  record "d1. GET /v1/sessions?campaignId" FAIL "items=$item_count photoCount=$photo_count photosPending=$photos_pending deviceName=$device_name_in_list status=$HTTP_STATUS"
fi

http_call GET "$API_BASE/v1/sessions/$SESSION_ID" "" "x-api-key: $API_KEY"
log "GET /v1/sessions/$SESSION_ID -> $HTTP_STATUS"
log "$HTTP_BODY"
detail_photo_count="$(jd '.data.photos | length')"
has_step_fields="$(jd '[.data.photos[] | select(.stepType != null and .cameraRole != null and .attempt != null)] | length')"
if [ "$HTTP_STATUS" = "200" ] && [ "$detail_photo_count" = "2" ] && [ "$has_step_fields" = "2" ]; then
  record "d2. GET /v1/sessions/:id" PASS "2 photos, each with stepType/cameraRole/attempt"
else
  record "d2. GET /v1/sessions/:id" FAIL "photos=$detail_photo_count withFields=$has_step_fields status=$HTTP_STATUS"
fi

# =============================================================================
section "step e: PHOTO_STATUS lifecycle (photo1 uploaded->ready, photo2 failed)"
# =============================================================================
# As the kiosk would: provision this device's own fs-core tenant and upload
# photo1 for real, so F1 is a file our mock actually knows about (needed for
# step h's view-link + curl to succeed against something real).
kiosk_provision_resp="$(curl -s -X POST "$MOCK_BASE/api/v1/self-service/provision" \
  -H 'Content-Type: application/json' -d "$(jq -nc --arg t "$DEVICE_ID" '{tenant_name: $t}')")"
KIOSK_API_KEY="$(printf '%s' "$kiosk_provision_resp" | jq -r '.api_key')"
log "kiosk provisioned tenant for device -> api_key prefix ${KIOSK_API_KEY:0:12}..."

upload_resp="$(curl -s -X POST "$MOCK_BASE/api/v1/files" \
  -H "X-API-Key: $KIOSK_API_KEY" \
  -H "X-Virtual-Path: $VP1" \
  -H "X-Content-SHA256: $PHOTO1_SHA" \
  -H "Idempotency-Key: $SESSION_ID:step-front:2:face" \
  -H "X-Visibility: private" \
  -H 'Content-Type: image/jpeg' \
  --data-binary "fake-jpeg-bytes-for-e2e-photo1")"
F1="$(printf '%s' "$upload_resp" | jq -r '.file_id')"
log "kiosk uploaded photo1 directly to mock fs-core -> file_id=$F1"

T1="$(now_iso)"
photo1_uploaded_event=$(jq -nc --arg sessionId "$SESSION_ID" --arg photoId "$PHOTO1_ID" --arg at "$T1" \
  --arg sha "$PHOTO1_SHA" --arg vp "$VP1" --arg fileId "$F1" '{
  sessionId: $sessionId, photoId: $photoId, stepId: "step-front", attempt: 2, at: $at,
  localStatus: "UPLOADED", fsFileId: $fileId, fsStatus: "SCANNING", error: null,
  mimeType: "image/jpeg", sizeBytes: 231044, sha256: $sha, virtualPath: $vp,
  stepType: "FRONT", cameraRole: "CENTER"
}')
batch1=$(jq -nc --argjson e "$photo1_uploaded_event" --arg occurredAt "$T1" '{events: [{type: "PHOTO_STATUS", occurredAt: $occurredAt, metadata: $e}]}')
http_call POST "$API_BASE/v1/devices/events" "$batch1" "x-device-id: $DEVICE_ID" "x-device-secret: $DEVICE_SECRET"
log "POST /v1/devices/events (photo1 uploaded) -> $HTTP_STATUS $HTTP_BODY"

log "waiting 2.5s for mock fs-core to flip photo1 to READY..."
sleep 2.5
T2="$(now_iso)"
photo1_ready_event=$(jq -nc --arg sessionId "$SESSION_ID" --arg photoId "$PHOTO1_ID" --arg at "$T2" \
  --arg sha "$PHOTO1_SHA" --arg vp "$VP1" --arg fileId "$F1" '{
  sessionId: $sessionId, photoId: $photoId, stepId: "step-front", attempt: 2, at: $at,
  localStatus: "DONE", fsFileId: $fileId, fsStatus: "READY", error: null,
  mimeType: "image/jpeg", sizeBytes: 231044, sha256: $sha, virtualPath: $vp,
  stepType: "FRONT", cameraRole: "CENTER"
}')
T3="$(now_iso)"
photo2_failed_event=$(jq -nc --arg sessionId "$SESSION_ID" --arg photoId "$PHOTO2_ID" --arg at "$T3" \
  --arg sha "$PHOTO2_SHA" --arg vp "$VP2" '{
  sessionId: $sessionId, photoId: $photoId, stepId: "step-left", attempt: 1, at: $at,
  localStatus: "FAILED_PERMANENT", fsFileId: null, fsStatus: null,
  error: "file-service 413 QUOTA_EXCEEDED: tenant quota exceeded",
  mimeType: "image/jpeg", sizeBytes: 198234, sha256: $sha, virtualPath: $vp,
  stepType: "LEFT", cameraRole: "LEFT"
}')
batch2=$(jq -nc --argjson e1 "$photo1_ready_event" --argjson e2 "$photo2_failed_event" --arg occurredAt "$T3" \
  '{events: [{type: "PHOTO_STATUS", occurredAt: $occurredAt, metadata: $e1}, {type: "PHOTO_STATUS", occurredAt: $occurredAt, metadata: $e2}]}')
http_call POST "$API_BASE/v1/devices/events" "$batch2" "x-device-id: $DEVICE_ID" "x-device-secret: $DEVICE_SECRET"
log "POST /v1/devices/events (photo1 ready, photo2 failed) -> $HTTP_STATUS $HTTP_BODY"

http_call GET "$API_BASE/v1/sessions?campaignId=$CAMPAIGN_ID" "" "x-api-key: $API_KEY"
log "GET /v1/sessions?campaignId=... (after PHOTO_STATUS) -> $HTTP_STATUS"
log "$HTTP_BODY"
photos_ready="$(jd '.data.items[0].photosReady')"
photos_failed="$(jd '.data.items[0].photosFailed')"
if [ "$photos_ready" = "1" ] && [ "$photos_failed" = "1" ]; then
  record "e. PHOTO_STATUS lifecycle" PASS "photosReady=1, photosFailed=1 (F1=$F1)"
else
  record "e. PHOTO_STATUS lifecycle" FAIL "photosReady=$photos_ready photosFailed=$photos_failed"
fi

http_call GET "$API_BASE/v1/sessions/$SESSION_ID" "" "x-api-key: $API_KEY"
detail_fsFileId="$(jd '.data.photos[] | select(.id=="'"$PHOTO1_ID"'") | .fsFileId')"
detail_readyAt="$(jd '.data.photos[] | select(.id=="'"$PHOTO1_ID"'") | .readyAt')"
detail_uploadError="$(jd '.data.photos[] | select(.id=="'"$PHOTO2_ID"'") | .uploadError')"
log "session detail after lifecycle: photo1.fsFileId=$detail_fsFileId photo1.readyAt=$detail_readyAt photo2.uploadError=$detail_uploadError"
if [ "$detail_fsFileId" = "$F1" ] && [ -n "$detail_readyAt" ] && [ "$detail_readyAt" != "null" ] && [[ "$detail_uploadError" == *"QUOTA_EXCEEDED"* ]]; then
  record "e2. session detail shows fsFileId/readyAt/uploadError" PASS "as expected"
else
  record "e2. session detail shows fsFileId/readyAt/uploadError" FAIL "fsFileId=$detail_fsFileId readyAt=$detail_readyAt uploadError=$detail_uploadError"
fi

# =============================================================================
section "step f: idempotency (resend SESSION_REPORT + stale PHOTO_STATUS)"
# =============================================================================
resend_batch=$(jq -nc --argjson sr "$session_report_metadata" --argjson ps "$photo1_uploaded_event" --arg occurredAt "$APPROVED_AT" '{
  events: [
    {type: "SESSION_REPORT", occurredAt: $occurredAt, metadata: $sr},
    {type: "PHOTO_STATUS", occurredAt: $occurredAt, metadata: $ps}
  ]
}')
http_call POST "$API_BASE/v1/devices/events" "$resend_batch" "x-device-id: $DEVICE_ID" "x-device-secret: $DEVICE_SECRET"
log "POST /v1/devices/events (resend + stale) -> $HTTP_STATUS $HTTP_BODY"
resend_accepted="$(jd '.data.accepted')"

http_call GET "$API_BASE/v1/sessions?campaignId=$CAMPAIGN_ID" "" "x-api-key: $API_KEY"
item_count_after="$(jd '.data.items | length')"
http_call GET "$API_BASE/v1/sessions/$SESSION_ID" "" "x-api-key: $API_KEY"
fsStatus_after="$(jd '.data.photos[] | select(.id=="'"$PHOTO1_ID"'") | .fsStatus')"
log "after resend: sessions for campaign=$item_count_after, photo1.fsStatus=$fsStatus_after"
if [ "$resend_accepted" = "2" ] && [ "$item_count_after" = "1" ] && [ "$fsStatus_after" = "READY" ]; then
  record "f. idempotency (resend + stale)" PASS "accepted=2, still 1 session, photo1 still READY"
else
  record "f. idempotency (resend + stale)" FAIL "accepted=$resend_accepted sessions=$item_count_after fsStatus=$fsStatus_after"
fi

# =============================================================================
section "step g: campaign stats"
# =============================================================================
http_call GET "$API_BASE/v1/campaigns/$CAMPAIGN_ID/stats" "" "x-api-key: $API_KEY"
log "GET /v1/campaigns/:id/stats -> $HTTP_STATUS"
log "$HTTP_BODY"
today_vn="$(TZ='Asia/Ho_Chi_Minh' date +%F)"
g_sessions="$(jd '.data.sessions')"
g_total="$(jd '.data.photos.total')"
g_ready="$(jd '.data.photos.ready')"
g_pending="$(jd '.data.photos.pending')"
g_failed="$(jd '.data.photos.failed')"
g_byDevice_sessions="$(jd '.data.byDevice[] | select(.deviceId=="'"$DEVICE_ID"'") | .sessions')"
g_byDay_today="$(jd '.data.byDay[] | select(.date=="'"$today_vn"'") | .sessions')"
if [ "$g_sessions" = "1" ] && [ "$g_total" = "2" ] && [ "$g_ready" = "1" ] && [ "$g_pending" = "0" ] && [ "$g_failed" = "1" ] \
   && [ "$g_byDevice_sessions" = "1" ] && [ "$g_byDay_today" = "1" ]; then
  record "g1. GET /v1/campaigns/:id/stats" PASS "sessions=1 photos{total2,ready1,pending0,failed1} byDevice/byDay ok"
else
  record "g1. GET /v1/campaigns/:id/stats" FAIL "sessions=$g_sessions total=$g_total ready=$g_ready pending=$g_pending failed=$g_failed byDevice.sessions=$g_byDevice_sessions byDay[$today_vn].sessions=$g_byDay_today"
fi

http_call GET "$API_BASE/v1/campaigns/stats/summary" "" "x-api-key: $API_KEY"
log "GET /v1/campaigns/stats/summary -> $HTTP_STATUS"
log "$HTTP_BODY"
sum_sessions="$(jd '.data.totalSessions')"
sum_photos_total="$(jd '.data.totalPhotos.total')"
old_counters_present="$(jd 'if (.data | has("totalSessionsCompleted")) and (.data | has("totalUploadSuccess")) and (.data | has("totalUploadFailed")) and (.data | has("totalRetakes")) then "yes" else "no" end')"
if [ -n "$sum_sessions" ] && [ "$sum_sessions" -ge 1 ] 2>/dev/null && [ -n "$sum_photos_total" ] && [ "$sum_photos_total" -ge 2 ] 2>/dev/null && [ "$old_counters_present" = "yes" ]; then
  record "g2. GET /v1/campaigns/stats/summary" PASS "totalSessions=$sum_sessions totalPhotos.total=$sum_photos_total, old counters present"
else
  record "g2. GET /v1/campaigns/stats/summary" FAIL "totalSessions=$sum_sessions totalPhotos.total=$sum_photos_total oldCountersPresent=$old_counters_present"
fi

# =============================================================================
section "step h: view-link"
# =============================================================================
http_call POST "$API_BASE/v1/photos/$PHOTO1_ID/view-link" "$(jq -nc '{viewerId: "cms-admin"}')" "x-api-key: $API_KEY"
log "POST /v1/photos/$PHOTO1_ID/view-link -> $HTTP_STATUS"
log "$HTTP_BODY"
view_url="$(jd '.data.url')"
if { [ "$HTTP_STATUS" = "200" ] || [ "$HTTP_STATUS" = "201" ]; } && [ -n "$view_url" ] && [ "$view_url" != "null" ]; then
  full_url="$view_url"
  case "$view_url" in
    http*) full_url="$view_url" ;;
    *) full_url="$MOCK_BASE$view_url" ;;
  esac
  dl_code="$(curl -s -o "$LOG_DIR/photo1-downloaded.bin" -w '%{http_code}' "$full_url")"
  dl_size=$(wc -c < "$LOG_DIR/photo1-downloaded.bin" | tr -d ' ')
  dl_type="$(file -b "$LOG_DIR/photo1-downloaded.bin" 2>/dev/null)"
  log "curl view-link url ($full_url) -> HTTP $dl_code, $dl_size bytes, $dl_type"
  if [ "$dl_code" = "200" ] && [ "$dl_size" -gt 0 ] 2>/dev/null; then
    record "h1. photo1 view-link + curl bytes" PASS "HTTP 200, $dl_size bytes ($dl_type)"
  else
    record "h1. photo1 view-link + curl bytes" FAIL "download HTTP=$dl_code size=$dl_size"
  fi
else
  record "h1. photo1 view-link + curl bytes" FAIL "status=$HTTP_STATUS body=$HTTP_BODY"
fi

# mock log evidence: provision call with tenant_name = device id, and the
# download-link call carrying X-Viewer-ID + a per-device (fsc_mock_<deviceId>) key.
provision_evidence="$(grep -F "tenant_name=\"$DEVICE_ID\"" "$MOCK_LOG" || true)"
downloadlink_evidence="$(grep -F "download-link" "$MOCK_LOG" | grep -F "viewer=cms-admin" || true)"
perdevice_key_evidence="$(grep -F "X-API-Key=fsc_mock" "$MOCK_LOG" || true)"
log "mock log provision evidence: $provision_evidence"
log "mock log download-link evidence: $downloadlink_evidence"
if [ -n "$provision_evidence" ] && [ -n "$downloadlink_evidence" ] && [ -n "$perdevice_key_evidence" ]; then
  record "h2. mock log shows per-device provision + viewer-id" PASS "see logs/mock-fs-core.log"
else
  record "h2. mock log shows per-device provision + viewer-id" FAIL "provision_evidence_empty=$([ -z "$provision_evidence" ] && echo yes || echo no) downloadlink_evidence_empty=$([ -z "$downloadlink_evidence" ] && echo yes || echo no)"
fi

http_call POST "$API_BASE/v1/photos/$PHOTO2_ID/view-link" "$(jq -nc '{viewerId: "cms-admin"}')" "x-api-key: $API_KEY"
log "POST /v1/photos/$PHOTO2_ID/view-link (no fsFileId) -> $HTTP_STATUS"
log "$HTTP_BODY"
err_code="$(jd '.errorCode')"
if [ "$HTTP_STATUS" = "503" ] && [ "$err_code" = "3000" ]; then
  record "h3. photo2 view-link (no fsFileId) -> 503 FILE_STORAGE_NOT_READY" PASS "503, errorCode=3000"
else
  record "h3. photo2 view-link (no fsFileId) -> 503 FILE_STORAGE_NOT_READY" FAIL "status=$HTTP_STATUS body=$HTTP_BODY"
fi

# =============================================================================
section "step i: web path (create session, 2 attempts, complete)"
# =============================================================================
http_call POST "$API_BASE/v1/sessions" "$(jq -nc '{subjectCode: "E2E-WEB-01"}')" "x-api-key: $API_KEY"
log "POST /v1/sessions -> $HTTP_STATUS $HTTP_BODY"
WEB_SESSION_ID="$(jd '.data.id')"
note_id "web session" "$WEB_SESSION_ID"

photo1_dataurl="data:image/jpeg;base64,$(printf 'web-attempt-1-content-%s' "$WEB_SESSION_ID" | base64)"
http_call POST "$API_BASE/v1/sessions/$WEB_SESSION_ID/photos" "$(jq -nc --arg d "$photo1_dataurl" '{stepId: "FRONT", attempt: 1, dataUrl: $d}')" "x-api-key: $API_KEY"
log "POST .../photos attempt1 -> $HTTP_STATUS $HTTP_BODY"
WEB_PHOTO1_ID="$(jd '.data.photoId')"

photo2_dataurl="data:image/jpeg;base64,$(printf 'web-attempt-2-final-content-%s' "$WEB_SESSION_ID" | base64)"
http_call POST "$API_BASE/v1/sessions/$WEB_SESSION_ID/photos" "$(jq -nc --arg d "$photo2_dataurl" '{stepId: "FRONT", attempt: 2, dataUrl: $d}')" "x-api-key: $API_KEY"
log "POST .../photos attempt2 -> $HTTP_STATUS $HTTP_BODY"
WEB_PHOTO2_ID="$(jd '.data.photoId')"

unapproved_count="$(psql_scalar "SELECT count(*) FROM upload_outbox o JOIN photos p ON p.id = o.photo_id WHERE p.session_id = '$WEB_SESSION_ID' AND o.approved_at IS NULL;")"
log "unapproved outbox rows before complete: $unapproved_count"
if [ "$unapproved_count" = "2" ]; then
  record "i1. outbox rows exist with approved_at IS NULL before complete" PASS "2 rows, approved_at NULL"
else
  record "i1. outbox rows exist with approved_at IS NULL before complete" FAIL "count=$unapproved_count"
fi

log "watching mock log for 5s to confirm the worker does NOT upload before approval..."
sleep 5
premature_upload="$(grep -F "$WEB_SESSION_ID" "$MOCK_LOG" | grep -F "UPLOADED" || true)"
if [ -z "$premature_upload" ]; then
  record "i2. worker does not upload before approval" PASS "no UPLOADED line for this session in mock log after 5s"
else
  record "i2. worker does not upload before approval" FAIL "found: $premature_upload"
fi

http_call POST "$API_BASE/v1/sessions/$WEB_SESSION_ID/complete" "" "x-api-key: $API_KEY"
log "POST .../complete (1st) -> $HTTP_STATUS $HTTP_BODY"
complete_status_field="$(jd '.data.status')"

remaining_photos="$(psql_scalar "SELECT count(*) FROM photos WHERE session_id = '$WEB_SESSION_ID';")"
remaining_attempt="$(psql_scalar "SELECT attempt FROM photos WHERE session_id = '$WEB_SESSION_ID';")"
approved_count="$(psql_scalar "SELECT count(*) FROM upload_outbox o JOIN photos p ON p.id = o.photo_id WHERE p.session_id = '$WEB_SESSION_ID' AND o.approved_at IS NOT NULL;")"
log "after complete: remaining photos=$remaining_photos (attempt=$remaining_attempt), approved outbox rows=$approved_count"
if { [ "$HTTP_STATUS" = "200" ] || [ "$HTTP_STATUS" = "201" ]; } && [ "$complete_status_field" = "COMPLETED" ] \
   && [ "$remaining_photos" = "1" ] && [ "$remaining_attempt" = "2" ] && [ "$approved_count" = "1" ]; then
  record "i3. complete keeps only attempt 2, approves its outbox row" PASS "status=COMPLETED, 1 photo (attempt 2), 1 approved outbox row"
else
  record "i3. complete keeps only attempt 2, approves its outbox row" FAIL "http=$HTTP_STATUS status=$complete_status_field photos=$remaining_photos attempt=$remaining_attempt approved=$approved_count"
fi

FS_FILE_ID=""
FS_STATUS=""
for _ in $(seq 1 6); do
  sleep 2
  http_call GET "$API_BASE/v1/sessions/$WEB_SESSION_ID/photos" "" "x-api-key: $API_KEY"
  FS_FILE_ID="$(jd '.data[0].fsFileId')"
  [ -n "$FS_FILE_ID" ] && [ "$FS_FILE_ID" != "null" ] && break
done
log "fsFileId after worker drain: $FS_FILE_ID"
if [ -n "$FS_FILE_ID" ] && [ "$FS_FILE_ID" != "null" ]; then
  record "i4. worker uploads surviving attempt (fsFileId assigned)" PASS "fsFileId=$FS_FILE_ID"
else
  record "i4. worker uploads surviving attempt (fsFileId assigned)" FAIL "fsFileId still empty after ~12s"
fi

for _ in $(seq 1 6); do
  http_call GET "$API_BASE/v1/sessions/$WEB_SESSION_ID/photos" "" "x-api-key: $API_KEY"
  FS_STATUS="$(jd '.data[0].fsStatus')"
  [ "$FS_STATUS" = "READY" ] && break
  sleep 2
done
log "fsStatus after pollScans: $FS_STATUS"
upload_line_count="$(grep -F "sessions/$WEB_SESSION_ID/" "$MOCK_LOG" | grep -c "UPLOADED" || true)"
log "mock log UPLOADED lines for this session: $upload_line_count"
if [ "$FS_STATUS" = "READY" ] && [ "$upload_line_count" = "1" ]; then
  record "i5. fsStatus reaches READY, uploaded exactly once" PASS "fsStatus=READY, 1 upload"
else
  record "i5. fsStatus reaches READY, uploaded exactly once" FAIL "fsStatus=$FS_STATUS uploadCount=$upload_line_count"
fi

http_call POST "$API_BASE/v1/sessions/$WEB_SESSION_ID/complete" "" "x-api-key: $API_KEY"
log "POST .../complete (2nd, no-op) -> $HTTP_STATUS $HTTP_BODY"
remaining_photos_after2="$(psql_scalar "SELECT count(*) FROM photos WHERE session_id = '$WEB_SESSION_ID';")"
if { [ "$HTTP_STATUS" = "200" ] || [ "$HTTP_STATUS" = "201" ]; } && [ "$remaining_photos_after2" = "1" ]; then
  record "i6. second complete() is a no-op" PASS "still 1 photo, no error"
else
  record "i6. second complete() is a no-op" FAIL "http=$HTTP_STATUS remainingPhotos=$remaining_photos_after2"
fi

# =============================================================================
section "step j: negative cases"
# =============================================================================
bad_metadata=$(jq -nc --arg sessionId "$(new_uuid)" --arg approvedAt "$(now_iso)" '{sessionId: $sessionId, approvedAt: $approvedAt}')
bad_events=$(jq -nc --argjson meta "$bad_metadata" --arg occurredAt "$(now_iso)" '{events: [{type: "SESSION_REPORT", occurredAt: $occurredAt, metadata: $meta}]}')
http_call POST "$API_BASE/v1/devices/events" "$bad_events" "x-device-id: $DEVICE_ID" "x-device-secret: $DEVICE_SECRET"
log "POST /v1/devices/events (malformed, missing photos) -> $HTTP_STATUS $HTTP_BODY"
j1_code="$(jd '.errorCode')"
if [ "$HTTP_STATUS" = "400" ] && [ "$j1_code" = "1002" ]; then
  record "j1. malformed SESSION_REPORT -> 400" PASS "400, errorCode=1002 (SESSION_REPORT_INVALID_PAYLOAD)"
else
  record "j1. malformed SESSION_REPORT -> 400" FAIL "status=$HTTP_STATUS body=$HTTP_BODY"
fi

http_call POST "$API_BASE/v1/devices/events" "$session_report_events_payload" "x-device-id: $DEVICE_ID" "x-device-secret: wrong-secret-should-fail"
log "POST /v1/devices/events (wrong device secret) -> $HTTP_STATUS $HTTP_BODY"
if [ "$HTTP_STATUS" = "401" ]; then
  record "j2. wrong device credentials -> 401" PASS "401"
else
  record "j2. wrong device credentials -> 401" FAIL "status=$HTTP_STATUS body=$HTTP_BODY"
fi

# =============================================================================
section "step k: re-run existing suites + build"
# =============================================================================
cd "$API_DIR"
TEST_DB="postgres://apple@localhost:5432/looka_phase11_test"
TEST_DATABASE_URL="$TEST_DB" pnpm test > "$LOG_DIR/jest-final.log" 2>&1
jest_exit=$?
tail -20 "$LOG_DIR/jest-final.log" | tee -a "$RUN_LOG"
if [ "$jest_exit" = "0" ]; then
  record "k1. pnpm --filter @face/api test" PASS "exit 0, see logs/jest-final.log"
else
  record "k1. pnpm --filter @face/api test" FAIL "exit $jest_exit, see logs/jest-final.log"
fi

pnpm build > "$LOG_DIR/build-final.log" 2>&1
build_exit=$?
tail -20 "$LOG_DIR/build-final.log" | tee -a "$RUN_LOG"
if [ "$build_exit" = "0" ]; then
  record "k2. pnpm --filter @face/api build" PASS "exit 0, see logs/build-final.log"
else
  record "k2. pnpm --filter @face/api build" FAIL "exit $build_exit, see logs/build-final.log"
fi

# =============================================================================
section "SUMMARY"
# =============================================================================
for line in "${RESULT_LINES[@]}"; do
  IFS='|' read -r step status detail <<< "$line"
  log "[$status] $step"
done
log ""
log "TOTAL: $PASS_COUNT passed, $FAIL_COUNT failed"
log ""
log "Created ids (dev DB, left in place):"
for line in "${CREATED_IDS[@]}"; do log "  - $line"; done

echo ""
echo "Full log: $RUN_LOG"
echo "Mock fs-core log: $MOCK_LOG"
echo "API log: $API_LOG"

[ "$FAIL_COUNT" = "0" ]
