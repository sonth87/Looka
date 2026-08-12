import React from 'react';
import { Check } from 'lucide-react';
import { cn } from '../../lib/utils.js';

export interface StepItem {
  id: string;
  label: string;
  status: 'PENDING' | 'CURRENT' | 'COMPLETED' | 'FAILED';
  imagePath?: string;
}

export interface StepProgressProps {
  steps: StepItem[];
  currentStepIndex: number;
  theme?: 'dark' | 'light';
  className?: string;
}

export const StepProgress: React.FC<StepProgressProps> = ({
  steps,
  currentStepIndex,
  theme = 'light',
  className,
}) => {
  if (!steps || steps.length === 0) return null;

  return (
    <div
      className={cn(
        'flex items-center justify-between w-full max-w-md mx-auto py-1 px-1 sm:px-0 overflow-x-auto no-scrollbar bg-transparent border-0 shadow-none',
        className
      )}
    >
      {steps.map((step, idx) => {
        const isCurrent = idx === currentStepIndex;
        const isCompleted = step.status === 'COMPLETED' || idx < currentStepIndex;
        const isFailed = step.status === 'FAILED';

        const dotStyle = isCompleted
          ? 'backdrop-blur-xl bg-gradient-to-br from-emerald-500/90 to-teal-600/90 text-white border-white/60 shadow-[inset_0_1.5px_2px_rgba(255,255,255,0.8),inset_0_-1px_1px_rgba(0,0,0,0.2),0_4px_14px_rgba(16,185,129,0.4)]'
          : isCurrent
          ? 'backdrop-blur-xl bg-gradient-to-br from-blue-500/95 to-indigo-600/95 text-white border-white/70 ring-4 ring-blue-500/30 shadow-[inset_0_1.5px_2.5px_rgba(255,255,255,0.9),inset_0_-1px_1px_rgba(0,0,0,0.2),0_6px_20px_rgba(37,99,235,0.5)] scale-110'
          : isFailed
          ? 'backdrop-blur-xl bg-gradient-to-br from-rose-500/90 to-red-600/90 text-white border-white/60 shadow-[inset_0_1.5px_2px_rgba(255,255,255,0.7),0_4px_14px_rgba(244,63,94,0.4)]'
          : theme === 'dark'
          ? 'backdrop-blur-xl bg-white/12 text-slate-200 border-white/25 shadow-[inset_0_1.5px_2px_rgba(255,255,255,0.4),inset_0_-1px_1px_rgba(0,0,0,0.3),0_4px_12px_rgba(0,0,0,0.3)]'
          : 'backdrop-blur-xl bg-white/65 text-slate-800 border-white/80 shadow-[inset_0_1.5px_2px_rgba(255,255,255,0.95),inset_0_-1px_1px_rgba(0,0,0,0.08),0_4px_12px_rgba(0,0,0,0.08)]';

        const lineColor = idx < currentStepIndex
          ? 'bg-gradient-to-r from-emerald-400 to-emerald-500'
          : theme === 'dark'
          ? 'bg-white/15'
          : 'bg-slate-300/80';

        const labelColor = isCurrent
          ? 'text-blue-600 dark:text-blue-400 font-bold drop-shadow-xs scale-105'
          : isCompleted
          ? 'text-emerald-600 dark:text-emerald-400 font-semibold'
          : theme === 'dark'
          ? 'text-slate-400 font-medium'
          : 'text-slate-600 font-medium';

        return (
          <React.Fragment key={step.id}>
            <div className="flex flex-col items-center gap-0.5 sm:gap-1 relative shrink-0">
              <div
                data-step-id={step.id}
                className={cn(
                  'w-6 h-6 sm:w-7 sm:h-7 rounded-full border flex items-center justify-center font-black text-[10px] sm:text-xs transition-all duration-300 cursor-default select-none',
                  dotStyle
                )}
              >
                {isCompleted && step.imagePath && step.imagePath.startsWith('data:') ? (
                  <img
                    src={step.imagePath}
                    alt={step.label}
                    className="w-full h-full rounded-full object-cover border border-emerald-400 shadow-md animate-in zoom-in duration-300"
                  />
                ) : isCompleted ? (
                  <Check className="w-3.5 h-3.5 stroke-[3]" />
                ) : (
                  idx + 1
                )}
              </div>
              <span className={cn('text-[9px] sm:text-[10px] tracking-tight transition-all duration-300 whitespace-nowrap', labelColor)}>
                {step.label}
              </span>
            </div>

            {idx < steps.length - 1 && (
              <div className="flex-1 min-w-[10px] sm:min-w-[14px] h-0.5 mx-1 sm:mx-1.5 mb-3.5 sm:mb-4 rounded-full overflow-hidden shrink">
                <div className={cn('h-full transition-all duration-500', lineColor)} />
              </div>
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
};
