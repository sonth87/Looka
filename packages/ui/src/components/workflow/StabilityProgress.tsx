import React from 'react';
import { cn } from '../../lib/utils.js';

export interface StabilityProgressProps {
  progress: number; // 0.0 to 1.0
  text?: string;
  className?: string;
}

export const StabilityProgress: React.FC<StabilityProgressProps> = ({
  progress,
  text = 'Giữ nguyên tư thế...',
  className,
}) => {
  const percentage = Math.round(Math.min(1.0, Math.max(0.0, progress)) * 100);

  return (
    <div
      className={cn(
        'w-full max-w-xs mx-auto space-y-1.5 text-center transition-all duration-200',
        className
      )}
    >
      <div className="flex justify-between text-xs font-medium text-slate-300">
        <span>{text}</span>
        <span>{percentage}%</span>
      </div>
      <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden p-0.5 border border-slate-700/60 shadow-inner">
        <div
          className="h-full bg-gradient-to-r from-blue-500 to-emerald-400 rounded-full transition-all duration-150 shadow-sm"
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
};
