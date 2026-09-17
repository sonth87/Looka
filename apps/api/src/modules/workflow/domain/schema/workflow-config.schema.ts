import { z } from 'zod';

/**
 * The workflow `config` jsonb — cms-8-screens-api-plan.md §2.2's exact
 * 6-group jsonc example, validated with `zod` (already a dependency, used
 * the same way `shared/config/env.schema.ts` validates env vars — no new
 * package needed). Backs both `POST /v1/workflows/validate` (dry-run) and
 * every command that writes a draft version's config.
 *
 * `capture.angles` deliberately stays `z.array(z.record(...))` — loose,
 * not a full re-implementation of `CaptureStep`'s shape — the REAL
 * structural check for that array is
 * `device-management/validation/capture-angles.validator.ts`'s existing
 * `validateCaptureAngles()`, imported as a plain function (no Nest module
 * dependency — see this module's own doc comment on why that import does
 * not create a circular module reference) and run alongside this schema
 * rather than duplicated inside it.
 *
 * `identification.methods` is validated against a hardcoded literal union
 * (originally the six method codes cms-8-screens-api-plan.md §2.1/§9.2
 * named, D-Q5) — the real `identification_methods` DB catalog now exists
 * (P3, `device-management/entities/identification-method.entity.ts`, CRUD
 * over `GET/POST/PATCH /v1/identification-methods`) and is seeded with a
 * 7th code, `OCR_CCCD`, added after this union was first written — kept in
 * sync by hand below (2026-09-16) rather than switched to a live DB lookup
 * here, since this schema is a synchronous, dependency-free `zod` object
 * with no DB access of its own; a caller wanting the literal live catalog
 * (e.g. the CMS's own workflow-config editor) reads
 * `GET /v1/identification-methods` directly instead.
 */

const CLICK_MODES = [
  'MANUAL_SEQUENTIAL',
  'MANUAL_ALL_AT_ONCE',
  'AUTO_AI',
] as const;
export type WorkflowClickMode = (typeof CLICK_MODES)[number];

const IDENTIFICATION_METHODS = [
  'QR_CCCD',
  'OCR_CCCD',
  'RFID',
  'NFC',
  'BARCODE',
  'FACE_ID',
  'MANUAL_LOOKUP',
] as const;
export type WorkflowIdentificationMethod =
  (typeof IDENTIFICATION_METHODS)[number];

const ELIGIBILITY_MODES = [
  'NONE',
  'ROSTER',
  'EXTERNAL_API',
  'ROSTER_AND_API',
] as const;
const PRINTING_MODES = ['DIRECT', 'CENTRALIZED'] as const;

const captureAngleStepSchema = z
  .object({ id: z.string().optional(), isCardSource: z.boolean().optional() })
  .catchall(z.unknown());

const captureSchema = z.object({
  angles: z.array(captureAngleStepSchema),
  clickMode: z.object({
    default: z.enum(CLICK_MODES),
    allowed: z.array(z.enum(CLICK_MODES)).min(1),
  }),
  shotsPerCamera: z.number().int().positive().optional(),
  cardSourceAngleCode: z.string().nullable().optional(),
});

const identificationSchema = z.object({
  methods: z.array(z.enum(IDENTIFICATION_METHODS)).min(1),
  lookupKeyField: z.enum(['citizenId', 'studentCode']),
});

const eligibilityRuleSchema = z.object({
  key: z.string().min(1),
  // Expression syntax itself is not evaluated in P2 — see this file's own
  // doc comment: rule EXECUTION against real roster/session data is P3
  // scope (campaign_subjects/eligibility_check_logs), where a safe
  // expression library (json-logic-js/expr-eval, never eval()) gets
  // wired in per the plan's own recommendation. Only "non-empty string"
  // is checked here.
  expr: z.string().min(1),
  message: z.string().min(1),
});

