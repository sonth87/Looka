import { app, safeStorage } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { FsClient } from '@face/fs-client';
import { SecretStore, CryptoProvider } from './SecretStore.js';

// Same tenant apps/api provisions under by default (see its file-service.ts) —
// both sides of this platform sharing one tenant name is intentional, not a
// coincidence to preserve. Override with FS_TENANT if a deployment needs the
// desktop kiosks split into their own tenant.
const DEFAULT_FS_TENANT = 'looka-face-capture';
// Same default apps/api uses for the same reason — override with
// FS_CONTACT_EMAIL if a deployment needs a different contact on file.
const DEFAULT_FS_CONTACT_EMAIL = 'camera@dainam.edu.vn';

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

export type SecretKey =
  | 'fs.baseUrl'
  | 'fs.apiKey'
  | 'device.id'
  | 'device.secret'
  | 'device.campaignId'
  | 'device.apiBaseUrl'
  | 'camera.roleMapping';

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
export async function getFileServiceCredentials(): Promise<FileServiceCredentials | null> {
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
  let apiKey = getSecret('fs.apiKey') ?? envKey ?? null;

  if (baseUrl && !apiKey) {
    // No key stored and none supplied — get one the same way apps/api's
    // FileStorageService does at startup: self-service provisioning, keyed
    // by tenant name and idempotent, so a later run just gets the same key
    // back rather than an operator having to type one in by hand.
    try {
      const tenant = process.env.FS_TENANT?.trim() || DEFAULT_FS_TENANT;
      const contactEmail = process.env.FS_CONTACT_EMAIL?.trim() || DEFAULT_FS_CONTACT_EMAIL;
      const provisioned = await FsClient.provision(baseUrl, tenant, { contactEmail });
      apiKey = provisioned.apiKey;
      if (isEncryptionAvailable()) {
        setSecret('fs.baseUrl', baseUrl);
        setSecret('fs.apiKey', apiKey);
      }
      console.warn(`[secrets] provisioned a file-service key for tenant "${tenant}"`);
    } catch (err) {
      console.error('[secrets] self-service provisioning failed:', (err as Error).message);
    }
  }

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


export interface DeviceCredentials {
  deviceId: string;
  deviceSecret: string;
  campaignId: string;
  /** The admin-portal base URL this device talks to — activation.json's `authApiEndpoint`. */
  apiBaseUrl: string | null;
}

/**
 * Device identity, if this kiosk has loaded its activation file — see
 * docs/plans/multi-camera-device-management-discussion.md §3.2. `null`
 * means "installed but not yet activated," which is meant to block every
 * authenticated call the same way an expired device does (§3.3) — callers
 * must check for `null` before doing anything that needs a device identity,
 * not assume registration always happened.
 */
export function getDeviceCredentials(): DeviceCredentials | null {
  const deviceId = getSecret('device.id');
  const deviceSecret = getSecret('device.secret');
  const campaignId = getSecret('device.campaignId');
  if (!deviceId || !deviceSecret || !campaignId) return null;

  return { deviceId, deviceSecret, campaignId, apiBaseUrl: getSecret('device.apiBaseUrl') };
}

export function hasDeviceCredentials(): boolean {
  return getDeviceCredentials() !== null;
}

/**
 * Reads one `activation.json` (the payload `ActivationPackageService` zips
 * up server-side — see its own doc comment) and stores its fields the same
 * way `setFileServiceCredentials` does: encrypted, never left sitting in a
 * plaintext file as the ongoing source of truth. Throws on a missing/malformed
 * file rather than silently leaving the kiosk unactivated with no signal why.
 */
export async function importActivationFile(filePath: string): Promise<DeviceCredentials> {
  const raw = await fs.readFile(filePath, 'utf8');
  const parsed = JSON.parse(raw) as Record<string, unknown>;

  const deviceId = typeof parsed.deviceId === 'string' ? parsed.deviceId : null;
  const deviceSecret = typeof parsed.deviceSecret === 'string' ? parsed.deviceSecret : null;
  const campaignId = typeof parsed.campaignId === 'string' ? parsed.campaignId : null;
  if (!deviceId || !deviceSecret || !campaignId) {
    throw new Error(`Malformed activation file at ${filePath}: missing deviceId/deviceSecret/campaignId`);
  }
  const apiBaseUrl = typeof parsed.authApiEndpoint === 'string' ? parsed.authApiEndpoint : null;

  setSecret('device.id', deviceId);
  setSecret('device.secret', deviceSecret);
  setSecret('device.campaignId', campaignId);
  if (apiBaseUrl) setSecret('device.apiBaseUrl', apiBaseUrl);

  return { deviceId, deviceSecret, campaignId, apiBaseUrl };
}

/**
 * Looks for `activation.json` next to this install and imports it if this
 * kiosk has no device identity yet — a one-time import, the same shape as
 * `getFileServiceCredentials`'s `FS_BASE_URL`/`FS_API_KEY` handling above.
 * Already-activated kiosks skip this entirely, so a leftover activation.json
 * from setup does not silently re-import over an operator's later changes.
 *
 * `LOOKA_ACTIVATION_PATH` overrides the lookup location for development and
 * testing, where there is no real installed-next-to-the-exe layout to read
 * from.
 */
export async function findAndImportActivationFileIfPresent(): Promise<boolean> {
  if (hasDeviceCredentials()) return false;

  const candidate =
    process.env.LOOKA_ACTIVATION_PATH?.trim() ||
    path.join(path.dirname(app.getPath('exe')), 'activation.json');

  try {
    await fs.access(candidate);
  } catch {
    return false;
  }

  try {
    await importActivationFile(candidate);
    console.warn(`[secrets] imported device activation from ${candidate}`);
    return true;
  } catch (err) {
    console.error('[secrets] failed to import activation file:', (err as Error).message);
    return false;
  }
}

export function clearDeviceCredentials(): void {
  deleteSecret('device.id');
  deleteSecret('device.secret');
  deleteSecret('device.campaignId');
  deleteSecret('device.apiBaseUrl');
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

export type CameraRole = 'CENTER' | 'LEFT' | 'RIGHT';

/** Which physical camera (by `enumerateDevices()` id) plays each logical role. */
export type CameraRoleMapping = Partial<Record<CameraRole, string>>;

/**
 * Runtime camera-role mapping — see
 * docs/plans/multi-camera-device-management-discussion.md §2.1. Set once by
 * CB Help (via the camera setup screen) and reused across sessions and
 * hot-swaps; not a secret in the credential sense, but stored the same way
 * as everything else in this file since `secrets.dat` is already the
 * established per-machine local-config store — no reason to invent a second
 * one just for this.
 */
export function getCameraRoleMapping(): CameraRoleMapping {
  const raw = getSecret('camera.roleMapping');
  if (!raw) return {};
  try {
    return JSON.parse(raw) as CameraRoleMapping;
  } catch {
    return {};
  }
}

export function setCameraRoleMapping(mapping: CameraRoleMapping): void {
  setSecret('camera.roleMapping', JSON.stringify(mapping));
}
