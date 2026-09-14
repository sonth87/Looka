import React from 'react';
import { CheckCircle2, AlertTriangle, Clock } from 'lucide-react';
import { cn } from '../../lib/utils.js';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/card.js';

export type PhotoQualityCheckStatus = 'valid' | 'pending' | 'warning';

export interface PhotoQualityCheckItem {
  id: string;
  label: string;
  status: PhotoQualityCheckStatus;
  /** Short caption under the label — e.g. explaining why a row is still 'pending'. */
  note?: string;
}

export interface PhotoQualityChecklistProps {
  items: PhotoQualityCheckItem[];
  className?: string;
}

const STATUS_ICON: Record<PhotoQualityCheckStatus, React.ReactNode> = {
  valid: <CheckCircle2 className="w-4 h-4" />,
  warning: <AlertTriangle className="w-4 h-4" />,
  pending: <Clock className="w-4 h-4" />,
};

const STATUS_ROW_CLASSES: Record<PhotoQualityCheckStatus, string> = {
  valid: 'text-kiosk-accent-2 bg-kiosk-accent-2/10 border-kiosk-accent-2/30',
  warning: 'text-kiosk-warning bg-kiosk-warning/10 border-kiosk-warning/30',
  pending: 'text-kiosk-text-muted bg-kiosk-surface-2/60 border-kiosk-border',
};

/**
 * "KIỂM TRA TIÊU CHUẨN ẢNH THẺ TỰ ĐỘNG" sidebar checklist for the
 * single-camera "gương soi" guide screen (bước 6 — docs plan "Sửa UI desktop
 * app Looka theo 7 ảnh mockup").
 *
 * Pure presentation: every row's status is decided by the caller
 * (`DesktopCaptureView`), which is the one with access to `faceState`/
 * `guidance`. Two of the four ICAO-style criteria the mockup shows (nền
 * trơn/màu, trang phục) have no real detection signal anywhere in this
 * codebase today — no background segmentation, no attire classifier — so the
 * caller always hands those a 'pending' status with an explanatory `note`
 * rather than a fabricated 'valid'; only 'ánh sáng' (brightness/TOO_DARK/
 * TOO_BRIGHT) and 'mắt mở' (eyeOpenScore/EYES_CLOSED) are backed by a real
 * signal today. See `DesktopCaptureView`'s `qualityChecklistItems`.
 */
export const PhotoQualityChecklist: React.FC<PhotoQualityChecklistProps> = ({ items, className }) => {
  return (
    <Card variant="panel" className={cn('overflow-hidden', className)}>
      <CardHeader className="pb-2">
        <CardTitle className="text-[11px] uppercase tracking-wider text-kiosk-text-muted">
          Kiểm tra tiêu chuẩn ảnh thẻ tự động
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 pb-4">
        {items.map((item) => (
          <div
            key={item.id}
            className={cn(
              'flex items-start gap-2.5 rounded-xl border px-3 py-2 transition-colors',
              STATUS_ROW_CLASSES[item.status]
            )}
          >
            <span className="shrink-0 mt-0.5">{STATUS_ICON[item.status]}</span>
            <div className="min-w-0">
              <div className="text-xs font-semibold text-kiosk-text leading-snug">{item.label}</div>
              {item.note && <div className="text-[10px] text-kiosk-text-muted mt-0.5">{item.note}</div>}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
};
