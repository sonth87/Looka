import { z } from 'zod';

/**
 * `campaigns.eligibility_config` jsonb — 2026-09-18 (product feedback: "API
 * điều kiện tiếp nhận... không cần ở màn tạo workflow nữa, thông tin đó sẽ
 * được config trong phần campaign"). Moved here VERBATIM from
 * `apps/api/src/modules/workflow/domain/schema/workflow-config.schema.ts`'s
 * former `eligibilitySchema`/`eligibilityApiSchema`/`eligibilityRuleSchema`
 * (see that file's git history for the original design notes this carries
 * forward) — a workflow is a reusable template shared across many
 * campaigns, but eligibility (which students may be captured) is inherently
 * specific to ONE campaign's own cohort/roster/integration, so it no longer
 * lives on `workflow_versions.config` at all. `WorkflowConfig` itself keeps
 * no trace of eligibility going forward; an already-published
 * `workflow_versions.config` row from before this change may still carry a
 * now-ignored `eligibility` key in its jsonb — harmless, nothing reads it.
 */

const ELIGIBILITY_MODES = [
  'NONE',
  'ROSTER',
  'EXTERNAL_API',
  'ROSTER_AND_API',
] as const;
export type EligibilityMode = (typeof ELIGIBILITY_MODES)[number];

const ELIGIBILITY_AUTH_TYPES = [
  'NONE',
  'API_KEY_HEADER',
  'BEARER_TOKEN',
  'QUERY_PARAM',
] as const;
export type EligibilityApiAuthType = (typeof ELIGIBILITY_AUTH_TYPES)[number];

const ELIGIBILITY_REQUEST_METHODS = ['GET', 'POST'] as const;
export type EligibilityApiRequestMethod =
  (typeof ELIGIBILITY_REQUEST_METHODS)[number];

const eligibilityRuleSchema = z.object({
  key: z.string().min(1),
  expr: z.string().min(1),
  message: z.string().min(1),
});
export type EligibilityRuleConfig = z.infer<typeof eligibilityRuleSchema>;

/**
 * `credential`/`credentialCiphertext` are BOTH declared on purpose:
 * `credential` is the transient plaintext `CampaignService` receives from
 * the CMS and immediately re-encrypts into `credentialCiphertext` before
 * persisting (see `reconcileEligibilityCredential` in
 * `campaign-eligibility-credential.util.ts`) — `credentialCiphertext` is
 * the only one that should ever actually reach the database. `hasCredential`
 * is a read-only annotation `CampaignService.sanitizeEligibilityCredential`
 * sets when returning a campaign to the CMS, stripping the ciphertext out.
 */
/**
 * `EligibilityHttpClient.assertUrlIsSafe` is the actual SSRF defense (it
 * re-resolves the hostname on every call, since a hostname can round-robin
 * or later repoint to an internal address — something a save-time schema
 * check can never fully rule out). This is a cheap, early rejection of
 * outright garbage/non-http(s) values (e.g. `file://`, `gopher://`, a bare
 * host with no scheme) at config-save time, before it ever reaches a worker.
 */
function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

const eligibilityApiSchema = z.object({
  baseUrl: z
    .string()
    .min(1)
    .refine(isHttpUrl, { message: 'baseUrl phải là URL http/https hợp lệ' }),
  requestMethod: z.enum(ELIGIBILITY_REQUEST_METHODS).default('POST'),
  requestPath: z.string().min(1),
  requestBodyTemplate: z.record(z.string(), z.unknown()).optional(),
  authType: z.enum(ELIGIBILITY_AUTH_TYPES).default('API_KEY_HEADER'),
  authParamName: z.string().optional(),
  credential: z.string().optional(),
  credentialCiphertext: z.string().optional(),
  hasCredential: z.boolean().optional(),
  keyResponsePath: z.string().optional(),
  requiredFields: z.array(z.string()).optional(),
  /** 2026-09-18 — retry/timeout for the external API call, see `EligibilityHttpClient.lookup()`'s own doc comment. */
  retryCount: z.number().int().min(0).max(3).optional(),
  timeoutMs: z.number().int().min(1000).max(60_000).optional(),
  /** 2026-09-21 (plan §3.1, feature 1) — path to the ARRAY in a full-pull response, see `EligibilityHttpClient.fetchAll()`. Unset falls back to the same shape-guessing `keyResponsePath` unset does for `lookup()`. */
  listResponsePath: z.string().optional(),
  /** 2026-09-21 — a full-roster pull can be an order of magnitude bigger than one lookup; kept separate from `timeoutMs` so raising it doesn't also loosen the per-student kiosk lookup's own budget. Unset falls back to `timeoutMs`, then the hardcoded default. */
  listTimeoutMs: z.number().int().min(1000).max(120_000).optional(),
});
export type EligibilityApiConfig = z.infer<typeof eligibilityApiSchema>;

export const EligibilityConfigSchema = z.object({
  mode: z.enum(ELIGIBILITY_MODES),
  api: eligibilityApiSchema.optional(),
  rules: z.array(eligibilityRuleSchema).optional(),
});
export type EligibilityConfig = z.infer<typeof EligibilityConfigSchema>;

export const DEFAULT_ELIGIBILITY_CONFIG: EligibilityConfig = { mode: 'NONE' };

export interface EligibilityConfigValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateEligibilityConfigShape(
  config: unknown,
): EligibilityConfigValidationResult {
  const result = EligibilityConfigSchema.safeParse(config);
  if (result.success) return { valid: true, errors: [] };
  return {
    valid: false,
    errors: result.error.issues.map(
      (issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`,
    ),
  };
}
