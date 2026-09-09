import React from 'react';
import { Check } from 'lucide-react';
import { cn } from '../../lib/utils.js';
import { LiquidGlassCard } from '../theme/LiquidGlassCard.js';
import { StudentSubjectInfo } from '../../lib/CaptureSink.js';
import {
  formatRoundLabel,
  formatPhotoLabel,
  formatCapturedTime,
  formatDeviceSuffix,
} from './captureStatusFormat.js';

export interface CapturedListCurrent {
  subject: StudentSubjectInfo;
  round: number;
  roundCount: number;
  /**
   * Extra, optional beyond the base "subject, round, roundCount" contract —
   * the S5 mockup's "Đang chụp" row also shows "N/M ảnh" alongside the
   * round; a caller with that data on hand can pass it, one without it
   * (matching the plainer base contract) still renders a valid row.
   */
  photoCount?: number;
  photoTotal?: number;
}

export interface CapturedListRecentEntry {
  subjectCode: string;
  subjectName?: string;
  photoCount: number;
  photoTotal: number;
  capturedAt: number | string | Date;
  /** Kiosk that captured this session — shown only when `isThisDevice` is false (see `formatDeviceSuffix`). */
  deviceName?: string;
  isThisDevice: boolean;
}

export interface CapturedListPanelProps {
  /** The session in progress on this device right now, or `null` between sessions (no one standing at the camera). */
  current: CapturedListCurrent | null;
  /**
   * Recently completed sessions, newest first — Q19: the whole campaign
   * when online, this device only when offline; deciding *which* rows to
   * pass is the caller's job, this component only renders whatever list it
   * is given.
   */
  recent: CapturedListRecentEntry[];
  /** A row was clicked — view-only (Q20: no edit/delete from this panel), the caller opens the session (e.g. S9's drawer). */
  onOpenSession: (subjectCode: string) => void;
  theme?: 'dark' | 'light';
  className?: string;
}

/**
 * Right-side "ĐÃ CHỤP / ĐANG CHỤP" panel on the capture screen
 * (ui-redesign-plan.md §2 S5, discussion doc §3.8.2 / Q19 / Q20). Pure
 * presentation and view-only by design — no edit/delete affordance, per
 * Q20's decision that a retake goes through the normal student-id-entry
 * flow instead. Not wired to any real data source here (no API calls): a
 * later integration pass supplies `current`/`recent`, this component only
 * renders what it is handed. See `captureStatusFormat.ts` for the small
 * formatting helpers this uses, unit-tested separately since this package
 * has no DOM/render-test setup for `.tsx` files.
 */
export const CapturedListPanel: React.FC<CapturedListPanelProps> = ({
  current,
  recent,
  onOpenSession,
  theme = 'dark',
  className,
}) => {
  const mutedText = theme === 'dark' ? 'text-slate-400' : 'text-slate-500';
  const dividerColor = theme === 'dark' ? 'border-white/10' : 'border-slate-200';

  return (
    <LiquidGlassCard
      theme={theme}
      variant="card"
      className={cn('flex flex-col min-h-0 w-full max-w-[300px] py-3', className)}
    >
      <div className={cn('px-4 pb-2 text-[10px] font-bold uppercase tracking-wider', mutedText)}>
        Đã chụp · Đang chụp
      </div>

      {current && (
        <div className="px-4 pb-3">
          <div className="flex items-center gap-1.5 mb-1">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500" />
            </span>
            <span className="text-xs font-bold text-blue-400">Đang chụp</span>
          </div>
          <div className="text-sm font-semibold truncate">
            {current.subject.subjectCode}
            {current.subject.subjectName ? ` ${current.subject.subjectName}` : ''}
          </div>
          <div className={cn('text-xs', mutedText)}>
            {formatRoundLabel(current.round, current.roundCount)}
            {current.photoCount !== undefined && current.photoTotal !== undefined
              ? ` · ${formatPhotoLabel(current.photoCount, current.photoTotal)}`
              : ''}
          </div>
        </div>
      )}

      <div className={cn('flex-1 min-h-0 overflow-y-auto border-t', dividerColor)}>
        {recent.length === 0 ? (
          <div className={cn('px-4 py-4 text-xs text-center', mutedText)}>
            Chưa có ảnh nào được chụp
          </div>
        ) : (
          <ul>
            {recent.map((entry, idx) => (
              <li key={`${entry.subjectCode}-${idx}`}>
                <button
                  type="button"
                  onClick={() => onOpenSession(entry.subjectCode)}
                  className={cn(
                    'w-full text-left px-4 py-2 flex items-start gap-2 cursor-pointer transition-colors',
                    theme === 'dark' ? 'hover:bg-white/5' : 'hover:bg-slate-100'
                  )}
                >
                  <Check className="w-3.5 h-3.5 mt-0.5 shrink-0 text-emerald-500 stroke-[3]" />
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-semibold truncate">
                      {entry.subjectCode}
                      {entry.subjectName ? ` ${entry.subjectName}` : ''}
                    </div>
                    <div className={cn('text-[11px]', mutedText)}>
                      {formatPhotoLabel(entry.photoCount, entry.photoTotal)} ·{' '}
                      {formatCapturedTime(entry.capturedAt)}
                      {formatDeviceSuffix(entry.deviceName, entry.isThisDevice)}
                    </div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </LiquidGlassCard>
  );
};
