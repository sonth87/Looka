import { CaptureSensitivity, CaptureTriggerMode, GestureType } from '@face/core';

export interface PanelState {
  position?: { x: number; y: number };
  collapsed?: boolean;
}

export interface AppSettings {
  theme?: 'dark' | 'light';
  /**
   * Which engine the app starts with.
   *
   * Remembered rather than inferred: this used to be guessed from window width,
   * so a desktop kiosk — the machine that actually has the camera — booted into
   * simulation and ran mock face data until somebody noticed and switched.
   */
  engineMode?: 'simulation' | 'live';
  sensitivity?: CaptureSensitivity;
  cameraScale?: 'compact' | 'standard' | 'large';
  isFullscreen?: boolean;
  overlayVisible?: boolean;
  overlayOpacity?: number;
  showLandmarks?: boolean;
  landmarkSize?: number;
  showScreenDebugStats?: boolean;
  captureMode?: CaptureTriggerMode;
  autoHoldMs?: number;
  allowedGestures?: GestureType[];
  panels?: Record<string, PanelState>;
  /** Which round of default-changes this stored object has already seen. */
  settingsVersion?: number;
}

const SETTINGS_KEY = 'face_platform_settings';

/**
 * Bump when changing a default that existing installs must adopt.
 *
 * Stored settings win over defaults — that is the point of saving them — but it
 * means a changed default never reaches a machine that has run the app before.
 * Landmarks hit exactly this: the default became true, yet every existing kiosk
 * kept the false it had written, so the feature looked broken on the machines
 * that had been used the most.
 */
const SETTINGS_VERSION = 1;

export const defaultSettings: AppSettings = {
  theme: 'light',
  // Live is what the product does; simulation is a deliberate detour into mock
  // data, so it should be chosen, never landed in by default.
  engineMode: 'live',
  sensitivity: 'MEDIUM',
  cameraScale: 'standard',
  isFullscreen: false,
  overlayVisible: true,
  overlayOpacity: 1.0,
  showLandmarks: true,
  landmarkSize: 1.5,
  showScreenDebugStats: true,
  captureMode: 'AUTO',
  autoHoldMs: 2000,
  allowedGestures: ['VICTORY', 'THUMBS_UP', 'OPEN_PALM'],
  panels: {},
  // Deliberately absent: getSettings merges defaults *under* stored values, so
  // a version here would mask an old object that has no version of its own and
  // the migration would never run for the installs that need it.
};

/**
 * Re-apply defaults that changed since this object was stored.
 *
 * Runs at most once per version bump — a machine that has already caught up is
 * left alone, so an operator who deliberately turns something off keeps it off
 * from then on.
 */
function applyDefaultMigrations(settings: AppSettings): AppSettings {
  const storedVersion = settings.settingsVersion ?? 0;
  if (storedVersion >= SETTINGS_VERSION) return settings;

  const next: AppSettings = { ...settings };

  // v1 — landmark dots became visible by default.
  if (storedVersion < 1) next.showLandmarks = true;

  next.settingsVersion = SETTINGS_VERSION;
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
  } catch {
    /* a read-only store still gets the migrated values in memory */
  }
  return next;
}

/**
 * Migrate legacy individual localStorage keys into the single unified SETTINGS_KEY object
 */
