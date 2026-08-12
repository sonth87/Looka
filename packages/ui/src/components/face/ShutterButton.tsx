import React from "react";
import { cn } from "../../lib/utils.js";

export interface ShutterButtonProps {
  enabled: boolean;
  onCapture: () => void;
  className?: string;
}

export const ShutterButton: React.FC<ShutterButtonProps> = ({
  enabled,
  onCapture,
  className,
}) => {
  return (
    <div
      className={cn(
        "absolute bottom-6 left-1/2 -translate-x-1/2 z-30 flex flex-col items-center gap-2",
        className,
      )}
    >
      <button
        id="shutter-button"
        onClick={enabled ? onCapture : undefined}
        disabled={!enabled}
        aria-label="Chụp ảnh"
        className={cn(
          "relative w-16 h-16 rounded-full border-4 transition-all duration-200 outline-none",
          "flex items-center justify-center",
          enabled
            ? [
                "border-white bg-white/20 backdrop-blur-md cursor-pointer",
                "hover:bg-white/40 hover:scale-110",
                "active:scale-95",
                "shadow-[0_0_20px_rgba(255,255,255,0.4)]",
                "after:content-[''] after:absolute after:inset-2 after:rounded-full after:bg-white",
              ]
            : [
                "border-slate-600 bg-slate-800/30 cursor-not-allowed opacity-40",
                "after:content-[''] after:absolute after:inset-2 after:rounded-full after:bg-slate-500",
              ],
        )}
      />
      <span
        className={cn(
          "text-[11px] font-semibold tracking-wide",
          enabled ? "text-white/90" : "text-slate-500",
        )}
      >
        {enabled ? "Nhấn để chụp" : "Canh khuôn mặt..."}
      </span>
    </div>
  );
};
