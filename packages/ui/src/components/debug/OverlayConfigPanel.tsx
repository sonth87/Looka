import React from "react";
import { Eye, EyeOff, Sliders, Layers, CircleDot, Camera, Timer, Hand, Gauge } from "lucide-react";
import { DraggablePanel } from "./DraggablePanel.js";
import { cn } from "../../lib/utils.js";
import { CaptureSensitivity, CaptureTriggerMode, GestureType } from "@face/core";

export interface OverlayConfigPanelProps {
  visible: boolean;
  onToggleVisible: (visible: boolean) => void;
  opacity: number; // 0..1
  onOpacityChange: (opacity: number) => void;
  showLandmarks?: boolean;
  onToggleLandmarks?: (show: boolean) => void;
  landmarkSize?: number; // in px (0.3 .. 3.0)
  onLandmarkSizeChange?: (size: number) => void;
  // Capture trigger
  captureMode?: CaptureTriggerMode;
  onCaptureModeChange?: (mode: CaptureTriggerMode) => void;
  autoHoldMs?: number; // milliseconds
  onAutoHoldMsChange?: (ms: number) => void;
  allowedGestures?: GestureType[];
  onAllowedGesturesChange?: (gestures: GestureType[]) => void;
  // Sensitivity / Strictness
  sensitivity?: CaptureSensitivity;
  onSensitivityChange?: (s: CaptureSensitivity) => void;
  theme?: "dark" | "light";
  isFullscreen?: boolean;
  defaultPosition?: { x: number; y: number };
  className?: string;
}

const ALL_GESTURES: { key: GestureType; label: string }[] = [
  { key: "VICTORY", label: "✌ V" },
  { key: "THUMBS_UP", label: "👍 Thumbs Up" },
  { key: "OPEN_PALM", label: "✋ Open Palm" },
  { key: "CLOSED_FIST", label: "✊ Fist" },
  { key: "OK_SIGN", label: "👌 OK" },
];

const SENSITIVITY_LEVELS: { key: CaptureSensitivity; label: string; desc: string }[] = [
  { key: "VERY_LOW", label: "Rất thấp", desc: "Dễ dãi nhất (mờ/tối vẫn pass)" },
  { key: "LOW", label: "Thấp", desc: "Nới lỏng góc & độ nét" },
  { key: "MEDIUM", label: "Vừa", desc: "Cân bằng tiêu chuẩn" },
  { key: "HIGH", label: "Cao", desc: "Yêu cầu rõ nét & chuẩn tư thế" },
  { key: "VERY_HIGH", label: "Rất cao", desc: "Siết chặt bảo mật eKYC" },
];

