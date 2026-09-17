import { createHash, createHmac, randomBytes } from 'node:crypto';
import {
  decryptCitizenId,
  encryptCitizenId,
  hashCitizenId,
} from './citizen-id.codec';

const ORIGINAL_KEY = process.env.CITIZEN_ID_ENCRYPTION_KEY;

describe('citizen-id.codec', () => {
  beforeEach(() => {
    process.env.CITIZEN_ID_ENCRYPTION_KEY = randomBytes(32).toString('base64');
  });

  afterAll(() => {
    if (ORIGINAL_KEY === undefined)
      delete process.env.CITIZEN_ID_ENCRYPTION_KEY;
    else process.env.CITIZEN_ID_ENCRYPTION_KEY = ORIGINAL_KEY;
  });

  it('round-trips a CCCD through encrypt/decrypt', () => {
    const { enc } = encryptCitizenId('014203003990');
    expect(decryptCitizenId(enc)).toBe('014203003990');
  });

  it('hashCitizenId and the hash returned by encryptCitizenId agree for the same input', () => {
    const { hash } = encryptCitizenId('014203003990');
    expect(hashCitizenId('014203003990')).toBe(hash);
  });

  it('normalizes non-digit characters the same way before hashing', () => {
    expect(hashCitizenId('014 203 003 990')).toBe(
      hashCitizenId('014203003990'),
    );
  });

  it('the hash is HMAC-SHA256 keyed by CITIZEN_ID_ENCRYPTION_KEY, not a bare unkeyed SHA-256 (2026-09-16 database audit §2.2)', () => {
    const key = Buffer.from(process.env.CITIZEN_ID_ENCRYPTION_KEY!, 'base64');
    const expected = createHmac('sha256', key)
      .update('014203003990')
      .digest('hex');
    expect(hashCitizenId('014203003990')).toBe(expected);

    // The old, vulnerable behaviour this replaces — must NOT match anymore.
    const unkeyed = createHash('sha256').update('014203003990').digest('hex');
    expect(hashCitizenId('014203003990')).not.toBe(unkeyed);
  });

  it('a different CITIZEN_ID_ENCRYPTION_KEY produces a different hash for the same CCCD', () => {
    const hashA = hashCitizenId('014203003990');
    process.env.CITIZEN_ID_ENCRYPTION_KEY = randomBytes(32).toString('base64');
    const hashB = hashCitizenId('014203003990');
    expect(hashA).not.toBe(hashB);
  });
});
