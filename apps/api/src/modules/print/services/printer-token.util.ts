import { createHash, randomBytes } from 'node:crypto';

/**
 * 32 random bytes, hex-encoded — handed to the print agent exactly once (the
 * response body of `POST /v1/printers/:id/token`), never stored in
 * plaintext. Mirrors `device-secret.util.ts`'s `generateDeviceSecret`.
 */
export function generatePrinterToken(): string {
  return randomBytes(32).toString('hex');
}

export function hashPrinterToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}
