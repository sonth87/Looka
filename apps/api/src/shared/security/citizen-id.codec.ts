import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
} from 'node:crypto';

/**
 * At-rest encryption for the CCCD/citizen-id number — cms-8-screens-api-plan.md
 * §8 I-Q1. Pure `node:crypto`, no NestJS DI: this has zero business
 * dependency (no module import, no repository), so it lives directly under
 * `shared/security/` rather than as an `@Injectable()` — a plain function
 * module is enough, and keeps `shared/` free of anything that needs the DI
 * container just to be testable.
 *
 * AES-256-GCM: authenticated (tamper-evident — `decrypt()` throws on a
 * modified ciphertext, unlike AES-CBC), and a 12-byte random IV per call
 * from `CITIZEN_ID_ENCRYPTION_KEY` (32 raw bytes, base64). Output packs
 * `iv || authTag || ciphertext` into one base64 string — nothing else in
 * this codebase currently needs to store IV/tag as separate columns, and a
 * single opaque column is simplest to migrate away from later if the key
 * management story changes.
 *
 * The exact-match lookup hash is **HMAC-SHA256, keyed with the same
 * `CITIZEN_ID_ENCRYPTION_KEY`** — not a bare `SHA-256` (2026-09-16 database
 * audit, §2.2). A Vietnamese CCCD is a 12-digit number with a known,
 * structured format (province + century/gender/birth-year + sequence), so
 * its real entropy is far below 10¹²; an unkeyed hash lets anyone who
 * obtains a DB dump precompute every plausible CCCD's hash and reverse
 * `citizen_id_hash` in well under an hour on ordinary hardware — the column
 * would satisfy "don't store plaintext" in form only. Keying the hash with
 * a secret only this server holds makes that precomputation attack
 * infeasible without the key, while still allowing an exact-match lookup
 * with no decryption (see `hashCitizenId`). Reuses the same 32-byte secret
 * `encryptCitizenId` already uses for AES-256-GCM rather than a second env
 * var — HMAC-SHA256 and AES-256-GCM are different algorithms/domains, so
 * sharing the key material here is a standard, accepted simplification, not
 * a weakening of either.
 */
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

function loadKey(): Buffer {
  const raw = process.env.CITIZEN_ID_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      'CITIZEN_ID_ENCRYPTION_KEY is not set — cannot encrypt/decrypt a citizen id. ' +
        "Generate one with `node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\"` " +
        'and set it in .env (see .env.example).',
    );
  }
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error(
      `CITIZEN_ID_ENCRYPTION_KEY must decode to exactly 32 bytes (got ${key.length}) — ` +
        're-generate it as base64 of 32 random bytes.',
    );
  }
  return key;
}

/** Digits only — the same normalization a 12-digit CCCD scan or manual entry should already be in. */
function normalize(citizenId: string): string {
  return citizenId.replace(/\D/g, '');
}

export interface EncryptedCitizenId {
  /** base64(iv || authTag || ciphertext) — store as-is in `citizen_id_enc`. */
  enc: string;
  /** HMAC-SHA256 (keyed) hex of the normalized number — store in `citizen_id_hash`, use for exact-match lookup. */
  hash: string;
  /** Last 4 digits — store in `citizen_id_last4`, safe to display without decrypting. */
  last4: string;
}

export function encryptCitizenId(citizenId: string): EncryptedCitizenId {
  const normalized = normalize(citizenId);
  const key = loadKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(normalized, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return {
    enc: Buffer.concat([iv, authTag, ciphertext]).toString('base64'),
    hash: createHmac('sha256', key).update(normalized).digest('hex'),
    last4: normalized.slice(-4),
  };
}

export function decryptCitizenId(enc: string): string {
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

/** For an exact-match lookup: hash the caller's query the same way `encryptCitizenId` does — needs `CITIZEN_ID_ENCRYPTION_KEY`, same as encrypt/decrypt, since the hash is now keyed. */
export function hashCitizenId(citizenId: string): string {
  return createHmac('sha256', loadKey())
    .update(normalize(citizenId))
    .digest('hex');
}
