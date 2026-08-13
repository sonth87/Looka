import React from "react";
import { GestureState, GestureType } from "@face/core";
import { cn } from "../../lib/utils.js";

export interface GestureOverlayProps {
  gestureState: GestureState | null;
  gestureProgress: number; // 0..1
  faceReady: boolean;
  mirrored?: boolean;
  className?: string;
}

const GESTURE_META: Record<GestureType, { emoji: string; label: string; color: string; stroke: string }> = {
  VICTORY: { emoji: "✌️", label: "VICTORY", color: "from-violet-500 to-purple-600", stroke: "#c084fc" },
  THUMBS_UP: { emoji: "👍", label: "THUMBS UP", color: "from-amber-500 to-yellow-600", stroke: "#fbbf24" },
  OPEN_PALM: { emoji: "✋", label: "OPEN PALM", color: "from-emerald-500 to-green-600", stroke: "#34d399" },
  CLOSED_FIST: { emoji: "✊", label: "CLOSED FIST", color: "from-rose-500 to-red-600", stroke: "#fb7185" },
  OK_SIGN: { emoji: "👌", label: "OK SIGN", color: "from-sky-500 to-blue-600", stroke: "#38bdf8" },
  NONE: { emoji: "🤚", label: "NONE", color: "from-slate-500 to-slate-600", stroke: "#94a3b8" },
};

/**
 * MediaPipe 21 Hand Landmark Connections Topology
 */
const HAND_CONNECTIONS: [number, number][] = [
  // Wrist to finger bases
  [0, 1], [0, 5], [0, 9], [0, 13], [0, 17],
  // Palm across
  [5, 9], [9, 13], [13, 17],
  // Thumb
  [1, 2], [2, 3], [3, 4],
  // Index finger
  [5, 6], [6, 7], [7, 8],
  // Middle finger
  [9, 10], [10, 11], [11, 12],
  // Ring finger
  [13, 14], [14, 15], [15, 16],
  // Pinky finger
  [17, 18], [18, 19], [19, 20],
];

const FINGERTIPS = new Set([4, 8, 12, 16, 20]);

export const GestureOverlay: React.FC<GestureOverlayProps> = ({
  gestureState,
  gestureProgress,
  faceReady,
  mirrored = true,
  className,
}) => {
  const [containerSize, setContainerSize] = React.useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const observerRef = React.useRef<ResizeObserver | null>(null);

  const containerRef = React.useCallback((node: HTMLDivElement | null) => {
    if (observerRef.current) {
      observerRef.current.disconnect();
      observerRef.current = null;
    }
    if (node) {
      const updateSize = () => {
        if (node.clientWidth && node.clientHeight) {
          setContainerSize({ w: node.clientWidth, h: node.clientHeight });
        }
      };
      updateSize();
      const observer = new ResizeObserver(updateSize);
      observer.observe(node);
      observerRef.current = observer;
    }
  }, []);

  const gesture = gestureState?.gesture ?? "NONE";
  const hasGesture = gesture !== "NONE" && faceReady;
  const meta = GESTURE_META[gesture];
  const landmarks = gestureState?.landmarks || [];

  // Calculate object-cover coordinate mapping
  const streamAspect = 4 / 3;
  const containerAspect = containerSize.w && containerSize.h ? containerSize.w / containerSize.h : streamAspect;

  let scaleX = 1;
  let scaleY = 1;
  let shiftX = 0;
  let shiftY = 0;

  if (containerAspect < streamAspect) {
    scaleX = streamAspect / containerAspect;
    shiftX = (scaleX - 1) / 2;
  } else if (containerAspect > streamAspect) {
    scaleY = containerAspect / streamAspect;
    shiftY = (scaleY - 1) / 2;
  }

  const getMappedCoords = (xNorm: number, yNorm: number) => {
    const rawX = mirrored ? 1 - xNorm : xNorm;
    const px = (rawX * scaleX - shiftX) * 100;
    const py = (yNorm * scaleY - shiftY) * 100;
    return { cx: px, cy: py };
  };

  return (
    <div
      ref={containerRef}
      className={cn(
        "absolute inset-0 pointer-events-none z-30 overflow-hidden",
        className,
      )}
    >
      {/* ── Hand Skeleton Lines & Joint Dots SVG Overlay ── */}
      {landmarks.length >= 21 && (
        <svg className="absolute inset-0 w-full h-full pointer-events-none z-20">
          <defs>
            <filter id="hand-neon-glow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="2.5" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* Skeleton Bone Lines */}
          {HAND_CONNECTIONS.map(([startIdx, endIdx], idx) => {
            const p1 = landmarks[startIdx];
            const p2 = landmarks[endIdx];
            if (!p1 || !p2) return null;

            const { cx: x1, cy: y1 } = getMappedCoords(p1.x, p1.y);
            const { cx: x2, cy: y2 } = getMappedCoords(p2.x, p2.y);

            return (
              <line
                key={idx}
                x1={`${x1}%`}
                y1={`${y1}%`}
                x2={`${x2}%`}
                y2={`${y2}%`}
                stroke={meta.stroke}
                strokeWidth="2.5"
                strokeLinecap="round"
                filter="url(#hand-neon-glow)"
                className="opacity-85 transition-all duration-75"
              />
            );
          })}

          {/* 21 Hand Joint Dots */}
          {landmarks.map((lm, idx) => {
            const { cx, cy } = getMappedCoords(lm.x, lm.y);
            const isTip = FINGERTIPS.has(idx);
            const isWrist = idx === 0;

            return (
              <circle
                key={idx}
                cx={`${cx}%`}
                cy={`${cy}%`}
                r={isTip ? 5 : isWrist ? 6 : 3.5}
                fill={isTip ? "#38bdf8" : isWrist ? "#ffffff" : meta.stroke}
                stroke="#ffffff"
                strokeWidth={isTip || isWrist ? 1.5 : 1}
                filter="url(#hand-neon-glow)"
                className="transition-all duration-75"
              />
            );
          })}
        </svg>
      )}

      {/* ── Badge & Progress Bar Container (Positioned at bottom center to avoid step bar overlap) ── */}
      {hasGesture && (
        <div className="absolute bottom-16 sm:bottom-20 left-1/2 -translate-x-1/2 z-35 flex flex-col items-center gap-1.5 pointer-events-none">
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
      )}
    </div>
  );
};