function migrateLegacyKeys(settings: AppSettings): AppSettings {
  if (typeof window === 'undefined') return settings;
  let modified = false;
  const nextSettings = { ...settings, panels: { ...(settings.panels || {}) } };

  try {
    const legacyTheme = localStorage.getItem('face_ui_theme');
    if (legacyTheme && (legacyTheme === 'dark' || legacyTheme === 'light')) {
      nextSettings.theme = legacyTheme as 'dark' | 'light';
      localStorage.removeItem('face_ui_theme');
      modified = true;
    }

    const legacySens = localStorage.getItem('face_ui_capture_sensitivity');
    if (legacySens) {
      nextSettings.sensitivity = legacySens as CaptureSensitivity;
      localStorage.removeItem('face_ui_capture_sensitivity');
      modified = true;
    }

    const legacyScale = localStorage.getItem('face_ui_camera_scale');
    if (legacyScale) {
      nextSettings.cameraScale = legacyScale as any;
      localStorage.removeItem('face_ui_camera_scale');
      modified = true;
    }

    const legacyFs = localStorage.getItem('face_ui_camera_fullscreen');
    if (legacyFs !== null) {
      nextSettings.isFullscreen = JSON.parse(legacyFs);
      localStorage.removeItem('face_ui_camera_fullscreen');
      modified = true;
    }

    const legacyOverlayVis = localStorage.getItem('face_ui_overlay_visible');
    if (legacyOverlayVis !== null) {
      nextSettings.overlayVisible = JSON.parse(legacyOverlayVis);
      localStorage.removeItem('face_ui_overlay_visible');
      modified = true;
    }

    const legacyOpacity = localStorage.getItem('face_ui_overlay_opacity');
    if (legacyOpacity !== null) {
      nextSettings.overlayOpacity = parseFloat(legacyOpacity);
      localStorage.removeItem('face_ui_overlay_opacity');
      modified = true;
    }

    const legacyLm = localStorage.getItem('face_ui_show_landmarks');
    if (legacyLm !== null) {
      nextSettings.showLandmarks = JSON.parse(legacyLm);
      localStorage.removeItem('face_ui_show_landmarks');
      modified = true;
    }

    const legacyLmSize = localStorage.getItem('face_ui_landmark_size');
    if (legacyLmSize !== null) {
      nextSettings.landmarkSize = parseFloat(legacyLmSize);
      localStorage.removeItem('face_ui_landmark_size');
      modified = true;
    }

    const legacyCapMode = localStorage.getItem('face_ui_capture_mode');
    if (legacyCapMode !== null) {
      nextSettings.captureMode = legacyCapMode as CaptureTriggerMode;
      localStorage.removeItem('face_ui_capture_mode');
      modified = true;
    }

    const legacyHold = localStorage.getItem('face_ui_auto_hold_ms');
    if (legacyHold !== null) {
      nextSettings.autoHoldMs = parseInt(legacyHold, 10);
      localStorage.removeItem('face_ui_auto_hold_ms');
      modified = true;
    }

    const legacyGestures = localStorage.getItem('face_ui_allowed_gestures');
    if (legacyGestures !== null) {
      nextSettings.allowedGestures = JSON.parse(legacyGestures);
      localStorage.removeItem('face_ui_allowed_gestures');
      modified = true;
    }

    // Clean panel position and collapsed legacy keys
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;
      if (key.endsWith('_pos')) {
        const panelKey = key.slice(0, -4);
        try {
          const pos = JSON.parse(localStorage.getItem(key) || '');
          nextSettings.panels[panelKey] = {
            ...(nextSettings.panels[panelKey] || {}),
            position: pos,
          };
          keysToRemove.push(key);
          modified = true;
        } catch {}
      } else if (key.endsWith('_collapsed')) {
        const panelKey = key.slice(0, -10);
        try {
          const col = JSON.parse(localStorage.getItem(key) || '');
          nextSettings.panels[panelKey] = {
            ...(nextSettings.panels[panelKey] || {}),
            collapsed: col,
          };
          keysToRemove.push(key);
          modified = true;
        } catch {}
      }
    }

    for (const key of keysToRemove) {
      localStorage.removeItem(key);
    }

    if (modified) {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(nextSettings));
    }
  } catch {}

  return nextSettings;
}

export function getSettings(): AppSettings {
  if (typeof window === 'undefined') return defaultSettings;
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    const merged: AppSettings = {
      ...defaultSettings,
      ...parsed,
      panels: { ...defaultSettings.panels, ...(parsed.panels || {}) },
    };
    return applyDefaultMigrations(migrateLegacyKeys(merged));
  } catch {
    return defaultSettings;
  }
}

export function updateSettings(updates: Partial<AppSettings>): AppSettings {
  if (typeof window === 'undefined') return defaultSettings;
  try {
    const current = getSettings();
    const updated: AppSettings = {
      ...current,
      ...updates,
      panels: {
        ...(current.panels || {}),
        ...(updates.panels || {}),
      },
    };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(updated));
    return updated;
  } catch {
    return defaultSettings;
  }
}

export function getPanelState(panelKey: string): PanelState {
  const settings = getSettings();
  return settings.panels?.[panelKey] || {};
}

export function updatePanelState(panelKey: string, updates: Partial<PanelState>): void {
  const settings = getSettings();
  const currentPanel = settings.panels?.[panelKey] || {};
  const updatedPanels = {
    ...(settings.panels || {}),
    [panelKey]: {
      ...currentPanel,
      ...updates,
    },
  };
  updateSettings({ panels: updatedPanels });
}
