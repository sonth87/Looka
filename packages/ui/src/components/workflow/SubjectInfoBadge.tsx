import React from 'react';
import { cn } from '../../lib/utils.js';
import { LiquidGlassCard } from '../theme/LiquidGlassCard.js';
import { StudentSubjectInfo } from '../../lib/CaptureSink.js';
import { formatSubjectClassLine, formatRoundLabel, formatPhotoLabel } from './captureStatusFormat.js';

export interface SubjectInfoBadgeProps {
  /** The looked-up student for the session in progress; `null` before a code has been entered — the badge renders nothing then (ui-redesign-plan.md S5: "Ẩn khi chưa nhập mã"). */
  subject: StudentSubjectInfo | null;
  /** 1-based index of the round currently in progress. */
  round: number;
  /** Total rounds this session's capture plan needs (§3.1.5 round planning). */
  roundCount: number;
  /** Photos captured so far in this session. */
  photoCount: number;
  /** Total photos this session's campaign targets ("N ảnh / SV"). */
  photoTotal: number;
  theme?: 'dark' | 'light';
  className?: string;
}

/**
 * Top-left "NGƯỜI ĐƯỢC CHỤP" badge on the capture screen (ui-redesign-plan.md
 * §2 S5, discussion doc §3.4 — "YC 5", moved to the left edge 2026-09-08).
 * Pure presentation: every value it renders is a prop, nothing is looked up
 * or computed here beyond the small formatting helpers in
 * `captureStatusFormat.ts` (unit-tested separately — this package has no
 * DOM/render-test setup for `.tsx` files).
 *
 * Sizing follows ui-redesign-plan.md §4.3's kiosk legibility rule (an
 * operator standing ~1m back): subject code ≥28px, name ≥20px.
 */
export const SubjectInfoBadge: React.FC<SubjectInfoBadgeProps> = ({
  subject,
  round,
  roundCount,
  photoCount,
  photoTotal,
  theme = 'dark',
  className,
}) => {
  if (!subject) return null;

  const classLine = formatSubjectClassLine(subject);
  const mutedText = theme === 'dark' ? 'text-slate-400' : 'text-slate-500';

  return (
    <LiquidGlassCard
      theme={theme}
      variant="card"
      className={cn('px-4 py-3 flex flex-col gap-1.5 max-w-[240px]', className)}
    >
      <div className={cn('text-[10px] font-bold uppercase tracking-wider', mutedText)}>
        Người được chụp
      </div>

      {subject.subjectCode && (
        <div className="text-[28px] leading-tight font-black tracking-tight">
          {subject.subjectCode}
        </div>
      )}

      {subject.subjectName && (
        <div className="text-[20px] leading-snug font-semibold truncate" title={subject.subjectName}>
          {subject.subjectName}
        </div>
      )}

      {classLine && (
        <div className={cn('text-xs font-medium truncate', mutedText)} title={classLine}>
          {classLine}
        </div>
      )}

      <div className="flex items-center gap-2 mt-1">
        <span
          className={cn(
            'px-2 py-0.5 rounded-full text-[11px] font-bold',
            theme === 'dark'
              ? 'bg-blue-500/25 text-blue-300 border border-blue-400/40'
              : 'bg-blue-100 text-blue-700 border border-blue-200'
          )}
        >
          {formatRoundLabel(round, roundCount)}
        </span>
        <span
          className={cn(
            'px-2 py-0.5 rounded-full text-[11px] font-bold',
            theme === 'dark'
              ? 'bg-emerald-500/25 text-emerald-300 border border-emerald-400/40'
              : 'bg-emerald-100 text-emerald-700 border border-emerald-200'
          )}
        >
          {formatPhotoLabel(photoCount, photoTotal)}
        </span>
      </div>
    </LiquidGlassCard>
  );
};
