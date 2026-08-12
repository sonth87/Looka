import { CaptureSensitivity, CaptureTriggerMode, GestureType } from '@face/core';

export interface PanelState {
  position?: { x: number; y: number };
  collapsed?: boolean;
}

export interface AppSettings {
  theme?: 'dark' | 'light';
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
}

const SETTINGS_KEY = 'face_platform_settings';

export const defaultSettings: AppSettings = {
  theme: 'light',
  sensitivity: 'MEDIUM',
  cameraScale: 'standard',
  isFullscreen: false,
  overlayVisible: true,
  overlayOpacity: 1.0,
  showLandmarks: false,
  landmarkSize: 1.5,
  showScreenDebugStats: true,
  captureMode: 'AUTO',
  autoHoldMs: 2000,
  allowedGestures: ['VICTORY', 'THUMBS_UP', 'OPEN_PALM'],
  panels: {},
};

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
    return migrateLegacyKeys(merged);
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
