import React from 'react';
import { CameraDevice } from '@face/core';
import { Camera } from 'lucide-react';
import { cn } from '../../lib/utils.js';

export interface CameraSelectorProps {
  devices: CameraDevice[];
  selectedDeviceId?: string;
  onSelectDevice: (deviceId: string) => void;
  disabled?: boolean;
  className?: string;
}

export const CameraSelector: React.FC<CameraSelectorProps> = ({
  devices,
  selectedDeviceId,
  onSelectDevice,
  disabled = false,
  className,
}) => {
  // If no devices or only 1 device, do not render floating error box
  if (!devices || devices.length <= 1) {
    return null;
  }

  return (
    <div className={cn('relative inline-flex items-center', className)}>
      <div className="absolute left-2.5 pointer-events-none text-blue-400">
        <Camera className="w-3.5 h-3.5" />
      </div>
      <select
        value={selectedDeviceId || ''}
        onChange={(e) => onSelectDevice(e.target.value)}
        disabled={disabled}
        className={cn(
          'appearance-none bg-slate-950/80 text-slate-200 text-xs pl-8 pr-7 py-1.5 rounded-full border border-slate-700/70 shadow-lg backdrop-blur-md focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all font-medium cursor-pointer'
        )}
      >
        {devices.map((device) => (
          <option key={device.id} value={device.id} className="bg-slate-900 text-slate-100">
            {device.label || `Camera (${device.id.slice(0, 6)})`}
          </option>
        ))}
      </select>
      <div className="pointer-events-none absolute right-2.5 text-slate-400">
        <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 20 20">
          <path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" />
        </svg>
      </div>
    </div>
  );
};
