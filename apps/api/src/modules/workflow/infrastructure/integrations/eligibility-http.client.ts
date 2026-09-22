import { Injectable, Logger } from '@nestjs/common';
import { isIP } from 'node:net';
import { lookup as dnsLookup } from 'node:dns/promises';
import {
  IntegrationOutcome,
  retryable,
  success,
  terminal,
} from '@app/shared/integrations/integration-outcome';
import { decryptSecret } from '@app/shared/security/secret.codec';

/** `a.b.c.d` → true if it falls in a loopback/private/link-local/reserved IPv4 range (RFC 1918, RFC 3927, RFC 6890) — includes `169.254.169.254`, the cloud-metadata address every major cloud provider serves unauthenticated instance credentials from. */
function isPrivateOrReservedIPv4(ip: string): boolean {
  const parts = ip.split('.').map((p) => Number(p));
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p))) {
    return true; // malformed — treat as unsafe rather than risk a bypass
  }
  const [a, b] = parts;
  if (a === 127) return true; // loopback
  if (a === 10) return true; // private
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 169 && b === 254) return true; // link-local, incl. cloud metadata
  if (a === 0) return true; // "this" network
  if (a >= 224) return true; // multicast/reserved
  return false;
}

/** IPv6 equivalent — loopback (`::1`), unique-local (`fc00::/7`), link-local (`fe80::/10`), and IPv4-mapped addresses (checked against the IPv4 rule above). */
function isPrivateOrReservedIPv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  if (normalized === '::1' || normalized === '::') return true;
  const firstGroup = normalized.split(':')[0];
  if (/^fe[89ab]/.test(firstGroup)) return true; // fe80::/10 link-local
  if (/^f[cd]/.test(firstGroup)) return true; // fc00::/7 unique-local
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(normalized);
  if (mapped) return isPrivateOrReservedIPv4(mapped[1]);
  return false;
}

function isPrivateOrReservedIP(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return isPrivateOrReservedIPv4(ip);
  if (family === 6) return isPrivateOrReservedIPv6(ip);
  return true; // not a recognizable IP literal — unsafe by default
}

export type EligibilityApiAuthType =
  'NONE' | 'API_KEY_HEADER' | 'BEARER_TOKEN' | 'QUERY_PARAM';
export type EligibilityApiRequestMethod = 'GET' | 'POST';

/**
 * Inline `eligibilityConfig.api` config, per-campaign (2026-09-17 redo of
 * plan item 7 — no separate `eligibility_api_clients` catalog anymore, see
 * this file's own doc comment below; 2026-09-18 — moved off the workflow
 * onto the campaign itself, see `Campaign.eligibilityConfig`'s own doc
 * comment). Same shape `eligibilityApiSchema` in
 * `eligibility-config.schema.ts` validates. `credentialCiphertext` is the
 * encrypted-at-rest form; a caller resolving this from a saved campaign
 * passes it through as-is, `EligibilityHttpClient` decrypts it.
 */
export interface EligibilityApiConfig {
  baseUrl: string;
  requestMethod: EligibilityApiRequestMethod;
  requestPath: string;
  requestBodyTemplate?: Record<string, unknown>;
  authType: EligibilityApiAuthType;
  authParamName?: string;
  credentialCiphertext?: string;
  keyResponsePath?: string;
  /** 2026-09-18 — see `lookup()`'s own doc comment. `undefined` = 0 (no retry), matching pre-existing behavior for a workflow saved before this field existed. */
  retryCount?: number;
  /** 2026-09-18 — see `lookup()`'s own doc comment. `undefined` = the pre-existing hardcoded `DEFAULT_TIMEOUT_MS`. */
  timeoutMs?: number;
  /** 2026-09-21 — see `fetchAll()`'s own doc comment. */
  listResponsePath?: string;
  /** 2026-09-21 — see `fetchAll()`'s own doc comment. `undefined` falls back to `timeoutMs`, then `DEFAULT_TIMEOUT_MS`. */
  listTimeoutMs?: number;
}

