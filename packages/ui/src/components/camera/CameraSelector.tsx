import React from 'react';
import { CameraDevice } from '@face/core';
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
  if (devices.length === 0) {
    return (
      <div
        className={cn(
          'text-xs text-slate-400 bg-slate-900/60 px-3 py-2 rounded-lg border border-slate-800',
          className
        )}
      >
        Không tìm thấy camera khả dụng
      </div>
    );
  }

  return (
    <div className={cn('relative inline-block w-full max-w-xs', className)}>
      <select
        value={selectedDeviceId || ''}
        onChange={(e) => onSelectDevice(e.target.value)}
        disabled={disabled}
        className={cn(
          'w-full appearance-none bg-slate-900 text-slate-100 text-sm px-3.5 py-2.5 pr-8 rounded-xl border border-slate-700/80 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed transition-all'
        )}
      >
        {devices.map((device) => (
          <option key={device.id} value={device.id}>
            {device.label || `Camera (${device.id.slice(0, 8)})`}
          </option>
        ))}
      </select>
      <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2.5 text-slate-400">
        <svg className="w-4 h-4 fill-current" viewBox="0 0 20 20">
          <path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" />
        </svg>
      </div>
    </div>
  );
};
