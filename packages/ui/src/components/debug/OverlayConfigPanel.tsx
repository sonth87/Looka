import React from "react";
import { Eye, EyeOff, Sliders, Layers, CircleDot } from "lucide-react";
import { DraggablePanel } from "./DraggablePanel.js";
import { cn } from "../../lib/utils.js";

export interface OverlayConfigPanelProps {
  visible: boolean;
  onToggleVisible: (visible: boolean) => void;
  opacity: number; // 0..1
  onOpacityChange: (opacity: number) => void;
  showLandmarks?: boolean;
  onToggleLandmarks?: (show: boolean) => void;
  landmarkSize?: number; // in px (0.5 .. 6.0)
  onLandmarkSizeChange?: (size: number) => void;
  theme?: "dark" | "light";
  isFullscreen?: boolean;
  defaultPosition?: { x: number; y: number };
  className?: string;
}

export const OverlayConfigPanel: React.FC<OverlayConfigPanelProps> = ({
  visible,
  onToggleVisible,
  opacity,
  onOpacityChange,
  showLandmarks = false,
  onToggleLandmarks,
  landmarkSize = 1.5,
  onLandmarkSizeChange,
  theme = "dark",
  isFullscreen = false,
  defaultPosition = { x: 30, y: 380 },
  className,
}) => {
  const title = (
    <span
      className={cn(
        "flex items-center gap-1.5 font-semibold text-xs",
        theme === "dark" ? "text-slate-100" : "text-slate-900",
      )}
    >
      <Layers className="w-3.5 h-3.5 text-blue-400" />
      Overlay Config
    </span>
  );

  const liquidCardStyle =
    theme === "dark"
      ? isFullscreen
        ? "bg-slate-900/20 border border-white/20 backdrop-blur-xl shadow-[inset_0_1px_1px_rgba(255,255,255,0.3)]"
        : "bg-slate-900/35 border border-white/15 backdrop-blur-xl shadow-[inset_0_1px_1px_rgba(255,255,255,0.2)]"
      : isFullscreen
        ? "bg-white/20 border border-white/60 backdrop-blur-xl shadow-[inset_0_1px_1px_rgba(255,255,255,0.8)]"
        : "bg-white/35 border border-white/50 backdrop-blur-xl shadow-[inset_0_1px_1px_rgba(255,255,255,0.6)]";

  const liquidButtonStyle =
    theme === "dark"
      ? "bg-slate-900/40 hover:bg-slate-800/70 border border-white/20 text-slate-200"
      : "bg-white/40 hover:bg-white/80 border border-white/60 text-slate-800";

  return (
    <DraggablePanel
      storageKey="face_ui_overlay_config_panel"
      title={title}
      icon={<Sliders className="w-4 h-4" />}
      theme={theme}
      isFullscreen={isFullscreen}
      defaultPosition={defaultPosition}
      className={cn("w-60", className)}
    >
      <div className="font-mono text-[11px]">
        {/* Single Unified Card combining Khung Overlay & Điểm mốc */}
        <div
          className={cn("p-2.5 rounded-xl border space-y-2.5", liquidCardStyle)}
        >
          {/* Row 1: Khung Overlay */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                {visible ? (
                  <Eye className="w-3.5 h-3.5 text-blue-400" />
                ) : (
                  <EyeOff className="w-3.5 h-3.5 text-slate-400" />
                )}
                <span
                  className={cn(
                    "font-semibold",
                    theme === "dark" ? "text-slate-200" : "text-slate-800",
                  )}
                >
                  Khung Overlay
                </span>
              </div>

              <button
                onClick={() => onToggleVisible(!visible)}
                className={cn(
                  "px-2 py-0.5 rounded border text-[10px] font-bold transition-all cursor-pointer",
                  visible
                    ? "bg-blue-600 border-blue-500 text-white shadow-sm"
                    : liquidButtonStyle,
                )}
              >
                {visible ? "Bật" : "Tắt"}
              </button>
            </div>

            <div className="flex items-center gap-2 pt-0.5">
              <span className="text-[10px] text-slate-400 whitespace-nowrap min-w-[42px]">
                Đục:{" "}
                <b className="text-blue-400">{Math.round(opacity * 100)}%</b>
              </span>
              <input
                type="range"
                min="0.1"
                max="1"
                step="0.05"
                value={opacity}
                disabled={!visible}
                onChange={(e) => onOpacityChange(parseFloat(e.target.value))}
                className="w-full h-1 accent-blue-500 cursor-pointer disabled:opacity-40"
              />
            </div>
          </div>

          {/* Divider */}
          {onToggleLandmarks && (
            <div
              className={cn(
                "border-t my-1",
                theme === "dark" ? "border-white/10" : "border-slate-300/50",
              )}
            />
          )}

          {/* Row 2: Điểm mốc (Landmarks) */}
          {onToggleLandmarks && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <CircleDot className="w-3.5 h-3.5 text-emerald-400" />
                  <span
                    className={cn(
                      "font-semibold",
                      theme === "dark" ? "text-slate-200" : "text-slate-800",
                    )}
                  >
                    Điểm mốc (Dots)
                  </span>
                </div>

                <button
                  onClick={() => onToggleLandmarks(!showLandmarks)}
                  className={cn(
                    "px-2 py-0.5 rounded border text-[10px] font-bold transition-all cursor-pointer",
                    showLandmarks
                      ? "bg-emerald-600 border-emerald-500 text-white shadow-sm"
                      : liquidButtonStyle,
                  )}
                >
                  {showLandmarks ? "Bật" : "Tắt"}
                </button>
              </div>

              {onLandmarkSizeChange && (
                <div className="flex items-center gap-2 pt-0.5">
                  <span className="text-[10px] text-slate-400 whitespace-nowrap min-w-[42px]">
                    Size:{" "}
                    <b className="text-emerald-400">
                      {landmarkSize.toFixed(1)}p
                    </b>
                  </span>
                  <input
                    type="range"
                    min="0.5"
                    max="6"
                    step="0.25"
                    value={landmarkSize}
                    disabled={!showLandmarks}
                    onChange={(e) =>
                      onLandmarkSizeChange(parseFloat(e.target.value))
                    }
                    className="w-full h-1 accent-emerald-500 cursor-pointer disabled:opacity-40"
                  />
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </DraggablePanel>
  );
};
