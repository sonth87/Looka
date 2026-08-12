import React from 'react';
import { Sun, Moon } from 'lucide-react';
import {
  TooltipProvider,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '../ui/tooltip.js';
import { cn } from '../../lib/utils.js';

export interface ThemeToggleProps {
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
  className?: string;
}

export const ThemeToggle: React.FC<ThemeToggleProps> = ({
  theme,
  onToggleTheme,
  className,
}) => {
  const tooltipText = theme === 'dark' ? 'Chuyển sang Giao diện Sáng' : 'Chuyển sang Giao diện Tối';

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={onToggleTheme}
            className={cn(
              'p-1.5 rounded-full transition-transform hover:scale-110 active:scale-95 cursor-pointer flex items-center justify-center',
              className
            )}
          >
            {theme === 'dark' ? (
              <Moon className="w-6 h-6 text-purple-400 fill-purple-400/20 drop-shadow-[0_0_8px_rgba(192,132,252,0.4)]" />
            ) : (
              <Sun className="w-6 h-6 text-amber-400 fill-amber-400/20 drop-shadow-[0_0_8px_rgba(251,191,36,0.4)]" />
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom" theme={theme}>
          {tooltipText}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};
