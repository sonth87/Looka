import React from "react";
import { GestureState, GestureType } from "@face/core";
import { cn } from "../../lib/utils.js";

export interface GestureOverlayProps {
  gestureState: GestureState | null;
  gestureProgress: number; // 0..1
  faceReady: boolean;
  className?: string;
}

const GESTURE_META: Record<GestureType, { emoji: string; label: string; color: string }> = {
  VICTORY: { emoji: "✌️", label: "VICTORY", color: "from-violet-500 to-purple-600" },
  THUMBS_UP: { emoji: "👍", label: "THUMBS UP", color: "from-amber-500 to-yellow-600" },
  OPEN_PALM: { emoji: "✋", label: "OPEN PALM", color: "from-emerald-500 to-green-600" },
  CLOSED_FIST: { emoji: "✊", label: "CLOSED FIST", color: "from-rose-500 to-red-600" },
  OK_SIGN: { emoji: "👌", label: "OK SIGN", color: "from-sky-500 to-blue-600" },
  NONE: { emoji: "🤚", label: "NONE", color: "from-slate-500 to-slate-600" },
};

export const GestureOverlay: React.FC<GestureOverlayProps> = ({
  gestureState,
  gestureProgress,
  faceReady,
  className,
}) => {
  const gesture = gestureState?.gesture ?? "NONE";
  const hasGesture = gesture !== "NONE" && faceReady;
  const meta = GESTURE_META[gesture];

  if (!hasGesture) return null;

  return (
    <div
      className={cn(
        "absolute top-3 left-1/2 -translate-x-1/2 z-30 flex flex-col items-center gap-1.5 pointer-events-none",
        className,
      )}
    >
      {/* Gesture Badge */}
      <div
        className={cn(
          "flex items-center gap-2 px-3 py-1.5 rounded-full text-white text-xs font-bold",
          "backdrop-blur-md border border-white/30 shadow-lg",
          `bg-gradient-to-r ${meta.color}`,
          "animate-[fadeInDown_0.2s_ease-out]",
        )}
        style={{ animationFillMode: "backwards" }}
      >
        <span className="text-base leading-none">{meta.emoji}</span>
        <span className="tracking-wider">{meta.label}</span>
        {gestureProgress >= 1.0 && (
          <span className="ml-1 text-[10px] bg-white/25 rounded px-1">✓ Chụp!</span>
        )}
      </div>

      {/* Confirmation Progress Bar */}
      <div className="w-32 h-1.5 bg-white/20 rounded-full overflow-hidden backdrop-blur-sm">
        <div
          className={cn(
            "h-full rounded-full transition-all duration-75",
            gestureProgress >= 1.0
              ? "bg-white"
              : `bg-gradient-to-r ${meta.color}`,
          )}
          style={{ width: `${Math.round(gestureProgress * 100)}%` }}
        />
      </div>

      {/* Countdown text */}
      <p className="text-white/70 text-[10px] font-mono">
        {gestureProgress >= 1.0
          ? "Sẵn sàng chụp…"
          : `Giữ cử chỉ… ${Math.round(gestureProgress * 100)}%`}
      </p>
    </div>
  );
};