export interface EligibilityLookupResult {
  /** The full parsed response body, exactly as returned — the CMS keeps this in local state as the field-picker's source, see `WorkflowConfigEditor.tsx`. */
  raw: unknown;
  /** The matched record extracted from `raw` — see this file's own doc comment on how. */
  record: Record<string, unknown> | null;
}

export interface EligibilityListResult {
  /** The full parsed response body, exactly as returned. */
  raw: unknown;
  /** Every record extracted from `raw` — see `fetchAll()`'s own doc comment on how. */
  records: Record<string, unknown>[];
}

const DEFAULT_TIMEOUT_MS = 15_000;
/** Fixed delay between retry attempts — simple, not exponential backoff; nothing in this feature's scope calls for more than that. */
const RETRY_DELAY_MS = 500;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** `path` like `data[0].student_code` — supports plain `.` segments and `[N]` array indices, nothing fancier (JSONPath is overkill for "where in this JSON is the one field/record I care about"). */
function getByPath(value: unknown, path: string): unknown {
  const segments = path
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter((s) => s.length > 0);
  let current: unknown = value;
  for (const segment of segments) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/** Drops the last path segment — `data[0].student_code` → `data[0]`, `student_code` → `''` (root). */
function parentPath(path: string): string {
  const normalized = path.replace(/\[(\d+)\]/g, '.$1');
  const idx = normalized.lastIndexOf('.');
  return idx === -1 ? '' : normalized.slice(0, idx);
}

/**
 * No `keyResponsePath` configured yet (e.g. the very first test-call before
 * a workflow author has seen a real response to set one) — covers the
 * shapes a lookup-by-key API realistically returns: a bare array,
 * `{data: [...]}}, `{data: {...}}`, or a bare object.
 */
function guessRecord(raw: unknown): Record<string, unknown> | null {
  if (Array.isArray(raw)) {
    const first = raw[0];
    return first && typeof first === 'object'
      ? (first as Record<string, unknown>)
      : null;
  }
  if (raw && typeof raw === 'object') {
    const data = (raw as Record<string, unknown>).data;
    if (Array.isArray(data)) {
      const first = data[0];
      return first && typeof first === 'object'
        ? (first as Record<string, unknown>)
        : null;
    }
    if (data && typeof data === 'object')
      return data as Record<string, unknown>;
    return raw as Record<string, unknown>;
  }
  return null;
}

/** Recursively replaces every occurrence of the literal string `{{key}}` inside string values with `key` — leaves every other value (numbers, booleans, other strings) untouched. */
function substituteKey(template: unknown, key: string): unknown {
  if (typeof template === 'string') return template.split('{{key}}').join(key);
  if (Array.isArray(template))
    return template.map((v) => substituteKey(v, key));
  if (template && typeof template === 'object') {
    return Object.fromEntries(
      Object.entries(template as Record<string, unknown>).map(([k, v]) => [
        k,
        substituteKey(v, key),
      ]),
    );
  }
  return template;
}

/**
 * Generic executor for ONE campaign's own `eligibilityConfig.api`
 * (2026-09-17 redo of plan item 7) — the first version of this class
 * executed a row from a shared, DB-wide `eligibility_api_clients` catalog;
 * the user explicitly rejected that ("API điều kiện tiếp nhận là config
 * trong workflow luôn chứ không dùng chung như hiện tại") — every workflow
 * owned its own inline config, versioned/immutable with the rest of
 * `workflow_versions.config`, no cross-workflow reuse and no separate
 * table. 2026-09-18: that inline config itself moved again, off the
 * workflow onto the campaign (see `Campaign.eligibilityConfig`'s own doc
 * comment) — the "own inline config, no shared table" shape this class was
 * built for is unchanged, only WHERE that config lives moved. This class
 * itself stays exactly as generic as before — it just takes a plain
 * `EligibilityApiConfig` object instead of an entity row, so it works
 * identically whether the config came from a saved campaign or an ad-hoc,
 * not-yet-saved draft being test-called from the CMS.
 *
 * What stays genuinely generic: base URL + path + method, an auth
 * header/query-param + decrypted credential, and a request body/query
 * template with `{{key}}` substitution. What does NOT try to be generic:
 * response-shape extraction beyond `keyResponsePath` (or the `guessRecord`
 * fallback above) — a truly arbitrary external API's response shape is not
 * something a config object can fully describe without something like
 * JSONPath/jq; this covers the common "lookup-by-key returns one record or
 * a short list" shape every known/likely candidate API (Dainam's own, any
 * similar university directory API) actually has.
 */
@Injectable()
export class EligibilityHttpClient {
  private readonly logger = new Logger(EligibilityHttpClient.name);

  /**
   * SSRF guard — `config.baseUrl` is caller-controlled campaign config
   * (`eligibility-config.schema.ts` only validates it as a non-empty
   * string), and `fetchAll()` in particular is reachable unattended by any
   * `campaign:write` holder via a background cron worker, not just an
   * interactive test-call. Rejects non-http(s) schemes outright, then
   * resolves the hostname and rejects if ANY resolved address is
   * loopback/private/link-local (incl. `169.254.169.254`, a real cloud
   * metadata endpoint) — a hostname can round-robin or later repoint to an
   * internal address, so this re-resolves on every call rather than
   * trusting a first-seen address. Thrown here, caught by both call sites
   * and turned into the same `terminal(...)` outcome every other
   * unreachable/invalid-response case already uses.
   */
  private async assertUrlIsSafe(url: URL): Promise<void> {
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error(
        `Chỉ hỗ trợ http/https, không hỗ trợ giao thức "${url.protocol}"`,
      );
    }
    const hostname = url.hostname;
    if (isIP(hostname)) {
      if (isPrivateOrReservedIP(hostname)) {
        throw new Error(
          `Địa chỉ IP "${hostname}" là địa chỉ nội bộ/riêng tư — không được phép gọi`,
        );
      }
      return;
    }
    if (hostname === 'localhost') {
      throw new Error('Không được gọi "localhost"');
    }
    let addresses: Array<{ address: string }>;
    try {
      addresses = await dnsLookup(hostname, { all: true });
    } catch {
      // Unresolvable hostname is not itself a private-network risk (no
      // internal address was reached) — let the normal fetch() failure path
      // just below handle it (network error -> Retryable), same as any
      // other DNS hiccup, rather than treating "can't resolve" as unsafe.
      return;
    }
    for (const { address } of addresses) {
      if (isPrivateOrReservedIP(address)) {
        throw new Error(
          `Tên miền "${hostname}" phân giải tới địa chỉ nội bộ/riêng tư (${address}) — không được phép`,
        );
      }
    }
  }

  /**
   * `config.retryCount`/`timeoutMs` (2026-09-18, product feedback — "cần
   * retry bao lần, bao lâu là timeout") — credential resolution happens
   * ONCE here (decrypting/validating it again on every retry would be pure
   * waste, and a bad-credential failure is `Terminal` anyway, never
   * retried); each actual HTTP attempt is `attemptRequest()` below. Only a
   * `Retryable` outcome (network error/timeout — never `Terminal`, e.g. a
   * bad credential or a real HTTP 4xx/5xx body from the remote API) is
   * retried, up to `retryCount` MORE times after the first attempt, with a
   * fixed `RETRY_DELAY_MS` between them. `retryCount` unset/0 keeps the
   * exact pre-2026-09-18 behavior: one attempt, no retry.
   */
  async lookup(
    config: EligibilityApiConfig,
    key: string,
  ): Promise<IntegrationOutcome<EligibilityLookupResult>> {
    let credential: string | null = null;
    if (config.authType !== 'NONE') {
      if (!config.credentialCiphertext) {
        return terminal(
          `API cần credential (${config.authType}) nhưng chưa được cấu hình — nhập API key/token ở phần "Điều kiện tiếp nhận" của workflow.`,
        );
      }
      try {
        credential = decryptSecret(config.credentialCiphertext);
      } catch (error) {
        return terminal(
          `Không giải mã được credential đã lưu: ${(error as Error).message}`,
        );
      }
    }

    const maxAttempts = 1 + (config.retryCount ?? 0);
    let lastOutcome: IntegrationOutcome<EligibilityLookupResult> = retryable(
      'Không thực hiện được request nào',
    );
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      lastOutcome = await this.attemptRequest(config, key, credential);
      if (lastOutcome.kind !== 'Retryable') return lastOutcome;
      if (attempt < maxAttempts) {
        this.logger.warn(
          `eligibility API call failed (attempt ${attempt}/${maxAttempts}): ${lastOutcome.reason} — retrying`,
        );
        await delay(RETRY_DELAY_MS);
      }
    }
    return lastOutcome;
  }

  private async attemptRequest(
    config: EligibilityApiConfig,
    key: string,
    credential: string | null,
  ): Promise<IntegrationOutcome<EligibilityLookupResult>> {
    const url = new URL(
      `${config.baseUrl.replace(/\/$/, '')}${config.requestPath}`,
    );
    try {
      await this.assertUrlIsSafe(url);
    } catch (error) {
      return terminal((error as Error).message);
    }
    const headers: Record<string, string> = { accept: 'application/json' };
    if (config.authType === 'API_KEY_HEADER' && credential) {
      headers[config.authParamName || 'x-api-key'] = credential;
    } else if (config.authType === 'BEARER_TOKEN' && credential) {
      headers.authorization = `Bearer ${credential}`;
    } else if (config.authType === 'QUERY_PARAM' && credential) {
      url.searchParams.set(config.authParamName || 'api_key', credential);
    }

    let body: string | undefined;
    if (config.requestMethod === 'GET') {
      const params = substituteKey(config.requestBodyTemplate ?? {}, key);
      if (params && typeof params === 'object') {
        for (const [k, v] of Object.entries(
          params as Record<string, unknown>,
        )) {
          url.searchParams.set(k, String(v));
        }
      }
    } else {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(
        substituteKey(config.requestBodyTemplate ?? {}, key),
      );
    }

    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    );

    let res: globalThis.Response;
    try {
      res = await fetch(url, {
        method: config.requestMethod,
        headers,
        body,
        signal: controller.signal,
      });
    } catch (error) {
      clearTimeout(timer);
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`could not reach the eligibility API: ${message}`);
      return retryable(`Không gọi được API: ${message}`);
    }
    clearTimeout(timer);

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return terminal(`API trả về HTTP ${res.status}: ${text.slice(0, 500)}`);
    }

    const text = await res.text();
    let raw: unknown;
    try {
      raw = text ? JSON.parse(text) : null;
    } catch (error) {
      return terminal(
        `API trả về nội dung không phải JSON: ${(error as Error).message}`,
      );
    }

    let record: Record<string, unknown> | null = null;
    if (config.keyResponsePath) {
      const path = parentPath(config.keyResponsePath);
      const found = path ? getByPath(raw, path) : raw;
      if (found && typeof found === 'object' && !Array.isArray(found)) {
        record = found as Record<string, unknown>;
      }
    }
    if (!record) record = guessRecord(raw);

    return success({ raw, record });
  }

  /**
   * Fetches EVERY record from the same per-campaign `eligibilityConfig.api`
   * `lookup()` calls per-key — device-management's roster-sync feature
   * (13-features-and-2-blockers-plan-2026-09-18.md §3.1), called once per
   * "Kéo dữ liệu" click rather than once per student. Reuses the exact
   * auth/URL-building `attemptRequest` does, but sends
   * `requestBodyTemplate` AS-IS (no `{{key}}` substitution — there is no
   * single key) and extracts an ARRAY via `listResponsePath` instead of one
   * record via `keyResponsePath`. Retries the same way `lookup()` does,
   * using `listTimeoutMs` (falls back to `timeoutMs`, then the same
   * hardcoded default) since a full-roster pull is an order of magnitude
   * bigger than one lookup and may need a longer budget.
   */
  async fetchAll(
    config: EligibilityApiConfig,
  ): Promise<IntegrationOutcome<EligibilityListResult>> {
    let credential: string | null = null;
    if (config.authType !== 'NONE') {
      if (!config.credentialCiphertext) {
        return terminal(
          `API cần credential (${config.authType}) nhưng chưa được cấu hình — nhập API key/token ở phần "Điều kiện tiếp nhận" của campaign.`,
        );
      }
      try {
        credential = decryptSecret(config.credentialCiphertext);
      } catch (error) {
        return terminal(
          `Không giải mã được credential đã lưu: ${(error as Error).message}`,
        );
      }
    }

    const maxAttempts = 1 + (config.retryCount ?? 0);
    let lastOutcome: IntegrationOutcome<EligibilityListResult> = retryable(
      'Không thực hiện được request nào',
    );
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      lastOutcome = await this.attemptListRequest(config, credential);
      if (lastOutcome.kind !== 'Retryable') return lastOutcome;
      if (attempt < maxAttempts) {
        this.logger.warn(
          `eligibility API fetchAll failed (attempt ${attempt}/${maxAttempts}): ${lastOutcome.reason} — retrying`,
        );
        await delay(RETRY_DELAY_MS);
      }
    }
    return lastOutcome;
  }

  private async attemptListRequest(
    config: EligibilityApiConfig,
    credential: string | null,
  ): Promise<IntegrationOutcome<EligibilityListResult>> {
    const url = new URL(
      `${config.baseUrl.replace(/\/$/, '')}${config.requestPath}`,
    );
    try {
      await this.assertUrlIsSafe(url);
    } catch (error) {
      return terminal((error as Error).message);
    }
    const headers: Record<string, string> = { accept: 'application/json' };
    if (config.authType === 'API_KEY_HEADER' && credential) {
      headers[config.authParamName || 'x-api-key'] = credential;
    } else if (config.authType === 'BEARER_TOKEN' && credential) {
      headers.authorization = `Bearer ${credential}`;
    } else if (config.authType === 'QUERY_PARAM' && credential) {
      url.searchParams.set(config.authParamName || 'api_key', credential);
    }

    let body: string | undefined;
    if (config.requestMethod === 'GET') {
      const params = config.requestBodyTemplate ?? {};
      for (const [k, v] of Object.entries(params)) {
        url.searchParams.set(k, String(v));
      }
    } else {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(config.requestBodyTemplate ?? {});
    }

    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      config.listTimeoutMs ?? config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    );

    let res: globalThis.Response;
    try {
      res = await fetch(url, {
        method: config.requestMethod,
        headers,
        body,
        signal: controller.signal,
      });
    } catch (error) {
      clearTimeout(timer);
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `could not reach the eligibility API (fetchAll): ${message}`,
      );
      return retryable(`Không gọi được API: ${message}`);
    }
    clearTimeout(timer);

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return terminal(`API trả về HTTP ${res.status}: ${text.slice(0, 500)}`);
    }

    const text = await res.text();
    let raw: unknown;
    try {
      raw = text ? JSON.parse(text) : null;
    } catch (error) {
      return terminal(
        `API trả về nội dung không phải JSON: ${(error as Error).message}`,
      );
    }

    const records = extractList(raw, config.listResponsePath);
    return success({ raw, records });
  }
}

/**
 * No `listResponsePath` configured, or it doesn't point at an array — same
 * "lookup-by-key returns a bare array, `{data: [...]}}, or a short list"
 * shape family `guessRecord` above covers, but for the whole list rather
 * than just its first item.
 */
function extractList(
  raw: unknown,
  listResponsePath?: string,
): Record<string, unknown>[] {
  const found = listResponsePath ? getByPath(raw, listResponsePath) : raw;
  const asRecords = (value: unknown): Record<string, unknown>[] =>
    Array.isArray(value)
      ? value.filter(
          (item): item is Record<string, unknown> =>
            !!item && typeof item === 'object',
        )
      : [];

  if (Array.isArray(found)) return asRecords(found);
  if (found && typeof found === 'object') {
    const data = (found as Record<string, unknown>).data;
    if (Array.isArray(data)) return asRecords(data);
  }
  return [];
}