export const OverlayConfigPanel: React.FC<OverlayConfigPanelProps> = ({
  visible,
  onToggleVisible,
  opacity,
  onOpacityChange,
  showLandmarks = false,
  onToggleLandmarks,
  landmarkSize = 1.5,
  onLandmarkSizeChange,
  captureMode = "AUTO",
  onCaptureModeChange,
  autoHoldMs = 2000,
  onAutoHoldMsChange,
  allowedGestures = ["VICTORY", "THUMBS_UP", "OPEN_PALM"],
  onAllowedGesturesChange,
  sensitivity = "MEDIUM",
  onSensitivityChange,
  theme = "dark",
  isFullscreen = false,
  defaultPosition = { x: 20, y: 360 },
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

  const dividerClass = cn(
    "border-t my-1",
    theme === "dark" ? "border-white/10" : "border-slate-300/50",
  );

  const labelClass = cn(
    "font-semibold",
    theme === "dark" ? "text-slate-200" : "text-slate-800",
  );

  const toggleGesture = (key: GestureType) => {
    if (!onAllowedGesturesChange) return;
    if (allowedGestures.includes(key)) {
      const next = allowedGestures.filter((g) => g !== key);
      onAllowedGesturesChange(next.length > 0 ? next : allowedGestures);
    } else {
      onAllowedGesturesChange([...allowedGestures, key]);
    }
  };

  const activeSensObj = SENSITIVITY_LEVELS.find((s) => s.key === sensitivity) || SENSITIVITY_LEVELS[2];

  return (
    <DraggablePanel
      storageKey="face_ui_overlay_config_panel"
      title={title}
      icon={<Sliders className="w-4 h-4" />}
      theme={theme}
      isFullscreen={isFullscreen}
      defaultPosition={defaultPosition}
      className={cn("w-72", className)}
    >
      <div className="font-mono text-[11px] space-y-2">

        {/* ─── Độ nhạy (Sensitivity) ─── */}
        {onSensitivityChange && (
          <div className={cn("p-2.5 rounded-xl border space-y-2", liquidCardStyle)}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Gauge className="w-3.5 h-3.5 text-amber-400" />
                <span className={labelClass}>Độ nhạy</span>
              </div>
              <span className="text-[10px] text-amber-400 font-bold">
                {activeSensObj.label}
              </span>
            </div>

            {/* 5 Level Toggle Buttons */}
            <div className="flex gap-0.5">
              {SENSITIVITY_LEVELS.map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => onSensitivityChange(key)}
                  className={cn(
                    "flex-1 py-0.5 rounded border text-[9px] font-bold transition-all cursor-pointer truncate px-0.5 text-center",
                    sensitivity === key
                      ? "bg-amber-600 border-amber-500 text-white shadow-sm"
                      : liquidButtonStyle,
                  )}
                  title={label}
                >
                  {label.slice(0, 3)}
                </button>
              ))}
            </div>
            <p className="text-[9.5px] text-slate-400 leading-tight">
              {activeSensObj.desc}
            </p>
          </div>
        )}

        {/* ─── Chế độ chụp ─── */}
        {onCaptureModeChange && (
          <div className={cn("p-2.5 rounded-xl border space-y-2", liquidCardStyle)}>
            <div className="flex items-center gap-1.5">
              <Camera className="w-3.5 h-3.5 text-violet-400" />
              <span className={labelClass}>Chế độ chụp</span>
            </div>

            {/* 3 Toggle Buttons */}
            <div className="flex gap-1">
              {(["AUTO", "MANUAL", "OFF"] as CaptureTriggerMode[]).map((m) => (
                <button
                  key={m}
                  onClick={() => onCaptureModeChange(m)}
                  className={cn(
                    "flex-1 py-0.5 rounded border text-[10px] font-bold transition-all cursor-pointer",
                    captureMode === m
                      ? "bg-violet-600 border-violet-500 text-white shadow-sm"
                      : liquidButtonStyle,
                  )}
                >
                  {m}
                </button>
              ))}
            </div>

            {/* AUTO: Hold duration slider */}
            {captureMode === "AUTO" && onAutoHoldMsChange && (
              <div className="flex items-center gap-2">
                <Timer className="w-3 h-3 text-violet-400 shrink-0" />
                <span className="text-[10px] text-slate-400 whitespace-nowrap">
                  Giữ:{" "}
                  <b className="text-violet-400">{(autoHoldMs / 1000).toFixed(1)}s</b>
                </span>
                <input
                  type="range"
                  min="500"
                  max="5000"
                  step="250"
                  value={autoHoldMs}
                  onChange={(e) => onAutoHoldMsChange(Number(e.target.value))}
                  className="w-full h-1 accent-violet-500 cursor-pointer"
                />
              </div>
            )}

            {/* MANUAL: Gesture checklist */}
            {captureMode === "MANUAL" && onAllowedGesturesChange && (
              <div className="space-y-1">
                <div className="flex items-center gap-1.5 mb-0.5">
                  <Hand className="w-3 h-3 text-violet-400" />
                  <span className="text-[10px] text-slate-400">Cử chỉ kích hoạt:</span>
                </div>
                {ALL_GESTURES.map(({ key, label }) => {
                  const active = allowedGestures.includes(key);
                  return (
                    <button
                      key={key}
                      onClick={() => toggleGesture(key)}
                      className={cn(
                        "w-full flex items-center justify-between px-2 py-0.5 rounded border text-[10px] transition-all cursor-pointer",
                        active
                          ? "bg-violet-600/70 border-violet-500 text-white"
                          : liquidButtonStyle,
                      )}
                    >
                      <span>{label}</span>
                      <span>{active ? "✓" : ""}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ─── Overlay + Landmarks ─── */}
        <div className={cn("p-2.5 rounded-xl border space-y-2.5", liquidCardStyle)}>
          {/* Khung Overlay */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                {visible ? (
                  <Eye className="w-3.5 h-3.5 text-blue-400" />
                ) : (
                  <EyeOff className="w-3.5 h-3.5 text-slate-400" />
                )}
                <span className={labelClass}>Khung Overlay</span>
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
          {onToggleLandmarks && <div className={dividerClass} />}

          {/* Điểm mốc */}
          {onToggleLandmarks && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <CircleDot className="w-3.5 h-3.5 text-emerald-400" />
                  <span className={labelClass}>Điểm mốc (Dots)</span>
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
                    <b className="text-emerald-400">{landmarkSize.toFixed(1)}p</b>
                  </span>
                  <input
                    type="range"
                    min="0.3"
                    max="3"
                    step="0.1"
                    value={landmarkSize}
                    disabled={!showLandmarks}
                    onChange={(e) => onLandmarkSizeChange(parseFloat(e.target.value))}
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
