import React from 'react';
import { GuidanceState } from '@face/core';
import { cn } from '../../lib/utils.js';
import { LiquidGlassSvgFilter } from '../theme/LiquidGlassSvgFilter.js';

export interface GuidanceMessageProps {
  guidance: GuidanceState;
  theme?: 'dark' | 'light';
  className?: string;
}

export const GuidanceMessage: React.FC<GuidanceMessageProps> = ({ guidance, theme = 'dark', className }) => {
  const isReady = guidance.status === 'READY' || guidance.status === 'CAPTURING';
  const isError = guidance.status === 'ERROR' || guidance.status === 'MULTIPLE_FACES';

  const badgeBg = isReady
    ? 'bg-emerald-500/25 text-emerald-300 border-emerald-400/40 shadow-[0_0_12px_rgba(16,185,129,0.3)]'
    : isError
    ? 'bg-rose-500/25 text-rose-300 border-rose-400/40 shadow-[0_0_12px_rgba(244,63,94,0.3)]'
    : 'bg-blue-500/25 text-blue-300 border-blue-400/40 shadow-[0_0_12px_rgba(96,165,250,0.3)]';

  const liquidStyle: React.CSSProperties = {
    backdropFilter: 'url(#liquid-glass-refraction) blur(20px) saturate(190%)',
    WebkitBackdropFilter: 'url(#liquid-glass-refraction) blur(20px) saturate(190%)',
    boxShadow:
      theme === 'dark'
        ? '0 20px 50px rgba(0,0,0,0.55), inset 0 1px 0.5px rgba(255,255,255,0.4)'
        : '0 20px 45px rgba(0,0,0,0.08), inset 0 1px 0.5px rgba(255,255,255,0.9)',
  };

  return (
    <>
      <LiquidGlassSvgFilter />
      <div
        style={liquidStyle}
        className={cn(
          'flex flex-col items-center text-center p-3 sm:p-5 rounded-2xl relative overflow-hidden transition-all duration-300 backdrop-contrast-125 max-w-md w-full mx-auto',
          theme === 'dark'
            ? 'bg-slate-950/35 border border-white/25 text-slate-100'
            : 'bg-white/40 border border-white/60 text-slate-900',
          className
        )}
      >
        {/* Diagonal sheen overlay */}
        <div className="absolute inset-0 bg-gradient-to-br from-white/30 via-transparent to-white/5 pointer-events-none rounded-2xl" />

        {/* Top edge specular highlight */}
        <div className="absolute top-0 left-4 right-4 h-[1px] bg-gradient-to-r from-transparent via-white/60 to-transparent pointer-events-none" />

        {/* Status Badge with Liquid Glass blur */}
        <div
          className={cn(
            'px-3 sm:px-4 py-1 rounded-full text-[10px] sm:text-xs font-extrabold tracking-wide border mb-2 sm:mb-3 backdrop-blur-2xl backdrop-saturate-180 relative z-10 transition-all',
            badgeBg
          )}
        >
          {guidance.status}
        </div>

        <h2
          className={cn(
            'text-base sm:text-xl font-bold tracking-tight relative z-10 transition-all drop-shadow-sm leading-snug',
            theme === 'dark' ? 'text-slate-100' : 'text-slate-900'
          )}
        >
          {guidance.primaryInstruction}
        </h2>

        {guidance.hints && guidance.hints.length > 0 && (
          <div className="mt-2 sm:mt-3 flex flex-wrap justify-center gap-1 sm:gap-1.5 relative z-10">
            {guidance.hints.map((hint, idx) => (
              <span
                key={idx}
                className={cn(
                  'text-[10px] sm:text-xs px-2 sm:px-2.5 py-0.5 rounded-lg border backdrop-blur-xl font-medium shadow-sm',
                  theme === 'dark'
                    ? 'bg-slate-900/40 text-slate-200 border-white/20'
                    : 'bg-white/50 text-slate-800 border-white/60'
                )}
              >
                {hint.message}
              </span>
            ))}
          </div>
        )}
      </div>
    </>
  );
};
