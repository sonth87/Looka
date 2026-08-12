import React, { useState } from 'react';
import { Sliders } from 'lucide-react';
import { FacePresenceState } from '@face/core';
import { DraggablePanel } from './DraggablePanel.js';
import { cn } from '../../lib/utils.js';

export interface SimulationSettings {
  presence: FacePresenceState;
  yaw: number;
  pitch: number;
  roll: number;
  faceSizeRatio: number;
  qualityScore: number;
}

export interface SimulationSlidersProps {
  initialSettings?: Partial<SimulationSettings>;
  onChange: (settings: SimulationSettings) => void;
  theme?: 'dark' | 'light';
  isFullscreen?: boolean;
  className?: string;
  defaultPosition?: { x: number; y: number };
}

export const SimulationSliders: React.FC<SimulationSlidersProps> = ({
  initialSettings,
  onChange,
  theme = 'dark',
  isFullscreen = false,
  className,
  defaultPosition = typeof window !== 'undefined'
    ? { x: Math.max(20, window.innerWidth - 310), y: 75 }
    : { x: 1200, y: 75 },
}) => {
  const [settings, setSettings] = useState<SimulationSettings>({
    presence: 'SINGLE_FACE',
    yaw: 0,
    pitch: 0,
    roll: 0,
    faceSizeRatio: 0.45,
    qualityScore: 0.9,
    ...initialSettings,
  });

  const updateSetting = <K extends keyof SimulationSettings>(
    key: K,
    value: SimulationSettings[K]
  ) => {
    const updated = { ...settings, [key]: value };
    setSettings(updated);
    onChange(updated);
  };

  const setPreset = (presetName: string) => {
    let preset: Partial<SimulationSettings> = {};
    if (presetName === 'FRONT') preset = { presence: 'SINGLE_FACE', yaw: 0, pitch: 0, roll: 0 };
    if (presetName === 'LEFT') preset = { presence: 'SINGLE_FACE', yaw: -30, pitch: 0, roll: 0 };
    if (presetName === 'RIGHT') preset = { presence: 'SINGLE_FACE', yaw: 30, pitch: 0, roll: 0 };
    if (presetName === 'UP') preset = { presence: 'SINGLE_FACE', yaw: 0, pitch: 20, roll: 0 };
    if (presetName === 'DOWN') preset = { presence: 'SINGLE_FACE', yaw: 0, pitch: -20, roll: 0 };
    if (presetName === 'NO_FACE') preset = { presence: 'NO_FACE' };

    const updated = { ...settings, ...preset };
    setSettings(updated);
    onChange(updated);
  };

  const title = (
    <div className="flex items-center justify-between w-full pr-2">
      <span className={cn('font-bold flex items-center gap-2', theme === 'dark' ? 'text-slate-100' : 'text-slate-900')}>
        <Sliders className="w-4 h-4 text-blue-400" />
        Pose Simulation Mode
      </span>
      <span className={cn('text-[10px]', theme === 'dark' ? 'text-slate-400' : 'text-slate-500')}>DevTool</span>
    </div>
  );

  const liquidButtonStyle =
    theme === 'dark'
      ? isFullscreen
        ? 'bg-slate-900/20 hover:bg-slate-800/50 border border-white/25 text-blue-400 backdrop-blur-xl shadow-[inset_0_1px_1px_rgba(255,255,255,0.4)]'
        : 'bg-slate-900/40 hover:bg-slate-800/70 border border-white/20 text-blue-400 backdrop-blur-xl shadow-[inset_0_1px_1px_rgba(255,255,255,0.3),_inset_0_-1px_1px_rgba(0,0,0,0.4)]'
      : isFullscreen
      ? 'bg-white/20 hover:bg-white/70 border border-white/70 text-blue-600 backdrop-blur-xl shadow-[inset_0_1px_1px_rgba(255,255,255,0.85)]'
      : 'bg-white/40 hover:bg-white/80 border border-white/60 text-blue-600 backdrop-blur-xl shadow-[inset_0_1px_1px_rgba(255,255,255,0.7),_inset_0_-1px_1px_rgba(0,0,0,0.1)]';

  const liquidInputStyle =
    theme === 'dark'
      ? isFullscreen
        ? 'bg-slate-900/25 border border-white/25 text-slate-100 backdrop-blur-xl shadow-[inset_0_1px_1px_rgba(255,255,255,0.35)]'
        : 'bg-slate-900/50 border border-white/20 text-slate-100 backdrop-blur-xl shadow-[inset_0_1px_1px_rgba(255,255,255,0.25)]'
      : isFullscreen
      ? 'bg-white/25 border border-white/70 text-slate-900 backdrop-blur-xl shadow-[inset_0_1px_1px_rgba(255,255,255,0.85)]'
      : 'bg-white/55 border border-white/60 text-slate-900 backdrop-blur-xl shadow-[inset_0_1px_1px_rgba(255,255,255,0.6)]';

  return (
    <DraggablePanel
      storageKey="face_ui_sim_sliders"
      title={title}
      icon={<Sliders className="w-5 h-5" />}
      theme={theme}
      isFullscreen={isFullscreen}
      defaultPosition={defaultPosition}
      className={cn('w-72', className)}
    >
      <div className="space-y-3">
        {/* Preset Quick Buttons */}
        <div className="space-y-1">
          <span className={cn('text-[10px] font-bold uppercase tracking-wider', theme === 'dark' ? 'text-slate-300' : 'text-slate-600')}>Quick Presets</span>
          <div className="flex flex-wrap gap-1">
            {['FRONT', 'LEFT', 'RIGHT', 'UP', 'DOWN', 'NO_FACE'].map((name) => (
              <button
                key={name}
                onClick={() => setPreset(name)}
                className={cn(
                  'px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all duration-200 cursor-pointer active:scale-95',
                  liquidButtonStyle
                )}
              >
                {name}
              </button>
            ))}
          </div>
        </div>

        {/* Presence Selection */}
        <div className="space-y-1">
          <span className={cn('text-[10px] font-bold uppercase tracking-wider', theme === 'dark' ? 'text-slate-300' : 'text-slate-600')}>Presence State</span>
          <select
            value={settings.presence}
            onChange={(e) => updateSetting('presence', e.target.value as FacePresenceState)}
            className={cn(
              'w-full rounded-xl px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-400/50 transition-all cursor-pointer',
              liquidInputStyle
            )}
          >
            <option value="SINGLE_FACE" className="bg-slate-900 text-slate-100">SINGLE_FACE (Hợp lệ)</option>
            <option value="NO_FACE" className="bg-slate-900 text-slate-100">NO_FACE (Không có mặt)</option>
            <option value="MULTIPLE_FACES" className="bg-slate-900 text-slate-100">MULTIPLE_FACES (Nhiều mặt)</option>
          </select>
        </div>

        {/* Sliders */}
        <div className={cn('space-y-3 pt-2.5 border-t', theme === 'dark' ? 'border-white/15' : 'border-white/40')}>
          {/* Yaw Slider */}
          <div className="space-y-1">
            <div className="flex justify-between text-[11px]">
              <span className={theme === 'dark' ? 'text-slate-300' : 'text-slate-600'}>Yaw (Xoay ngang):</span>
              <span className="font-bold text-blue-400 drop-shadow-[0_0_6px_rgba(96,165,250,0.4)]">{settings.yaw}°</span>
            </div>
            <input
              type="range"
              min="-90"
              max="90"
              value={settings.yaw}
              onChange={(e) => updateSetting('yaw', Number(e.target.value))}
              className="w-full h-1.5 bg-slate-950/60 rounded-lg appearance-none cursor-pointer accent-blue-400 shadow-inner"
            />
          </div>

          {/* Pitch Slider */}
          <div className="space-y-1">
            <div className="flex justify-between text-[11px]">
              <span className={theme === 'dark' ? 'text-slate-300' : 'text-slate-600'}>Pitch (Ngẩng/Cúi):</span>
              <span className="font-bold text-blue-400 drop-shadow-[0_0_6px_rgba(96,165,250,0.4)]">{settings.pitch}°</span>
            </div>
            <input
              type="range"
              min="-90"
              max="90"
              value={settings.pitch}
              onChange={(e) => updateSetting('pitch', Number(e.target.value))}
              className="w-full h-1.5 bg-slate-950/60 rounded-lg appearance-none cursor-pointer accent-blue-400 shadow-inner"
            />
          </div>

          {/* Roll Slider */}
          <div className="space-y-1">
            <div className="flex justify-between text-[11px]">
              <span className={theme === 'dark' ? 'text-slate-300' : 'text-slate-600'}>Roll (Nghiêng vai):</span>
              <span className="font-bold text-blue-400 drop-shadow-[0_0_6px_rgba(96,165,250,0.4)]">{settings.roll}°</span>
            </div>
            <input
              type="range"
              min="-90"
              max="90"
              value={settings.roll}
              onChange={(e) => updateSetting('roll', Number(e.target.value))}
              className="w-full h-1.5 bg-slate-950/60 rounded-lg appearance-none cursor-pointer accent-blue-400 shadow-inner"
            />
          </div>

          {/* Size Ratio */}
          <div className="space-y-1">
            <div className="flex justify-between text-[11px]">
              <span className={theme === 'dark' ? 'text-slate-300' : 'text-slate-600'}>Face Size Ratio:</span>
              <span className="font-bold text-emerald-400 drop-shadow-[0_0_6px_rgba(52,211,153,0.4)]">{settings.faceSizeRatio}</span>
            </div>
            <input
              type="range"
              min="0.05"
              max="0.95"
              step="0.05"
              value={settings.faceSizeRatio}
              onChange={(e) => updateSetting('faceSizeRatio', Number(e.target.value))}
              className="w-full h-1.5 bg-slate-950/60 rounded-lg appearance-none cursor-pointer accent-emerald-400 shadow-inner"
            />
          </div>
        </div>
      </div>
    </DraggablePanel>
  );
};
