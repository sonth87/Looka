import { randomBytes } from 'node:crypto';
import {
  reconcileEligibilityCredential,
  sanitizeEligibilityCredential,
} from './campaign-eligibility-credential.util';
import { EligibilityConfig } from './eligibility-config.schema';

const BASE_API = {
  baseUrl: 'https://openapi.dainam.edu.vn',
  requestMethod: 'POST' as const,
  requestPath: '/api/get_list_student_info',
  authType: 'API_KEY_HEADER' as const,
};

const ORIGINAL_KEY = process.env.INTEGRATION_CREDENTIAL_ENCRYPTION_KEY;

// Same convention `eligibility-http.client.spec.ts` already uses —
// `encryptSecret` needs a real key even for a test that never touches a
// real credential's actual value.
beforeEach(() => {
  process.env.INTEGRATION_CREDENTIAL_ENCRYPTION_KEY ??=
    randomBytes(32).toString('base64');
});

afterAll(() => {
  if (ORIGINAL_KEY === undefined) {
    delete process.env.INTEGRATION_CREDENTIAL_ENCRYPTION_KEY;
  } else {
    process.env.INTEGRATION_CREDENTIAL_ENCRYPTION_KEY = ORIGINAL_KEY;
  }
});

describe('reconcileEligibilityCredential', () => {
  it('encrypts a freshly-typed plaintext credential into credentialCiphertext', () => {
    const config: EligibilityConfig = {
      mode: 'EXTERNAL_API',
      api: { ...BASE_API, credential: 'secret-key' },
    };
    const result = reconcileEligibilityCredential(config, null);
    expect(result.api?.credentialCiphertext).toBeDefined();
    expect(result.api?.credentialCiphertext).not.toBe('secret-key');
  });

  it('never leaves the plaintext credential in the returned config', () => {
    const config: EligibilityConfig = {
      mode: 'EXTERNAL_API',
      api: { ...BASE_API, credential: 'secret-key' },
    };
    const result = reconcileEligibilityCredential(config, null);
    expect(result.api).not.toHaveProperty('credential');
  });

  it('preserves the previous ciphertext when this save sends neither credential nor credentialCiphertext', () => {
    const previous: EligibilityConfig = {
      mode: 'EXTERNAL_API',
      api: { ...BASE_API, credentialCiphertext: 'already-stored-ciphertext' },
    };
    // Same shape a CMS save sends when the operator only changed an
    // unrelated field (e.g. retryCount) — GET never echoes back
    // credentialCiphertext, so the CMS's own state never has it either.
    const incoming: EligibilityConfig = {
      mode: 'EXTERNAL_API',
      api: { ...BASE_API, retryCount: 2 },
    };
    const result = reconcileEligibilityCredential(incoming, previous);
    expect(result.api?.credentialCiphertext).toBe('already-stored-ciphertext');
  });

  /**
   * 2026-09-18 field bug: `hasCredential` (a read-only, computed-at-read-time
   * display flag — see `sanitizeEligibilityCredential` below) was leaking
   * into the PERSISTED config, because the old destructuring only stripped
   * `credential` (plaintext) before saving, not `hasCredential`. A round-trip
   * save (GET → naive re-POST of the whole `eligibilityConfig` the CMS
   * already had) would silently persist a stale `hasCredential: true` into
   * the database row itself, alongside the real ciphertext — redundant at
   * best, and a trap if a credential is later legitimately cleared with
   * nothing to recompute it.
   */
  it('strips hasCredential before persisting — it must never reach storage, only reads compute it fresh', () => {
    const previous: EligibilityConfig = {
      mode: 'EXTERNAL_API',
      api: { ...BASE_API, credentialCiphertext: 'already-stored-ciphertext' },
    };
    // Exactly what the CMS's own state looks like after a GET — carries
    // `hasCredential: true` (sanitizeEligibilityCredential's own output)
    // and naively round-trips it back on the next save.
    const incoming: EligibilityConfig = {
      mode: 'EXTERNAL_API',
      api: { ...BASE_API, hasCredential: true },
    };
    const result = reconcileEligibilityCredential(incoming, previous);
    expect(result.api).not.toHaveProperty('hasCredential');
    expect(result.api?.credentialCiphertext).toBe('already-stored-ciphertext');
  });

  it('a brand-new campaign (previous: null) with no credential typed yet ends up with no ciphertext', () => {
    const config: EligibilityConfig = { mode: 'EXTERNAL_API', api: { ...BASE_API } };
    const result = reconcileEligibilityCredential(config, null);
    expect(result.api?.credentialCiphertext).toBeUndefined();
  });

  it('mode NONE (no api block at all) passes the config through untouched', () => {
    const config: EligibilityConfig = { mode: 'NONE' };
    expect(reconcileEligibilityCredential(config, null)).toBe(config);
  });
});

describe('sanitizeEligibilityCredential', () => {
  it('strips credential and credentialCiphertext, computes hasCredential fresh from whether a ciphertext exists', () => {
    const config: EligibilityConfig = {
      mode: 'EXTERNAL_API',
      api: { ...BASE_API, credentialCiphertext: 'stored-ciphertext' },
    };
    const result = sanitizeEligibilityCredential(config);
    expect(result.api).not.toHaveProperty('credential');
    expect(result.api).not.toHaveProperty('credentialCiphertext');
    expect(result.api?.hasCredential).toBe(true);
  });

  it('hasCredential is false when there is no ciphertext stored', () => {
    const config: EligibilityConfig = { mode: 'EXTERNAL_API', api: { ...BASE_API } };
    const result = sanitizeEligibilityCredential(config);
    expect(result.api?.hasCredential).toBe(false);
  });

  it('passes null/undefined through unchanged', () => {
    expect(sanitizeEligibilityCredential(null)).toBeNull();
    expect(sanitizeEligibilityCredential(undefined)).toBeUndefined();
  });
});
