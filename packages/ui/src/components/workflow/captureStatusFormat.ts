import { StudentSubjectInfo } from '../../lib/CaptureSink.js';

/**
 * Pure formatting helpers shared by `SubjectInfoBadge` and `CapturedListPanel`
 * (ui-redesign-plan.md S5 — "NGƯỜI ĐƯỢC CHỤP" / "ĐÃ CHỤP · ĐANG CHỤP").
 * Kept separate from the components themselves so they can be unit-tested
 * with plain `node:test` — this package has no DOM/testing-library set up
 * for `.tsx` render tests (no existing `*.test.tsx` file, no `jsdom` in
 * devDependencies), so the components stay presentation-only and every bit
 * of actual logic (what a "lớp · ngành · khóa" line reads, how a captured
 * timestamp is shown) lives here instead, matching how the rest of this
 * package splits pure logic (`lib/`) from rendering.
 */

/** "CNTT-K20 · KTPM" style line — only the parts that are actually present, so a subject missing `academicYear` (say) does not render a trailing " · ". */
export function formatSubjectClassLine(
  subject: Pick<StudentSubjectInfo, 'className' | 'major' | 'academicYear'> | null | undefined
): string {
  if (!subject) return '';
  return [subject.className, subject.major, subject.academicYear]
    .filter((v): v is string => !!v && v.trim().length > 0)
    .join(' · ');
}

/** "Vòng k/K" — vocabulary table ui-redesign-plan.md §4.1 ("Vòng" row): exact label, never "round". */
export function formatRoundLabel(round: number, roundCount: number): string {
  return `Vòng ${round}/${roundCount}`;
}

/** "N/M ảnh" — §4.1's "Ảnh mục tiêu" row: never "khung"/"frame". */
export function formatPhotoLabel(photoCount: number, photoTotal: number): string {
  return `${photoCount}/${photoTotal} ảnh`;
}

/** "09:41" — local wall-clock time of day, zero-padded. Deliberately not `Intl.DateTimeFormat`: a minimal Node build without full ICU data silently falls back to a different locale, which would make this non-deterministic across environments for no benefit over a two-line manual format. */
export function formatCapturedTime(capturedAt: number | string | Date): string {
  const d = capturedAt instanceof Date ? capturedAt : new Date(capturedAt);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** " (A102)" when this row was captured on a different device; "" (nothing) for this device or an unnamed one — matches the S5 mockup, which only ever names the *other* machine. */
export function formatDeviceSuffix(deviceName: string | undefined, isThisDevice: boolean): string {
  if (isThisDevice || !deviceName) return '';
  return ` (${deviceName})`;
}