const ELIGIBILITY_AUTH_TYPES = [
  'NONE',
  'API_KEY_HEADER',
  'BEARER_TOKEN',
  'QUERY_PARAM',
] as const;
const ELIGIBILITY_REQUEST_METHODS = ['GET', 'POST'] as const;

/**
 * Inline, per-workflow API config (2026-09-17 redo of plan item 7) — the
 * user explicitly rejected the first design (a DB-wide `eligibility_api_clients`
 * catalog shared across every workflow, one class-per-integration before
 * that): "API điều kiện tiếp nhận là config trong workflow luôn chứ không
 * dùng chung như hiện tại". Every field a workflow's own API call needs
 * lives directly in ITS OWN `config.eligibility.api`, versioned/immutable
 * with the rest of `workflow_versions.config` — no separate table, no
 * cross-workflow reuse.
 *
 * `credential`/`credentialCiphertext` are BOTH declared here on purpose:
 * `credential` is the transient plaintext a command handler receives from
 * the CMS and immediately re-encrypts into `credentialCiphertext` before
 * persisting (see `create-workflow.handler.ts`/
 * `update-workflow-version-config.handler.ts`'s own doc comment) —
 * `credentialCiphertext` is the only one that should ever actually reach
 * the database. Both stay optional here so this same schema validates a
 * dry-run (`POST /v1/workflows/validate`, plaintext still present) and an
 * already-persisted version (only ciphertext present) without needing two
 * schemas.
 *
 * `hasCredential` is a THIRD, read-only annotation — `workflow-catalog.read-repository.ts`'s
 * `sanitizeEligibilityCredential` strips `credentialCiphertext` out of
 * whatever config it hands to the CMS and sets this instead, so the CMS
 * can show "đã có credential" without ever seeing the encrypted value.
 * Never read by anything that writes config back (the credential-reconcile
 * step only ever looks at `credential`/`credentialCiphertext`).
 */
const eligibilityApiSchema = z.object({
  baseUrl: z.string().min(1),
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
});

const eligibilitySchema = z.object({
  mode: z.enum(ELIGIBILITY_MODES),
  api: eligibilityApiSchema.optional(),
  rules: z.array(eligibilityRuleSchema).optional(),
  rosterTemplate: z.string().optional(),
});

const aiProcessingStepSchema = z.object({
  code: z.string().min(1),
  params: z.record(z.string(), z.unknown()).optional().default({}),
});

const aiProcessingSchema = z.object({
  enabled: z.boolean(),
  steps: z.array(aiProcessingStepSchema),
});

const cardSpecSchema = z.object({
  size: z.enum(['3x4', '4x6']),
  dpi: z.union([z.literal(300), z.literal(600)]),
  backgroundColor: z.string().min(1),
  headHeightRatio: z.tuple([z.number(), z.number()]),
  eyeLineRatio: z.tuple([z.number(), z.number()]),
  retouch: z.object({ enabled: z.boolean() }),
});

const outputSchema = z.object({
  photoKindCode: z.string().min(1),
  cardSpec: cardSpecSchema,
});

const printingSchema = z.object({
  mode: z.enum(PRINTING_MODES),
});

export const WorkflowConfigSchema = z.object({
  capture: captureSchema,
  identification: identificationSchema,
  eligibility: eligibilitySchema,
  aiProcessing: aiProcessingSchema,
  output: outputSchema,
  printing: printingSchema,
});

export type WorkflowConfig = z.infer<typeof WorkflowConfigSchema>;

export interface WorkflowConfigValidationResult {
  valid: boolean;
  errors: string[];
}

/** Structural check only (zod) — `capture.angles`' own deeper rules run separately, see this file's own doc comment. */
export function validateWorkflowConfigShape(
  config: unknown,
): WorkflowConfigValidationResult {
  const result = WorkflowConfigSchema.safeParse(config);
  if (result.success) return { valid: true, errors: [] };
  return {
    valid: false,
    errors: result.error.issues.map(
      (issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`,
    ),
  };
}
