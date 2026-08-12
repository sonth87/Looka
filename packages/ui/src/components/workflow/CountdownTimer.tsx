import React from 'react';
import { cn } from '../../lib/utils.js';

export interface CountdownTimerProps {
  value: number; // e.g. 3, 2, 1, 0
  className?: string;
}

export const CountdownTimer: React.FC<CountdownTimerProps> = ({ value, className }) => {
  if (value <= 0) return null;

  return (
    <div
      className={cn(
        'absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-xs pointer-events-none z-20',
        className
      )}
    >
      <div className="w-24 h-24 rounded-full bg-blue-600/90 text-white font-extrabold text-5xl flex items-center justify-center shadow-2xl border-4 border-white/80 animate-bounce">
        {value}
      </div>
    </div>
  );
};
