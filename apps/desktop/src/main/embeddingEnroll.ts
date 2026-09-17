import { EmbeddingServerClient } from '@face/biometric';

/**
 * Admin/health surface for the external "Attendance — Face Enrollment API"
 * (`http://10.20.107.17:8000`).
 *
 * 2026-09-16 — this file used to also own the per-photo enrollment call
 * itself (`enrollFaceForStep`/`sendOne`/`applyFailure`/`tick`, driving a
 * local SQLite retry queue via `@face/database`'s
 * `EmbeddingEnrollmentRepository`): the user asked for that to move to the
 * backend instead ("tôi muốn phần embedding đó sẽ do backend xử lý, khi
 * nhận ảnh và lưu sang file server thì chạy bất đồng bộ để embedding"), so
 * it now happens in `apps/api/src/modules/capture/services/embedding-worker.service.ts`,
 * enqueued the instant a photo is saved server-side
 * (`PhotoService.addPhoto`/`addDevicePhoto`) rather than pushed from here.
 *
 * What is left is everything that was never part of that per-photo
 * pipeline: `embeddingHealth` (a preflight the capture screen still checks
 * before starting a session) and the admin/audit operations against the
 * server's own registered-image list (`listEnrolledFaces`/`deleteEnrolledFace`/
 * `deleteAllEnrolledFaces` — used by a standalone admin/debug surface, not
 * the per-photo capture flow; no renderer UI currently calls them, but they
 * are independent of this removal and left untouched). The local SQLite
 * `embedding_enrollments` table (`@face/database`) is deliberately left in
 * place but unused, matching this codebase's established "deprecate first,
 * drop later once superseded data is confirmed migrated" convention (e.g.
 * `capture_configurations`, dropped 2026-09-17 once its rows were confirmed
 * copied into `workflows`) — not dropped by this change.
 */

const DEFAULT_TIMEOUT_MS = 8_000;

/**
 * 2026-09-15 — the real, live "Attendance — Face Enrollment API" this
 * module is a client for (`EmbeddingServerClient`'s own doc comment already
 * named this exact host as the server its request/response shapes were
 * verified against). Given as a default rather than left required, same
 * convention `aiService.ts`'s `DEFAULT_AI_SERVICE_BASE_URL` already uses for
 * the Python sidecar — `apps/api`'s own `EmbeddingWorkerService` now uses
 * this exact same default for the same reason.
 */
const DEFAULT_EMBEDDING_SERVER_BASE_URL = 'http://10.20.107.17:8000';

function embeddingServerBaseUrl(): string {
  return process.env.EMBEDDING_SERVER_BASE_URL?.trim() || DEFAULT_EMBEDDING_SERVER_BASE_URL;
}

let client: EmbeddingServerClient | null = null;

/**
 * Bring up the client used by `embeddingHealth`/the admin operations below.
 * Always returns true now that `embeddingServerBaseUrl()` has a real default
 * — kept as a function (rather than a module-level constant) so a future
 * caller that genuinely needs this off (e.g. an isolated test environment)
 * can still do so by pointing `EMBEDDING_SERVER_BASE_URL` at something
 * unreachable.
 */
export function startEmbeddingEnroll(): boolean {
  client = new EmbeddingServerClient({ baseUrl: embeddingServerBaseUrl(), timeoutMs: DEFAULT_TIMEOUT_MS });
  return true;
}

/** No-op now that there is no background retry loop to stop — kept so existing call sites (app quit/window-all-closed handlers in index.ts) need no change. */
export function stopEmbeddingEnroll(): void {
  // Nothing to stop — see this file's own doc comment.
}

/** Reachability preflight before a capture session — see aiService.ts's `pingAiService` for the same idea applied to the Python sidecar. Never throws. */
export async function embeddingHealth(): Promise<{ configured: boolean; ok: boolean; modelsLoaded: boolean }> {
  if (!client) return { configured: false, ok: false, modelsLoaded: false };
  const result = await client.health();
  return { configured: true, ...result };
}

// ── Admin operations (§7 — listFaces/deleteFace/deleteAllFaces IPC) ────────

function requireClient(): EmbeddingServerClient {
  if (!client) {
    throw new Error('Chưa cấu hình máy chủ nhận diện khuôn mặt (EMBEDDING_SERVER_BASE_URL).');
  }
  return client;
}

export async function listEnrolledFaces(userCode: string): ReturnType<EmbeddingServerClient['listFaces']> {
  return requireClient().listFaces(userCode);
}

export async function deleteEnrolledFace(userCode: string, embeddingId: number): ReturnType<EmbeddingServerClient['deleteFace']> {
  return requireClient().deleteFace(userCode, embeddingId);
}

export async function deleteAllEnrolledFaces(userCode: string): ReturnType<EmbeddingServerClient['deleteAllFaces']> {
  return requireClient().deleteAllFaces(userCode);
}
