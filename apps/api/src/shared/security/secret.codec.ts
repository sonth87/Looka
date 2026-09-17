import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * At-rest encryption for a generic third-party integration credential (API
 * key/access token) — plan item 7, 2026-09-17 ("Điều kiện tiếp nhận": mỗi
 * `eligibility_api_clients` row may carry its own credential, entered from
 * the CMS instead of a fixed server env var).
 *
 * Same AES-256-GCM primitive/packing `citizen-id.codec.ts` already uses
 * (authenticated, tamper-evident, random 12-byte IV per call,
 * `iv || authTag || ciphertext` packed into one base64 string) — a
 * DIFFERENT env var/key (`INTEGRATION_CREDENTIAL_ENCRYPTION_KEY`) on
 * purpose: an arbitrary API key/token is not a CCCD (no fixed digit format,
 * no need for an exact-match hash), and keeping the two domains on separate
 * keys means rotating one never touches the other.
 */
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

function loadKey(): Buffer {
  const raw = process.env.INTEGRATION_CREDENTIAL_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      'INTEGRATION_CREDENTIAL_ENCRYPTION_KEY is not set — cannot encrypt/decrypt an integration credential. ' +
        "Generate one with `node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\"` " +
        'and set it in .env (see .env.example).',
    );
  }
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error(
      `INTEGRATION_CREDENTIAL_ENCRYPTION_KEY must decode to exactly 32 bytes (got ${key.length}) — ` +
        're-generate it as base64 of 32 random bytes.',
    );
  }
  return key;
}

/** Store the return value as-is in `credential_ciphertext`. */
export function encryptSecret(plaintext: string): string {
  const key = loadKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString('base64');
}

export function decryptSecret(enc: string): string {
  const key = loadKey();
  const packed = Buffer.from(enc, 'base64');
  const iv = packed.subarray(0, IV_LENGTH);
  const authTag = packed.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = packed.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString('utf8');
}
