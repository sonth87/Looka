import { randomBytes } from 'node:crypto';
import { decryptSecret, encryptSecret } from './secret.codec';

const ORIGINAL_KEY = process.env.INTEGRATION_CREDENTIAL_ENCRYPTION_KEY;

describe('secret.codec', () => {
  beforeEach(() => {
    process.env.INTEGRATION_CREDENTIAL_ENCRYPTION_KEY =
      randomBytes(32).toString('base64');
  });

  afterAll(() => {
    if (ORIGINAL_KEY === undefined) {
      delete process.env.INTEGRATION_CREDENTIAL_ENCRYPTION_KEY;
    } else {
      process.env.INTEGRATION_CREDENTIAL_ENCRYPTION_KEY = ORIGINAL_KEY;
    }
  });

  it('round-trips an arbitrary secret through encrypt/decrypt', () => {
    const enc = encryptSecret(
      'sk_live_abc123.veryLongToken~with-special_chars',
    );
    expect(decryptSecret(enc)).toBe(
      'sk_live_abc123.veryLongToken~with-special_chars',
    );
  });

  it('produces a different ciphertext for the same plaintext each call (random IV)', () => {
    const first = encryptSecret('same-secret');
    const second = encryptSecret('same-secret');
    expect(first).not.toBe(second);
    expect(decryptSecret(first)).toBe('same-secret');
    expect(decryptSecret(second)).toBe('same-secret');
  });

  it('throws on a tampered ciphertext (authenticated encryption)', () => {
    const enc = encryptSecret('secret-value');
    const tampered = Buffer.from(enc, 'base64');
    tampered[tampered.length - 1] ^= 0xff;
    expect(() => decryptSecret(tampered.toString('base64'))).toThrow();
  });

  it('throws a clear error when the key is unset', () => {
    delete process.env.INTEGRATION_CREDENTIAL_ENCRYPTION_KEY;
    expect(() => encryptSecret('x')).toThrow(
      /INTEGRATION_CREDENTIAL_ENCRYPTION_KEY/,
    );
  });
});
