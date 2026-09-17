import { Injectable, Logger } from '@nestjs/common';
import {
  IntegrationOutcome,
  retryable,
  success,
  terminal,
} from '@app/shared/integrations/integration-outcome';
import { decryptSecret } from '@app/shared/security/secret.codec';

export type EligibilityApiAuthType =
  'NONE' | 'API_KEY_HEADER' | 'BEARER_TOKEN' | 'QUERY_PARAM';
export type EligibilityApiRequestMethod = 'GET' | 'POST';

/**
 * Inline `eligibility.api` config, per-workflow (2026-09-17 redo of plan
 * item 7 — no separate `eligibility_api_clients` catalog anymore, see this
 * file's own doc comment below). Same shape `eligibilityApiSchema` in
 * `workflow-config.schema.ts` validates. `credentialCiphertext` is the
 * encrypted-at-rest form; a caller resolving this from a saved workflow
 * version passes it through as-is, `EligibilityHttpClient` decrypts it.
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
}

export interface EligibilityLookupResult {
  /** The full parsed response body, exactly as returned — the CMS keeps this in local state as the field-picker's source, see `WorkflowConfigEditor.tsx`. */
  raw: unknown;
  /** The matched record extracted from `raw` — see this file's own doc comment on how. */
  record: Record<string, unknown> | null;
}

const REQUEST_TIMEOUT_MS = 15_000;

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
 * Generic executor for ONE workflow's own `config.eligibility.api` (2026-09-17
 * redo of plan item 7) — the first version of this class executed a row
 * from a shared, DB-wide `eligibility_api_clients` catalog; the user
 * explicitly rejected that ("API điều kiện tiếp nhận là config trong
 * workflow luôn chứ không dùng chung như hiện tại") — every workflow now
 * owns its own inline config, versioned/immutable with the rest of
 * `workflow_versions.config`, no cross-workflow reuse and no separate
 * table. This class itself stays exactly as generic as before — it just
 * takes a plain `EligibilityApiConfig` object instead of an entity row, so
 * it works identically whether the config came from a saved workflow
 * version or an ad-hoc, not-yet-saved draft being test-called from the CMS.
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

    const url = new URL(
      `${config.baseUrl.replace(/\/$/, '')}${config.requestPath}`,
    );
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
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

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
}
