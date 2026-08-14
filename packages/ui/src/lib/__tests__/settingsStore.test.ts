import test from 'node:test';
import assert from 'node:assert/strict';

/**
 * These cover the case that is invisible in development and only appears on
 * machines that have been in use: stored settings beat defaults, so changing a
 * default silently does nothing for exactly the installs that matter.
 */

const SETTINGS_KEY = 'face_platform_settings';

function installFakeStorage(): Map<string, string> {
  const data = new Map<string, string>();
  const storage = {
    getItem: (k: string) => (data.has(k) ? data.get(k)! : null),
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
    key: (i: number) => [...data.keys()][i] ?? null,
    get length() {
      return data.size;
    },
  };
  (globalThis as Record<string, unknown>).window = globalThis;
  (globalThis as Record<string, unknown>).localStorage = storage;
  return data;
}

/** Load the module fresh so nothing leaks between cases. */
async function loadStore() {
  const mod = await import(`../settingsStore.js?t=${Math.random()}`);
  return mod as typeof import('../settingsStore.js');
}

test('an install saved before the bump gets the new landmark default', async () => {
  const data = installFakeStorage();
  // What a real kiosk had on disk: written when the default was still false,
  // and with no settingsVersion because that field did not exist yet.
  data.set(
    SETTINGS_KEY,
    JSON.stringify({ theme: 'light', showLandmarks: false, sensitivity: 'MEDIUM' })
  );

  const { getSettings } = await loadStore();
  assert.equal(getSettings().showLandmarks, true, 'landmarks should be re-enabled once');

  const persisted = JSON.parse(data.get(SETTINGS_KEY)!);
  assert.equal(persisted.showLandmarks, true, 'the migration must be written back');
  assert.equal(persisted.settingsVersion, 1, 'and stamped so it does not repeat');
});

test('turning landmarks off after migrating is respected', async () => {
  const data = installFakeStorage();
  data.set(
    SETTINGS_KEY,
    JSON.stringify({ showLandmarks: false, settingsVersion: 1 })
  );

  const { getSettings } = await loadStore();
  assert.equal(
    getSettings().showLandmarks,
    false,
    'a machine that already migrated must keep the operator’s choice'
  );
});

test('migrating leaves unrelated stored values alone', async () => {
  const data = installFakeStorage();
  data.set(
    SETTINGS_KEY,
    JSON.stringify({
      theme: 'dark',
      sensitivity: 'VERY_HIGH',
      showLandmarks: false,
      autoHoldMs: 4000,
    })
  );

  const { getSettings } = await loadStore();
  const s = getSettings();
  assert.equal(s.theme, 'dark');
  assert.equal(s.sensitivity, 'VERY_HIGH');
  assert.equal(s.autoHoldMs, 4000);
});

test('a fresh install starts with landmarks on and live mode', async () => {
  installFakeStorage();
  const { getSettings } = await loadStore();
  const s = getSettings();
  assert.equal(s.showLandmarks, true);
  assert.equal(s.engineMode, 'live', 'a camera kiosk should not boot into mock data');
});
