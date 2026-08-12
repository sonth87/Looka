import React from 'react';
import { CaptureSession } from '@face/core';
import { cn } from '../../lib/utils.js';

export interface SessionReviewModalProps {
  session: CaptureSession | null;
  onAccept: () => void;
  onRetake: (stepId?: string) => void;
  onClose: () => void;
  className?: string;
}

export const SessionReviewModal: React.FC<SessionReviewModalProps> = ({
  session,
  onAccept,
  onRetake,
  onClose,
  className,
}) => {
  if (!session || session.status !== 'COMPLETED') return null;

  return (
    <div
      className={cn(
        'fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-fade-in',
        className
      )}
    >
      <div className="bg-slate-900 border border-slate-800 text-slate-100 rounded-3xl shadow-2xl max-w-2xl w-full p-6 space-y-6">
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div>
            <h3 className="text-xl font-bold tracking-tight">Kết quả chụp ảnh khuôn mặt</h3>
            <p className="text-xs text-slate-400 mt-1">
              Vui lòng xem lại chất lượng các góc chụp trước khi hoàn tất tạo hồ sơ.
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-400 flex items-center justify-center transition-colors cursor-pointer"
          >
            ✕
          </button>
        </div>

        {/* Step Images Grid */}
        <div className="grid grid-cols-3 gap-4">
          {session.steps.map((step) => (
            <div
              key={step.stepId}
              className="bg-slate-950 rounded-2xl border border-slate-800 overflow-hidden flex flex-col p-2 space-y-2"
            >
              <div className="aspect-square bg-slate-900 rounded-xl overflow-hidden relative flex items-center justify-center text-slate-600 font-medium">
                {step.capturedImagePath ? (
                  <img
                    src={step.capturedImagePath}
                    alt={step.stepType}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <span className="text-xs">📸 {step.stepType}</span>
                )}
                <span className="absolute top-2 left-2 px-2 py-0.5 text-[10px] font-bold bg-slate-900/80 text-blue-400 rounded-md border border-slate-700 backdrop-blur-xs">
                  {step.stepType}
                </span>
              </div>

              <div className="flex items-center justify-between text-[11px] px-1 text-slate-400">
                <span>Góc: {step.pose?.yaw ?? 0}°</span>
                <span className="text-emerald-400 font-semibold">
                  {step.quality?.overallScore ? `${step.quality.overallScore * 100}%` : 'OK'}
                </span>
              </div>
            </div>
          ))}
        </div>

        {/* Action Buttons */}
        <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-800">
          <button
            onClick={() => onRetake()}
            className="px-5 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium text-sm rounded-xl border border-slate-700 shadow-md transition-all active:scale-95 cursor-pointer"
          >
            Chụp lại toàn bộ
          </button>
          <button
            onClick={onAccept}
            className="px-6 py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-semibold text-sm rounded-xl shadow-lg shadow-blue-500/20 transition-all active:scale-95 cursor-pointer"
          >
            Xác nhận & Lưu hồ sơ
          </button>
        </div>
      </div>
    </div>
  );
};
