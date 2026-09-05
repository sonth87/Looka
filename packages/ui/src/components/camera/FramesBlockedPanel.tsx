import React from 'react';
import { CAMERA_ROLE_LABELS_VI, FramePreflight, FrameReadiness } from '../../lib/multiFrame.js';
import { cn } from '../../lib/utils.js';

export interface FramesBlockedPanelProps {
  preflight: FramePreflight;
  onOpenCameraSetup: () => void;
  onRecheck: () => void;
  theme?: 'dark' | 'light';
  className?: string;
}

function joinLabels(frames: FrameReadiness[]): string {
  const labels = frames.map((f) => f.label);
  if (labels.length <= 1) return labels.join('');
  if (labels.length === 2) return `${labels[0]} và ${labels[1]}`;
  return `${labels.slice(0, -1).join(', ')} và ${labels[labels.length - 1]}`;
}

/**
 * Blocks the kiosk from starting a simultaneous-capture session and says
 * exactly why — one line per problem `checkFramesReadiness` found, plus a
 * way to fix it (Camera Setup) or try again once it's been fixed.
 */
export const FramesBlockedPanel: React.FC<FramesBlockedPanelProps> = ({
  preflight,
  onOpenCameraSetup,
  onRecheck,
  theme = 'dark',
  className,
}) => {
  const lines: string[] = [];

  for (const frame of preflight.missing) {
    const roleLabel = CAMERA_ROLE_LABELS_VI[frame.role];
    lines.push(
      frame.deviceId
        ? `Khung ${frame.label} (${roleLabel}): camera đã gán không được kết nối`
        : `Khung ${frame.label} (${roleLabel}): chưa gán camera`
    );
  }

  for (const group of preflight.duplicates) {
    lines.push(`Khung ${joinLabels(group)} đang dùng chung một camera`);
  }

  return (
    <div
      className={cn(
        'absolute inset-0 z-40 flex flex-col items-center justify-center gap-3 px-6 py-8 text-center',
        theme === 'dark' ? 'bg-slate-950/95 text-slate-100' : 'bg-slate-50/95 text-slate-900',
        className
      )}
    >
      <span className="text-3xl">⚠️</span>
      <h2 className="text-base font-bold">Chưa đủ camera cho chế độ chụp đồng thời</h2>

      <ul className="max-w-md space-y-1 text-left text-xs">
        {lines.map((line) => (
          <li key={line} className="flex items-start gap-1.5">
            <span className="mt-0.5">•</span>
            <span>{line}</span>
          </li>
        ))}
      </ul>

      <div className="flex items-center gap-2 mt-2">
        <button
          onClick={onOpenCameraSetup}
          className="px-4 py-2 rounded-full bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs shadow-md active:scale-95 transition-all cursor-pointer"
        >
          Mở cài đặt camera
        </button>
        <button
          onClick={onRecheck}
          className={cn(
            'px-4 py-2 rounded-full border text-xs font-semibold active:scale-95 transition-all cursor-pointer',
            theme === 'dark'
              ? 'border-slate-700 text-slate-200 hover:bg-slate-800'
              : 'border-slate-300 text-slate-700 hover:bg-slate-100'
          )}
        >
          Kiểm tra lại
        </button>
      </div>
    </div>
  );
};
