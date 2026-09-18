import { encryptSecret } from '@app/shared/security/secret.codec';
import { EligibilityConfig } from './eligibility-config.schema';

/**
 * Encrypts `eligibility.api.credential` (plaintext, sent by the CMS only
 * when the campaign editor actually typed a new one) into
 * `credentialCiphertext` before a campaign's `eligibility_config` is
 * persisted — 2026-09-18, moved verbatim from the workflow module's own
 * `reconcileEligibilityCredential` (see that file's git history) now that
 * eligibility lives on `campaigns` instead of `workflow_versions.config`.
 * Called from `CampaignService.createCampaign`/`updateCampaign`, right
 * before persistence, so a plaintext credential is never written to the DB
 * even for one transaction.
 *
 * `GET /v1/campaigns`/`GET /v1/campaigns/:id` strip `credentialCiphertext`
 * back out of what they return (see `sanitizeEligibilityCredential` below),
 * exposing only a `hasCredential` boolean — which means a save that only
 * touches an unrelated field (e.g. renaming the campaign) arrives here with
 * NEITHER `credential` NOR `credentialCiphertext` set, even though a real
 * credential is already stored. `previous` (the campaign's eligibility
 * config before this save) is how this function tells "nothing new was
 * sent, keep what's there" apart from "explicitly cleared" — passed `null`
 * only for a brand new campaign, nothing to preserve yet.
 */
export function reconcileEligibilityCredential(
  config: EligibilityConfig,
  previous: EligibilityConfig | null,
): EligibilityConfig {
  const api = config.api;
  if (!api) return config;

  let credentialCiphertext = api.credentialCiphertext;
  if (api.credential) {
    credentialCiphertext = encryptSecret(api.credential);
  } else if (!credentialCiphertext) {
    credentialCiphertext = previous?.api?.credentialCiphertext;
  }

  // 2026-09-18 field bug: `hasCredential` is a computed, read-only display
  // flag `sanitizeEligibilityCredential` sets fresh on every GET (below) —
  // it was never meant to be part of the persisted config at all. Leaving
  // it in `rest` meant the CMS's own GET response (which naturally carries
  // `hasCredential: true`) got echoed straight back into the save payload
  // and PERSISTED verbatim, alongside the real `credentialCiphertext` —
  // redundant, and a latent trap: a save that legitimately clears the
  // credential (`api.credential` unset, no previous ciphertext to carry
  // forward) would still persist a stale `hasCredential: true` with no
  // actual secret behind it, since nothing recomputes this field at
  // WRITE time, only at read time.
  const { credential, hasCredential: _hasCredential, ...rest } = api;
  return { ...config, api: { ...rest, credentialCiphertext } };
}

/**
 * Strips `eligibility.api.credential`/`credentialCiphertext` out of
 * whatever config a campaign read response returns to the CMS — never echo
 * an encrypted secret back to a browser even encrypted. Sets `hasCredential`
 * instead so the CMS can show "đã có credential" without ever seeing the
 * encrypted value. Never applied to the execution path (`lookupSubject`),
 * which reads the real, un-sanitized `campaigns.eligibility_config` column
 * straight from the DB — only CMS-facing reads (`toCampaignResponse`) go
 * through this.
 */
export function sanitizeEligibilityCredential(
  config: EligibilityConfig,
): EligibilityConfig;
export function sanitizeEligibilityCredential(
  config: EligibilityConfig | null | undefined,
): EligibilityConfig | null | undefined;
export function sanitizeEligibilityCredential(
  config: EligibilityConfig | null | undefined,
): EligibilityConfig | null | undefined {
  if (!config?.api) return config;
  const { credential, credentialCiphertext, ...restApi } = config.api;
  return {
    ...config,
    api: { ...restApi, hasCredential: !!credentialCiphertext },
  };
}
