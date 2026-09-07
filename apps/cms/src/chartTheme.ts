/**
 * One shared color system for every chart and KPI card on the Overview
 * dashboard (2026-09-07 Power BI–style redesign) — see the `dataviz` skill's
 * `references/palette.md` for the full method this is drawn from. Only the
 * *hues* are taken from that reference palette (its validated 8-slot
 * categorical order + reserved 4-color status scale); the neutral chrome
 * (surfaces, borders, ink) deliberately stays Tailwind gray to match every
 * other card already in this app (`border-gray-200`, `bg-white`,
 * `text-gray-500/700/900`) rather than swapping in the skill's own warm-gray
 * chrome tokens, which would look inconsistent next to unchanged siblings
 * like `StatsPanel`/`CampaignList`. This app is light-theme only by explicit
 * prior decision (see `Layout.tsx`'s doc comment), so there is no dark-mode
 * variant to define here.
 *
 * Colors are assigned by **entity**, not by chart — the same metric wears
 * the same hue everywhere it appears (KPI card accent, trend line,
 * comparison bar), per the skill's "color follows the entity" rule. Photo
 * upload/ready state (ready/pending/failed, and the failed-upload KPI) uses
 * the reserved *status* colors instead of categorical ones, since those are
 * genuinely good/warning/critical states, not just "series N" — the skill's
 * collision rule.
 */

/** Fixed-order categorical hues (light mode), slots 1/2/3/4/5/7 in use below — see palette.md for the full 8 and why the order is fixed. */
export const CATEGORICAL = {
  blue: '#2a78d6', // slot 1 — sessions hoàn tất (primary metric)
  orange: '#eb6834', // slot 2 — thiết bị
  aqua: '#1baf7a', // slot 3 — upload thành công
  yellow: '#eda100', // slot 4 — lần chụp lại
  magenta: '#e87ba4', // slot 5 — CB Help can thiệp
  violet: '#4a3aa7', // slot 7 — phiên chụp (A.8 "sessions")
} as const;

/** Reserved status scale — never reused for a plain "series N", always paired with a label. */
export const STATUS = {
  good: '#0ca30c', // ảnh sẵn sàng (ready)
  warning: '#fab219', // ảnh đang chờ (pending)
  critical: '#d03b3b', // ảnh lỗi / upload thất bại (failed)
} as const;

/** Neutral ink/grid tokens — Tailwind's own gray scale, matching every other card in this app. */
export const CHROME = {
  gridline: '#e5e7eb', // tailwind gray-200
  axisText: '#6b7280', // tailwind gray-500
  ink: '#111827', // tailwind gray-900
} as const;

/**
 * Accent for KPI tiles that are meta/root-entity counts rather than one of
 * the tracked categorical/status series (Campaign, total Ảnh) — deliberately
 * a plain gray, not a 7th/8th categorical hue or a status color. Green/red
 * categorical slots sit close enough to the status good/critical hues that
 * reusing them here (or minting new ones) would read as "this count is
 * good/bad", which isn't true of a bare entity count.
 */
export const NEUTRAL_ACCENT = '#9ca3af'; // tailwind gray-400

/** Per-metric color assignments, applied identically across KPI cards, the trend chart, and the comparison chart. */
export const METRIC_COLOR = {
  sessionsCompleted: CATEGORICAL.blue,
  uploadSuccess: CATEGORICAL.aqua,
  uploadFailed: STATUS.critical,
  devices: CATEGORICAL.orange,
  retakes: CATEGORICAL.yellow,
  cbHelp: CATEGORICAL.magenta,
  sessions: CATEGORICAL.violet,
} as const;

/** Compact-but-consistent number formatting — every count in this app already uses `vi-VN` grouping (see StatTile/StatsPanel), kept here rather than switching to K/M compaction so the dashboard doesn't disagree with the table below it. */
export function formatCount(value: number): string {
  return value.toLocaleString('vi-VN');
}
