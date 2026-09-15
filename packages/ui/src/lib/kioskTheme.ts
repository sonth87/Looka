export type KioskTheme = 'light' | 'dark';

const STORAGE_KEY = 'looka_kiosk_theme_v1';

/** Reads the operator's saved theme choice — defaults to `'light'` (2026-09-15: default flipped from the original dark-only design). */
export function getStoredKioskTheme(): KioskTheme {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

/**
 * Toggles the `.dark` class on `document.documentElement` — the selector
 * `packages/ui/src/styles/globals.css` (and `apps/desktop`'s copy) key the
 * `--kiosk-*` token values off of — and persists the choice. `KioskShell`
 * remounts on every screen transition (`CampaignGate.tsx` renders a fresh
 * one per branch), so the class is applied here at module scope rather than
 * relying on any one screen's own effect to keep it correct.
 */
export function applyKioskTheme(theme: KioskTheme): void {
  document.documentElement.classList.toggle('dark', theme === 'dark');
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* ignore — theme just won't persist across reloads */
  }
}

if (typeof document !== 'undefined') {
  applyKioskTheme(getStoredKioskTheme());
}
