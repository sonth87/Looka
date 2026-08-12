import React from 'react';
import { Check } from 'lucide-react';
import { cn } from '../../lib/utils.js';

export interface StepItem {
  id: string;
  label: string;
  status: 'PENDING' | 'CURRENT' | 'COMPLETED' | 'FAILED';
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
  theme = 'dark',
  className,
}) => {
  if (!steps || steps.length === 0) return null;

  return (
    <div className={cn('flex items-center justify-between w-full max-w-md mx-auto py-1', className)}>
      {steps.map((step, idx) => {
        const isCurrent = idx === currentStepIndex;
        const isCompleted = step.status === 'COMPLETED' || idx < currentStepIndex;
        const isFailed = step.status === 'FAILED';

        const dotColor = isCompleted
          ? 'bg-emerald-500 text-white border-emerald-400'
          : isCurrent
          ? 'bg-blue-600 text-white border-blue-400 ring-4 ring-blue-500/20 animate-pulse'
          : isFailed
          ? 'bg-rose-500 text-white border-rose-400'
          : theme === 'dark'
          ? 'bg-slate-800/80 text-slate-500 border-slate-700'
          : 'bg-slate-200/80 text-slate-400 border-slate-300';

        const lineColor = idx < currentStepIndex
          ? 'bg-emerald-500'
          : theme === 'dark'
          ? 'bg-slate-800'
          : 'bg-slate-300';

        const labelColor = isCurrent
          ? 'text-blue-500 font-semibold'
          : isCompleted
          ? 'text-emerald-500'
          : theme === 'dark'
          ? 'text-slate-500'
          : 'text-slate-400';

        return (
          <React.Fragment key={step.id}>
            <div className="flex flex-col items-center gap-1 relative">
              <div
                className={cn(
                  'w-7 h-7 rounded-full border-2 flex items-center justify-center font-bold text-xs transition-all duration-300 shadow-sm',
                  dotColor
                )}
              >
                {isCompleted ? <Check className="w-3.5 h-3.5 stroke-[3]" /> : idx + 1}
              </div>
              <span className={cn('text-[10px] font-medium tracking-wide transition-colors', labelColor)}>
                {step.label}
              </span>
            </div>

            {idx < steps.length - 1 && (
              <div className="flex-1 h-0.5 mx-2 mb-4 rounded-full overflow-hidden">
                <div className={cn('h-full transition-all duration-500', lineColor)} />
              </div>
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
};
