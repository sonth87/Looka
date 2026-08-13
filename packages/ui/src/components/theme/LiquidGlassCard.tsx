import React from "react";
import { cn } from "../../lib/utils.js";
import { LiquidGlassSvgFilter } from "./LiquidGlassSvgFilter.js";

export interface LiquidGlassCardProps {
  children: React.ReactNode;
  theme?: "dark" | "light";
  variant?: "pill" | "card" | "badge";
  className?: string;
  style?: React.CSSProperties;
}

export const LiquidGlassCard: React.FC<LiquidGlassCardProps> = ({
  children,
  theme = "dark",
  variant = "card",
  className,
  style,
}) => {
  const liquidStyle: React.CSSProperties = {
    backdropFilter:
      "url(#liquid-glass-refraction) blur(0.5px) contrast(1.2) brightness(1.05) saturate(1.15)",
    WebkitBackdropFilter:
      "url(#liquid-glass-refraction) blur(0.5px) contrast(1.2) brightness(1.05) saturate(1.15)",
    boxShadow:
      theme === "dark"
        ? "0 8px 32px rgba(0,0,0,0.35), 0 -8px 20px inset rgba(0,0,0,0.2), inset 0 1px 1.5px rgba(255,255,255,0.4)"
        : "0 8px 24px rgba(0,0,0,0.08), 0 -6px 15px inset rgba(0,0,0,0.05), inset 0 1px 1.5px rgba(255,255,255,0.9)",
    ...style,
  };

  const roundedClass = variant === "pill" || variant === "badge" ? "rounded-full" : "rounded-2xl";

  return (
    <>
      <LiquidGlassSvgFilter />
      <div
        style={liquidStyle}
        className={cn(
          "relative overflow-hidden transition-all duration-300 backdrop-contrast-125",
          roundedClass,
          theme === "dark"
            ? "bg-slate-950/60 border border-white/20 text-slate-100"
            : "bg-white/75 border border-white/80 text-slate-900",
          className,
        )}
      >
        {/* Top edge specular highlight line */}
        <div className="absolute top-0 left-3 right-3 h-[1px] bg-gradient-to-r from-transparent via-white/70 to-transparent pointer-events-none" />
        {children}
      </div>
    </>
  );
};
