/**
 * Shared by SessionsPanel (list column) and SessionDetailDrawer (header
 * stat) — the capture duration of one session, computed client-side from
 * timestamps the API already returns (`sessions.captured_at`/`completed_at`
 * — see session.entity.ts's own doc comments: captured_at is "the kiosk's
 * own clock when the session started", completed_at is when it finished).
 * No backend change was needed for this (2026-09-07) — both fields were
 * already exposed on SessionListItemDao/SessionDetailDao.
 */

/** Milliseconds between two ISO timestamps, or `null` when either is missing (session still in progress) or the result would be negative (clock skew between whatever wrote each field). */
export function sessionDurationMs(capturedAt?: string, completedAt?: string): number | null {
  if (!capturedAt || !completedAt) return null;
  const ms = new Date(completedAt).getTime() - new Date(capturedAt).getTime();
  return ms >= 0 ? ms : null;
}

/** "45s" under a minute, "2p 15s" (phút/giây, matching this app's other short Vietnamese abbreviations) at or above one minute, "1g 03p" at or above an hour. */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) return `${hours}g ${String(minutes).padStart(2, '0')}p`;
  if (minutes > 0) return `${minutes}p ${String(seconds).padStart(2, '0')}s`;
  return `${seconds}s`;
}

/** "Đang chụp" for an in-progress session (no completedAt yet); "—" for anything else missing/invalid; otherwise the formatted duration. */
export function formatSessionDuration(capturedAt?: string, completedAt?: string): string {
  if (capturedAt && !completedAt) return 'Đang chụp';
  const ms = sessionDurationMs(capturedAt, completedAt);
  return ms === null ? '—' : formatDuration(ms);
}
