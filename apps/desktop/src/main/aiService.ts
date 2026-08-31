/**
 * Reachability probe for the Python AI sidecar (`services/python-ai`) — see
 * FIX-PLAN.md step 5. Deliberately just a health ping, not a client: nothing
 * in `apps/desktop` calls the sidecar's embedding/liveness endpoints yet (see
 * ROADMAP.md's cross-cutting finding on Pillar B having no real caller), so
 * there is no request-signing/retry machinery to build here — only enough to
 * answer "is it up" for `app:getStatus`.
 *
 * Base URL follows the same `process.env` override pattern as
 * `FS_BASE_URL`/`FS_API_KEY` in secrets.ts, defaulting to the port the
 * project's own docs consistently describe the sidecar running on.
 */
const DEFAULT_AI_SERVICE_BASE_URL = 'http://localhost:8321';

function aiServiceBaseUrl(): string {
  return process.env.AI_SERVICE_BASE_URL?.trim() || DEFAULT_AI_SERVICE_BASE_URL;
}

/** Ask the sidecar whether it is reachable right now, with a short timeout so a dead service never hangs status reporting. */
export async function pingAiService(): Promise<boolean> {
  try {
    const res = await fetch(`${aiServiceBaseUrl()}/api/v1/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(5_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}
