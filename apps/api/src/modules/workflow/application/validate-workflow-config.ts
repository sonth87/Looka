import { validateCaptureAngles } from '@app/modules/device-management/validation/capture-angles.validator';
import {
  WorkflowConfig,
  validateWorkflowConfigShape,
} from '../domain/schema/workflow-config.schema';

export interface WorkflowConfigCheckResult {
  valid: boolean;
  errors: string[];
}

/**
 * Two-layer check, shared by `create-workflow.handler.ts`,
 * `update-workflow-version-config.handler.ts`, and
 * `validate-workflow-config.handler.ts` (the `POST /v1/workflows/validate`
 * dry-run) so the three never drift apart:
 *
 *   1. zod structural check (`validateWorkflowConfigShape`) — the 6-group
 *      shape itself.
 *   2. `capture.angles`' own deeper rules, via
 *      `device-management/validation/capture-angles.validator.ts`'s
 *      EXISTING `validateCaptureAngles()` — imported as a plain function,
 *      not a Nest provider, so this does NOT create a circular Nest
 *      module dependency (`WorkflowModule` never imports
 *      `DeviceManagementModule`; only the reverse, for the config-merge
 *      read repository — see `identity.module.ts`'s export precedent for
 *      why that direction is safe). A pure-function cross-module import
 *      like this one only needs TypeScript module resolution, not Nest DI
 *      wiring.
 */
export function checkWorkflowConfig(
  config: unknown,
): WorkflowConfigCheckResult {
  const shapeCheck = validateWorkflowConfigShape(config);
  if (!shapeCheck.valid) {
    return shapeCheck;
  }

  const angles = (config as WorkflowConfig).capture.angles;
  const anglesCheck = validateCaptureAngles(angles);
  if (!anglesCheck.ok) {
    return { valid: false, errors: [`capture.angles: ${anglesCheck.reason}`] };
  }

  return { valid: true, errors: [] };
}
