import { randomBytes, createHash, timingSafeEqual } from 'crypto';

/** 32 random bytes, hex-encoded — handed to the kiosk exactly once, never stored in plaintext. */
export function generateDeviceSecret(): string {
  return randomBytes(32).toString('hex');
}

export function hashDeviceSecret(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex');
}

/**
 * Constant-time compare, same reasoning as `ApiKeyMiddleware`'s use of
 * `timingSafeEqual`: a length/byte-position-timed comparison would let a
 * caller recover the secret one correct byte at a time.
 */
export function verifyDeviceSecret(
  secret: string,
  storedHash: string,
): boolean {
  const candidate = Buffer.from(hashDeviceSecret(secret), 'hex');
  const expected = Buffer.from(storedHash, 'hex');
  return (
    candidate.length === expected.length && timingSafeEqual(candidate, expected)
  );
}
