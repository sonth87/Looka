import {
  createCipheriv,
  createDecipheriv,
  createHash,
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
  /** sha256 hex of the normalized number — store in `citizen_id_hash`, use for exact-match lookup. */
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
    hash: createHash('sha256').update(normalized).digest('hex'),
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

/** For an exact-match lookup: hash the caller's query the same way `encryptCitizenId` does, without needing a key. */
export function hashCitizenId(citizenId: string): string {
  return createHash('sha256').update(normalize(citizenId)).digest('hex');
}
