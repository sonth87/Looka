import React from 'react';
import { cn } from '../../lib/utils.js';

export interface CameraErrorProps {
  message?: string;
  code?: string;
  onRetry?: () => void;
  className?: string;
}

export const CameraError: React.FC<CameraErrorProps> = ({
  message = 'Không thể kết nối đến camera.',
  code,
  onRetry,
  className,
}) => {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center p-6 text-center bg-slate-900/90 backdrop-blur-md rounded-2xl border border-red-900/40 shadow-xl max-w-md mx-auto',
        className
      )}
    >
      <div className="w-14 h-14 rounded-full bg-red-500/10 flex items-center justify-center text-red-400 mb-4 border border-red-500/20">
        <svg
          className="w-7 h-7"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
          />
        </svg>
      </div>

      <h3 className="text-lg font-semibold text-slate-100 mb-1">Lỗi Camera</h3>

      <p className="text-sm text-slate-400 mb-2 leading-relaxed">{message}</p>

      {code && (
        <span className="text-xs font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-400 mb-5 border border-slate-700">
          Code: {code}
        </span>
      )}

      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-2 px-5 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-100 font-medium text-sm rounded-xl border border-slate-700 shadow-md transition-all active:scale-95 cursor-pointer flex items-center gap-2"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
          Thử lại
        </button>
      )}
    </div>
  );
};
