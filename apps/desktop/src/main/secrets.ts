import { app, safeStorage } from 'electron';
import fs from 'node:fs/promises';
import os from 'node:os';
import crypto from 'node:crypto';
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
  | 'device.fingerprint'
  | 'camera.roleMapping'
  | 'camera.physicalAngles'
  | 'camera.cbHelpVisibility'
  | 'capture.sequencing'
  | 'display.grid3x3';

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

/**
 * A stable id for `POST /v1/devices/self-enroll`'s `fingerprint` field
 * (§3.3) — how the server recognizes "the same kiosk enrolling again" rather
 * than minting a new device row every time. Generated once and persisted
 * (a random UUID, not derived from real hardware identifiers — this app has
 * no existing machine-id source, and a random-but-stable value satisfies
 * the server's "recognize this exact install again" contract just as well).
 * `os.hostname()` is passed as a separate, human-readable field alongside
 * this — see the self-enroll call site — not folded in here, since a
 * hostname can change (renamed machine) without this kiosk installation
 * being a different one.
 */
export function getOrCreateDeviceFingerprint(): string {
  const existing = getSecret('device.fingerprint');
  if (existing) return existing;
  const fresh = crypto.randomUUID();
  setSecret('device.fingerprint', fresh);
  return fresh;
}

export function getHostname(): string {
  return os.hostname();
}

/**
 * Persists the result of `POST /v1/devices/self-enroll` (called from the
 * renderer with the operator's SSO token — see `CampaignGate.tsx`) the same
 * way `importActivationFile` persists a zip-activation payload, so
 * `getDeviceCredentials()`/`DeviceApiClient` pick it up transparently and
 * the stats/events pipeline (`statsEvents.ts`) starts working with no
 * further changes. Unlike `importActivationFile`, this never touches
 * `device.lastVerified` — self-enroll is a *user-driven* re-identification
 * of this kiosk (happens every time the operator picks a campaign, see
 * `CampaignGate.tsx`), not the once-per-activation trust-establishing event
 * that clock exists to bound the fail-closed window from.
 */
