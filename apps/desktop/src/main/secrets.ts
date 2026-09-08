import { app, safeStorage } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { CAMERA_ROLES, type CameraRole } from '@face/core';
import { FsClient } from '@face/fs-client';
import { SecretStore, CryptoProvider } from './SecretStore.js';
import { parseActivationPayload, activationFileSupersedesStored } from './activationFile.js';

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
  | 'device.lastVerified'
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
      // Per-device tenant (§3.3): a kiosk that has gone through activation
      // provisions its OWN fs-core key, keyed by its device id — so revoking
      // one expired/misbehaving device only means invalidating that one key
      // at fs-core, not the whole fleet's shared key. Falls back to the old
      // shared tenant for a kiosk with no device identity yet (predates
      // device registration, or still mid-setup).
      const tenant =
        getDeviceCredentials()?.deviceId ||
        process.env.FS_TENANT?.trim() ||
        DEFAULT_FS_TENANT;
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
 * Parsing/validation itself lives in `activationFile.ts` (Electron-free, so
 * it can be unit-tested — see that file's own doc comment).
 *
 * This is now also the re-activation path (2026-09-08, "kiosk 3" incident
 * fix), not just first-time setup: `findAndImportActivationFileIfPresent`
 * below calls this again on an already-activated kiosk once its
 * activation.json describes a genuinely new credential. The §3.3 24h
 * fail-closed clock (`setLastVerifiedDeviceState`) is only reset when the
 * device id itself changed, or there was no prior credential at all — a
 * secret-only rotation of the SAME device keeps the offline config cache,
 * since nothing about which campaign/config this kiosk trusts has changed.
 */
export async function importActivationFile(filePath: string): Promise<DeviceCredentials> {
  const raw = await fs.readFile(filePath, 'utf8');
  let parsed: ReturnType<typeof parseActivationPayload>;
  try {
    parsed = parseActivationPayload(raw);
  } catch (err) {
    throw new Error(`Malformed activation file at ${filePath}: ${(err as Error).message}`);
  }
  const { deviceId, deviceSecret, campaignId, apiBaseUrl } = parsed;

  const priorDeviceId = getSecret('device.id');

  setSecret('device.id', deviceId);
  setSecret('device.secret', deviceSecret);
  setSecret('device.campaignId', campaignId);
  if (apiBaseUrl) setSecret('device.apiBaseUrl', apiBaseUrl);

  if (priorDeviceId === null || priorDeviceId !== deviceId) {
    // Seeds the §3.3 24h fail-closed clock at activation time, with no
    // config yet — an admin just registered this exact device, which is
    // itself a trust-establishing moment. Without this, a kiosk whose
    // network isn't up yet on its very first boot would read as "never
    // verified" and could be treated as already-expired before it ever got
    // a chance to phone home. Skipped when the same device just got a new
    // secret (rotation) — the last confirmed-good config is still valid for
    // this device and must not be thrown away for nothing.
    setLastVerifiedDeviceState(null, Date.now());
  }

  return { deviceId, deviceSecret, campaignId, apiBaseUrl };
}

/**
 * Looks for `activation.json` next to this install and imports it whenever
 * it describes a credential this kiosk does not already have — first-time
 * setup (no device identity at all yet), the same shape as
 * `getFileServiceCredentials`'s `FS_BASE_URL`/`FS_API_KEY` handling above,
 * AND now also the official "load a re-issued package onto an
 * already-activated kiosk" path (2026-09-08 fix for the "kiosk 3" incident:
 * an admin re-downloading a device's activation package rotates its secret
 * server-side, and short of this there was no way to get the new secret onto
 * a running kiosk besides wiping its secrets by hand). An activation.json
 * identical to what's already stored (a leftover file from setup, an
 * operator re-copying the same package) is a harmless no-op — see
 * `activationFileSupersedesStored`.
 *
 * `LOOKA_ACTIVATION_PATH` overrides the lookup location for development and
 * testing, where there is no real installed-next-to-the-exe layout to read
 * from.
 */
export async function findAndImportActivationFileIfPresent(): Promise<boolean> {
  const candidate =
    process.env.LOOKA_ACTIVATION_PATH?.trim() ||
    path.join(path.dirname(app.getPath('exe')), 'activation.json');

  try {
    await fs.access(candidate);
  } catch {
    return false;
  }

  try {
    const raw = await fs.readFile(candidate, 'utf8');
    const parsed = parseActivationPayload(raw);
    const stored = getDeviceCredentials();
    if (!activationFileSupersedesStored(stored, parsed)) {
      // Same device, same secret already stored — nothing to do.
      return false;
    }

    await importActivationFile(candidate);
    console.warn(
      stored
        ? `[secrets] re-imported newer device activation from ${candidate}`
        : `[secrets] imported device activation from ${candidate}`
    );
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
  deleteSecret('device.lastVerified');
}

export interface LastVerifiedDeviceState {
  /** The last CampaignConfig the admin portal actually returned. Opaque here — deviceApi.ts owns the shape. */
  config: unknown;
  /** epoch ms of that successful contact — what the §3.3 24h fail-closed policy counts from. */
  verifiedAt: number;
}

/**
 * The last confirmed-good contact with the admin portal, persisted to disk —
 * see docs/plans/multi-camera-device-management-discussion.md §3.3's 24h
 * fail-closed cache. Deliberately NOT the same as `getCampaignConfig()`'s own
 * 15-minute in-memory cache in deviceApi.ts: that one exists to avoid hitting
 * the network on every session start and is lost on restart; this one is
 * what a kiosk falls back on across restarts while offline, and what its
 * age is measured against to decide fail-open vs fail-closed.
 */
export function getLastVerifiedDeviceState(): LastVerifiedDeviceState | null {
  const raw = getSecret('device.lastVerified');
  if (!raw) return null;
  try {
    return JSON.parse(raw) as LastVerifiedDeviceState;
  } catch {
    return null;
  }
}

export function setLastVerifiedDeviceState(config: unknown, verifiedAt: number): void {
  setSecret('device.lastVerified', JSON.stringify({ config, verifiedAt }));
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

export type { CameraRole };

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

/**
 * Filters an untrusted payload (e.g. the `camera:setRoleMapping` IPC
 * argument, which crosses the renderer/main boundary as `unknown`) down to
 * known roles with a string device id. `CameraRole` itself only constrains
 * this at compile time — a renderer bug or a stale build could otherwise
 * hand back an unrecognized role name, so this is the actual runtime check
 * against the current `CAMERA_ROLES` list.
 */
export function sanitizeCameraRoleMapping(input: unknown): CameraRoleMapping {
  const sanitized: CameraRoleMapping = {};
  if (!input || typeof input !== 'object') return sanitized;
  for (const role of CAMERA_ROLES) {
    const value = (input as Record<string, unknown>)[role];
    if (typeof value === 'string') sanitized[role] = value;
  }
  return sanitized;
}

export function setCameraRoleMapping(mapping: CameraRoleMapping): void {
  setSecret('camera.roleMapping', JSON.stringify(mapping));
}
