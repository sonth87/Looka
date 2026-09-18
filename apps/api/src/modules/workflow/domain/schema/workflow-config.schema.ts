import { z } from 'zod';

/**
 * The workflow `config` jsonb — originally cms-8-screens-api-plan.md §2.2's
 * 6-group jsonc example, validated with `zod` (already a dependency, used
 * the same way `shared/config/env.schema.ts` validates env vars — no new
 * package needed). Backs both `POST /v1/workflows/validate` (dry-run) and
 * every command that writes a draft version's config.
 *
 * Down to 5 groups as of 2026-09-18 — `eligibility` moved OUT entirely (see
 * `device-management/domain/eligibility-config.schema.ts`'s own doc
 * comment): a workflow is reused across many campaigns, but eligibility is
 * inherently specific to one campaign's own roster/integration, so it now
 * lives on `campaigns.eligibility_config` instead. An already-published
 * `workflow_versions.config` row from before this change may still carry a
 * now-ignored `eligibility` key — harmless, nothing reads it anymore.
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
