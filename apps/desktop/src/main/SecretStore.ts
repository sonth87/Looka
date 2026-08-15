import fs from 'node:fs';

/**
 * The OS-backed encryption this store relies on.
 *
 * Kept as an interface so the storage rules can be exercised without Electron,
 * and so a different backend can be substituted without touching callers.
 */
export interface CryptoProvider {
  isAvailable(): boolean;
  encrypt(plaintext: string): Buffer;
  decrypt(ciphertext: Buffer): string;
}

interface SecretFile {
  version: 1;
  /** base64 of the encrypted buffer, per key. */
  values: Record<string, string>;
}

/**
 * Encrypted key/value store on disk.
 *
 * Two rules it enforces, both because the failure modes are silent:
 *
 *   - Never writes plaintext. If the OS cannot encrypt, storing fails loudly
 *     rather than leaving a readable API key on disk that nobody notices.
 *   - Writes atomically. A crash mid-write must not truncate the file and take
 *     every stored secret with it.
 */
export class SecretStore {
  constructor(
    private readonly filePath: string,
    private readonly crypto: CryptoProvider
  ) {}

  public isEncryptionAvailable(): boolean {
    try {
      return this.crypto.isAvailable();
    } catch {
      return false;
    }
  }

  /** Store a value. Throws when encryption is unavailable. */
  public set(key: string, value: string): void {
    if (!this.isEncryptionAvailable()) {
      throw new Error(
        'OS encryption is unavailable, so the secret was not saved. ' +
          'Storing it unencrypted would be worse than not storing it.'
      );
    }
    const data = this.read();
    data.values[key] = this.crypto.encrypt(value).toString('base64');
    this.write(data);
  }

  /** Read a value, or null when absent or undecryptable. */
  public get(key: string): string | null {
    const encoded = this.read().values[key];
    if (!encoded) return null;
    try {
      return this.crypto.decrypt(Buffer.from(encoded, 'base64'));
    } catch {
      // Typically the store was copied from another machine or user account:
      // the ciphertext is intact but this profile holds no key for it.
      return null;
    }
  }

  public has(key: string): boolean {
    return this.get(key) !== null;
  }

  public delete(key: string): void {
    const data = this.read();
    delete data.values[key];
    this.write(data);
  }

  /** Key names only — useful for diagnostics that must not reveal values. */
  public keys(): string[] {
    return Object.keys(this.read().values);
  }

  private read(): SecretFile {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8')) as SecretFile;
      if (parsed?.version !== 1 || typeof parsed.values !== 'object' || parsed.values === null) {
        return { version: 1, values: {} };
      }
      return parsed;
    } catch {
      // Missing or corrupt: start empty rather than crashing the app at launch.
      return { version: 1, values: {} };
    }
  }

  private write(data: SecretFile): void {
    const tmp = `${this.filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 });
    fs.renameSync(tmp, this.filePath);
  }
}