export function storeSelfEnrolledDevice(result: {
  deviceId: string;
  deviceSecret: string;
  campaignId: string | null;
  apiBaseUrl: string;
}): void {
  setSecret('device.id', result.deviceId);
  setSecret('device.secret', result.deviceSecret);
  if (result.campaignId) setSecret('device.campaignId', result.campaignId);
  setSecret('device.apiBaseUrl', result.apiBaseUrl);
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

/** One logical camera role's physical mounting yaw/pitch, in degrees — see `packages/ui/src/lib/multiFrame.ts`'s `PhysicalCameraAngles`. */
export interface CameraPhysicalAngles {
  yaw: number;
  pitch: number;
}

/** Per-role override of `multiFrame.ts`'s `DEFAULT_PHYSICAL_ANGLES` — mirrors that file's own `PhysicalAngleMap`. */
export type CameraPhysicalAngleMap = Partial<Record<CameraRole, CameraPhysicalAngles>>;

/**
 * Per-role physical camera mounting angle (§3.9, "Cài đặt thiết bị") — how
 * far off straight-ahead each role's camera is actually bolted, so
 * `planCaptureRounds` (packages/ui/src/lib/multiFrame.ts) can translate a
 * step's subject-facing pose target into the correct gate pose for whichever
 * physical camera actually resolves that step, instead of always assuming
 * `DEFAULT_PHYSICAL_ANGLES`. Same storage/reasoning as `camera.roleMapping`
 * above: not a secret, just reusing the already-established per-machine
 * local-config store. An unset/missing role falls back to
 * `DEFAULT_PHYSICAL_ANGLES` at the call site (this function returns only the
 * overrides actually saved, same as `getCameraRoleMapping` returning only
 * roles actually mapped).
 */
export function getCameraPhysicalAngles(): CameraPhysicalAngleMap {
  const raw = getSecret('camera.physicalAngles');
  if (!raw) return {};
  try {
    return JSON.parse(raw) as CameraPhysicalAngleMap;
  } catch {
    return {};
  }
}

/**
 * Filters an untrusted payload (the `camera:setPhysicalAngles` IPC argument)
 * down to known roles with finite numeric yaw/pitch — same reasoning as
 * `sanitizeCameraRoleMapping`.
 */
export function sanitizeCameraPhysicalAngles(input: unknown): CameraPhysicalAngleMap {
  const sanitized: CameraPhysicalAngleMap = {};
  if (!input || typeof input !== 'object') return sanitized;
  for (const role of CAMERA_ROLES) {
    const value = (input as Record<string, unknown>)[role];
    if (!value || typeof value !== 'object') continue;
    const yaw = (value as Record<string, unknown>).yaw;
    const pitch = (value as Record<string, unknown>).pitch;
    if (typeof yaw === 'number' && Number.isFinite(yaw) && typeof pitch === 'number' && Number.isFinite(pitch)) {
      sanitized[role] = { yaw, pitch };
    }
  }
  return sanitized;
}

export function setCameraPhysicalAngles(angles: CameraPhysicalAngleMap): void {
  setSecret('camera.physicalAngles', JSON.stringify(angles));
}

/** One logical camera role's CB Help extend-display setting — whether its tile shows there at all, and in what order relative to the other visible roles (ascending, ties broken by `CAMERA_ROLES` order). */
export interface CbHelpCameraVisibility {
  visible: boolean;
  order: number;
}

/** Per-role CB Help visibility/order override — mirrors `CameraRoleMapping`/`CameraPhysicalAngleMap`'s own shape and storage. */
export type CbHelpVisibilityMap = Partial<Record<CameraRole, CbHelpCameraVisibility>>;

/**
 * Which camera roles show on the CB Help extended display, and in what
 * order (2026-09-10, "màn extend default hiển thị camera chính diện, các
 * cam khác ẩn đi, có nút setup mở các camera đó lên... có thể di chuyển thứ
 * tự"). Before this, CB Help showed every workflow step's camera
 * unconditionally, in step order — see `FaceCaptureApp.tsx`'s
 * `buildCbHelpFrames`, which now filters/sorts by this map instead.
 *
 * An unset/missing role falls back to CENTER visible (order 0), everything
 * else hidden — see `resolveCbHelpVisibility` below, the single place that
 * default is expressed, so a role explicitly saved as `{ visible: false }`
 * for CENTER (an unusual but valid operator choice) is still honoured
 * rather than silently overridden back to visible.
 */
export function getCbHelpVisibility(): CbHelpVisibilityMap {
  const raw = getSecret('camera.cbHelpVisibility');
  if (!raw) return {};
  try {
    return JSON.parse(raw) as CbHelpVisibilityMap;
  } catch {
    return {};
  }
}

/**
 * Filters an untrusted payload (the `camera:setCbHelpVisibility` IPC
 * argument) down to known roles with a boolean `visible` and a finite
 * numeric `order` — same reasoning as `sanitizeCameraPhysicalAngles`.
 */
export function sanitizeCbHelpVisibility(input: unknown): CbHelpVisibilityMap {
  const sanitized: CbHelpVisibilityMap = {};
  if (!input || typeof input !== 'object') return sanitized;
  for (const role of CAMERA_ROLES) {
    const value = (input as Record<string, unknown>)[role];
    if (!value || typeof value !== 'object') continue;
    const visible = (value as Record<string, unknown>).visible;
    const order = (value as Record<string, unknown>).order;
    if (typeof visible === 'boolean' && typeof order === 'number' && Number.isFinite(order)) {
      sanitized[role] = { visible, order };
    }
  }
  return sanitized;
}

export function setCbHelpVisibility(map: CbHelpVisibilityMap): void {
  setSecret('camera.cbHelpVisibility', JSON.stringify(map));
}

/** The default `resolveCbHelpVisibility` uses for a role with no saved entry — see that function's own doc comment. */
const DEFAULT_CB_HELP_VISIBILITY: Record<CameraRole, CbHelpCameraVisibility> = {
  CENTER: { visible: true, order: 0 },
  LEFT: { visible: false, order: 1 },
  RIGHT: { visible: false, order: 2 },
  UP: { visible: false, order: 3 },
  DOWN: { visible: false, order: 4 },
};

/** `getCbHelpVisibility()`'s map, with every role resolved against `DEFAULT_CB_HELP_VISIBILITY` — the one place "unset means CENTER-only" is decided, so every caller (main process and renderer alike) agrees on it. */
export function resolveCbHelpVisibility(map: CbHelpVisibilityMap): Record<CameraRole, CbHelpCameraVisibility> {
  const resolved = { ...DEFAULT_CB_HELP_VISIBILITY };
  for (const role of CAMERA_ROLES) {
    const saved = map[role];
    if (saved) resolved[role] = saved;
  }
  return resolved;
}

/**
 * "Cách chụp" — Tuần tự / Đồng thời (discussion doc §3.9, ui-redesign-plan.md
 * S7). A kiosk-local setting, same reasoning as `camera.roleMapping`: it
 * replaced `campaigns.simultaneous_capture` per the 2026-09-08 decision
 * that this belongs to the machine, not the campaign. Defaults to
 * `'sequential'` when unset — the safe default for a freshly-installed
 * kiosk with only one camera mapped so far.
 */
export type CaptureSequencing = 'sequential' | 'simultaneous';

export function getCaptureSequencing(): CaptureSequencing {
  const raw = getSecret('capture.sequencing');
  return raw === 'simultaneous' ? 'simultaneous' : 'sequential';
}

export function setCaptureSequencing(value: CaptureSequencing): void {
  setSecret('capture.sequencing', value === 'simultaneous' ? 'simultaneous' : 'sequential');
}

/**
 * "Lưới 3x3" (2026-09-10) — forces the multi-camera capture grid
 * (`MultiFrameGrid`) to always lay out 3 tiles per row, instead of its
 * default per-count layout (1→1 col, 2→2, 3→3, 4→2x2, 5→3+2). Kiosk-local,
 * same reasoning as `capture.sequencing`. Defaults to `false` (the existing
 * adaptive layout) when unset, so an upgraded kiosk's grid looks exactly as
 * it did before until an operator opts in.
 */
export function getGrid3x3Enabled(): boolean {
  return getSecret('display.grid3x3') === 'true';
}

export function setGrid3x3Enabled(value: boolean): void {
  setSecret('display.grid3x3', value ? 'true' : 'false');
}
