import { encryptSecret } from '@app/shared/security/secret.codec';
import { WorkflowConfig } from '../domain/schema/workflow-config.schema';

/**
 * Encrypts `config.eligibility.api.credential` (plaintext, sent by the CMS
 * only when the workflow author actually typed a new one) into
 * `credentialCiphertext` before a draft's config is persisted — 2026-09-17
 * redo of plan item 7. Called from both `CreateWorkflowHandler` and
 * `UpdateWorkflowVersionConfigHandler`, right before `checkWorkflowConfig`/
 * persistence, so a plaintext credential is never written to
 * `workflow_versions.config` even for one transaction.
 *
 * `GET /v1/workflows/:id` strips `credentialCiphertext` back out of what it
 * returns (see `workflow-catalog.read-repository.ts`'s own doc comment),
 * exposing only a `hasCredential` boolean — which means a save that only
 * touches an unrelated field (e.g. renaming a rule) arrives here with
 * NEITHER `credential` NOR `credentialCiphertext` set, even though a real
 * credential is already stored. `previousConfig` (the draft's config
 * before this save) is how this function tells "nothing new was sent, keep
 * what's there" apart from "explicitly cleared" — passed `null` only for a
 * brand new workflow (`CreateWorkflowHandler`, nothing to preserve yet).
 */
export function reconcileEligibilityCredential(
  config: WorkflowConfig,
  previousConfig: WorkflowConfig | null,
): WorkflowConfig {
  const api = config.eligibility?.api;
  if (!api) return config;

  let credentialCiphertext = api.credentialCiphertext;
  if (api.credential) {
    credentialCiphertext = encryptSecret(api.credential);
  } else if (!credentialCiphertext) {
    credentialCiphertext =
      previousConfig?.eligibility?.api?.credentialCiphertext;
  }

  const { credential, ...rest } = api;
  return {
    ...config,
    eligibility: {
      ...config.eligibility,
      api: { ...rest, credentialCiphertext },
    },
  };
}
