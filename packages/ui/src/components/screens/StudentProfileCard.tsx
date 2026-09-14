import type { StudentSubjectInfo } from '../../lib/CaptureSink.js';
import { cn } from '../../lib/utils.js';
import { Badge } from '../ui/badge.js';
import { Card } from '../ui/card.js';

/**
 * Right-column "hồ sơ sinh viên" panel for the Bước 2 check-in screen
 * (ui-redesign-plan.md, "Bước 4 — Check-in & đối soát hồ sơ" — mockup #5).
 * Pure presentation: every value is a prop, nothing is looked up here.
 *
 * Deliberately typed against `StudentSubjectInfo` (from `lib/CaptureSink.ts`)
 * rather than a new parallel shape — that's the same type
 * `FaceCaptureApp.tsx`'s `handleLookupResult` already builds from either the
 * CCCD-scan roster record or the manual "nhập mã sinh viên" lookup, and the
 * same type `SubjectInfoBadge` already renders elsewhere in this package.
 *
 * Data honesty note (checked `StudentSubjectInfo`, `CccdScanWaitingScreen`'s
 * `CccdRosterLookupRecord`, and every field `campaignPortalApi.ts` returns):
 * none of them carry a photo/avatar URL, a "thẻ đã cấp" flag, or a tuition/
 * fee-payment flag. So this component never fabricates those — it falls
 * back to an initials placeholder for the photo, and the two status badges
 * either show only what a real field backs (the course/khoá year) or are
 * left with explicitly honest "no data" wording rather than a fake
 * "verified"/"đã thanh toán" claim.
 */
export interface StudentProfileCardProps {
  /**
   * The looked-up student to display. `null` renders the "waiting for a
   * match" placeholder instead of the profile — callers pass `null` any
   * time no student has been scanned/entered yet for the current sitting.
   */
  subject: StudentSubjectInfo | null;
  /**
   * Placeholder copy shown while `subject` is `null` — lets a caller say
   * "Đang chờ quét thẻ..." vs "Đang tra cứu..." without this component
   * needing its own `submitting` prop.
   */
  waitingMessage?: string;
  /**
   * A real photo URL, if a caller ever has one. No lookup path in this
   * codebase returns one today (see the doc comment above) — omitted (or
   * `undefined`) always falls back to an initials placeholder rather than
   * a fabricated picture.
   */
  photoUrl?: string;
  className?: string;
}

function initialsOf(name: string | undefined): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  // Vietnamese full names are written "họ ... tên đệm tên" — the given name
  // (what the badge/greeting elsewhere in this app addresses someone by) is
  // the LAST token, not the first.
  return parts[parts.length - 1]!.charAt(0).toUpperCase();
}

export function StudentProfileCard({ subject, waitingMessage, photoUrl, className }: StudentProfileCardProps) {
  if (!subject) {
    return (
      <Card
        variant="panel"
        className={cn(
          'flex flex-1 flex-col items-center justify-center gap-3 px-6 py-10 text-center',
          className
        )}
      >
        <span className="text-5xl opacity-40" aria-hidden>
          🪪
        </span>
        <p className="max-w-xs text-sm text-kiosk-text-muted">
          {waitingMessage ?? 'Đang chờ quét thẻ hoặc nhập mã sinh viên…'}
        </p>
      </Card>
    );
  }

  const classLine = [subject.major, subject.className].filter(Boolean).join(' · ');
  // The only real "khoá" signal available is `academicYear` (itself only a
  // best-effort stand-in for course year on the CCCD-scan path — see
  // `CccdScanWaitingScreen.tsx`'s own mapping comment). Shown as a plain
  // neutral fact, never phrased as a card-issuance confirmation ("đã cấp
  // thẻ...") since no field anywhere actually confirms that.
  const courseBadgeLabel = subject.academicYear ? `Khoá ${subject.academicYear}` : null;

  return (
    <Card variant="panel" className={cn('flex flex-1 flex-col gap-5 p-6', className)}>
      <div className="flex items-start gap-5">
        <div className="flex h-28 w-28 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-kiosk-border bg-kiosk-surface-2">
          {photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={photoUrl}
              alt={subject.subjectName || 'Ảnh sinh viên'}
              className="h-full w-full object-cover"
            />
          ) : (
            <span className="text-4xl font-black text-kiosk-text-muted" aria-hidden>
              {initialsOf(subject.subjectName)}
            </span>
          )}
        </div>
        <div className="flex min-w-0 flex-col gap-1.5 pt-1">
          <div
            className="truncate text-2xl font-black uppercase tracking-wide text-kiosk-text"
            title={subject.subjectName}
          >
            {subject.subjectName || 'Chưa rõ họ tên'}
          </div>
          {subject.subjectCode && (
            <div className="font-mono text-xl font-bold text-kiosk-accent">{subject.subjectCode}</div>
          )}
          {classLine && (
            <div className="truncate text-sm text-kiosk-text-muted" title={classLine}>
              {classLine}
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {courseBadgeLabel && <Badge variant="neutral">{courseBadgeLabel}</Badge>}
        {/*
          No tuition/fee-payment field exists anywhere in the roster lookup
          response yet (see this file's top doc comment) — shown honestly as
          "no data" rather than a fabricated "đã thanh toán đầy đủ" claim.
          Swap this for a real `variant="success"` badge once a real field
          backs it.
        */}
        <Badge variant="neutral">Chưa có dữ liệu học phí</Badge>
      </div>
    </Card>
  );
}
