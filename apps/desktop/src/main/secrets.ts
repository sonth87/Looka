import { app, safeStorage } from 'electron';
import path from 'node:path';
import { SecretStore, CryptoProvider } from './SecretStore.js';

/**
 * Secret storage for the main process.
 *
 * Values are encrypted by the OS keychain (DPAPI on Windows, Keychain on macOS)
 * and written to userData. Two things this deliberately does not do:
 *
 *   - keep secrets in environment variables or a config file, where anyone with
 *     read access to the machine — or a stray dump of process.env — gets them;
 *   - expose values over IPC. The renderer learns only whether a credential is
 *     configured, never what it is.
 *
 * The storage rules live in SecretStore, which is testable without Electron.
 */

export type SecretKey = 'fs.baseUrl' | 'fs.apiKey';

const electronCrypto: CryptoProvider = {
  isAvailable: () => safeStorage.isEncryptionAvailable(),
  encrypt: (plaintext) => safeStorage.encryptString(plaintext),
  decrypt: (ciphertext) => safeStorage.decryptString(ciphertext),
};

let store: SecretStore | null = null;

function getStore(): SecretStore {
  if (!store) {
    store = new SecretStore(path.join(app.getPath('userData'), 'secrets.dat'), electronCrypto);
  }
  return store;
}

export function isEncryptionAvailable(): boolean {
  return getStore().isEncryptionAvailable();
}

export function setSecret(key: SecretKey, value: string): void {
  getStore().set(key, value);
}

export function getSecret(key: SecretKey): string | null {
  return getStore().get(key);
}

export function deleteSecret(key: SecretKey): void {
  getStore().delete(key);
}

export function hasSecret(key: SecretKey): boolean {
  return getStore().has(key);
}

export interface FileServiceCredentials {
  baseUrl: string;
  apiKey: string;
}

/**
 * Credentials for the file-service, if configured.
 *
 * Environment variables are accepted as a one-time import path for development
 * and first-run provisioning, then migrated into encrypted storage so the
 * plaintext copy stops being the source of truth.
 */
export function getFileServiceCredentials(): FileServiceCredentials | null {
  const envBase = process.env.FS_BASE_URL?.trim();
  const envKey = process.env.FS_API_KEY?.trim();

  if (envBase && envKey && isEncryptionAvailable()) {
    try {
      setSecret('fs.baseUrl', envBase);
      setSecret('fs.apiKey', envKey);
      console.warn(
        '[secrets] imported FS_BASE_URL/FS_API_KEY into encrypted storage; ' +
          'remove them from the environment now that they are stored.'
      );
    } catch (err) {
      console.error('[secrets] could not store credentials:', (err as Error).message);
    }
  }

  const baseUrl = getSecret('fs.baseUrl') ?? envBase ?? null;
  const apiKey = getSecret('fs.apiKey') ?? envKey ?? null;
  if (!baseUrl || !apiKey) return null;

  return { baseUrl, apiKey };
}

/** Save credentials entered by an operator during setup. */
export function setFileServiceCredentials(creds: FileServiceCredentials): void {
  setSecret('fs.baseUrl', creds.baseUrl);
  setSecret('fs.apiKey', creds.apiKey);
}

export function clearFileServiceCredentials(): void {
  deleteSecret('fs.baseUrl');
  deleteSecret('fs.apiKey');
}

/** What the renderer is allowed to know: configured or not, never the values. */
export interface SecretsStatus {
  encryptionAvailable: boolean;
  fileServiceConfigured: boolean;
  /** Host only, so an operator can confirm the target without seeing the key. */
  fileServiceHost: string | null;
}

export function secretsStatus(): SecretsStatus {
  const baseUrl = getSecret('fs.baseUrl');
  let host: string | null = null;
  if (baseUrl) {
    try {
      host = new URL(baseUrl).host;
    } catch {
      host = null;
    }
  }
  return {
    encryptionAvailable: isEncryptionAvailable(),
    fileServiceConfigured: hasSecret('fs.apiKey') && baseUrl !== null,
    fileServiceHost: host,
  };
}
