import React from 'react';
import { RotateCcw, Send, X, CheckCircle2 } from 'lucide-react';
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

  const handleRetakeConfirm = () => {
    if (typeof window !== 'undefined') {
      const confirmed = window.confirm('Bạn có chắc chắn muốn hủy kết quả hiện tại để chụp lại từ đầu không?');
      if (confirmed) {
        onRetake();
      }
    } else {
      onRetake();
    }
  };

  return (
    <div
      className={cn(
        'fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/75 backdrop-blur-md animate-in fade-in duration-200',
        className
      )}
    >
      <div className="bg-slate-900 border border-slate-800 text-slate-100 rounded-3xl shadow-2xl max-w-2xl w-full p-4 sm:p-6 space-y-4 sm:space-y-6 max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-3 shrink-0">
          <div>
            <h3 className="text-base sm:text-xl font-bold tracking-tight flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-emerald-400" />
              Kết quả chụp ảnh khuôn mặt
            </h3>
            <p className="text-[11px] sm:text-xs text-slate-400 mt-0.5">
              Vui lòng xem lại chất lượng các góc chụp trước khi hoàn tất.
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center transition-colors cursor-pointer shrink-0"
            title="Đóng modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Step Images Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 sm:gap-4 overflow-y-auto flex-1 p-1">
          {session.steps.map((step) => (
            <div
              key={step.stepId}
              className="bg-slate-950 rounded-2xl border border-slate-800/80 overflow-hidden flex flex-col p-2 space-y-1.5"
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
                <span className="absolute top-1.5 left-1.5 px-2 py-0.5 text-[9px] sm:text-[10px] font-bold bg-slate-900/85 text-blue-400 rounded-md border border-slate-700 backdrop-blur-xs">
                  {step.stepType}
                </span>
              </div>

              <div className="flex items-center justify-between text-[10px] sm:text-[11px] px-1 text-slate-400 font-mono">
                <span>Góc: {step.pose?.yaw ?? 0}°</span>
                <span className="text-emerald-400 font-bold">
                  {step.quality?.overallScore ? `${Math.round(step.quality.overallScore * 100)}%` : 'OK'}
                </span>
              </div>
            </div>
          ))}
        </div>

        {/* Action Buttons */}
        <div className="flex items-center justify-end gap-2 sm:gap-3 pt-3 border-t border-slate-800 shrink-0">
          <button
            onClick={handleRetakeConfirm}
            className="px-3.5 sm:px-5 py-2.5 bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-200 font-semibold text-xs sm:text-sm rounded-xl border border-slate-700 shadow-md transition-all flex items-center gap-1.5 cursor-pointer"
          >
            <RotateCcw className="w-4 h-4 text-amber-400" />
            <span className="hidden sm:inline">Chụp lại toàn bộ</span>
            <span className="sm:hidden">Chụp lại</span>
          </button>

          <button
            onClick={onAccept}
            className="px-4 sm:px-6 py-2.5 bg-blue-600 hover:bg-blue-500 active:scale-95 text-white font-bold text-xs sm:text-sm rounded-xl shadow-lg shadow-blue-500/25 transition-all flex items-center gap-1.5 cursor-pointer"
          >
            <Send className="w-4 h-4 fill-white" />
            <span className="hidden sm:inline">Xác nhận & Lưu hồ sơ</span>
            <span className="sm:hidden">Gửi hồ sơ</span>
          </button>
        </div>
      </div>
    </div>
  );
};
