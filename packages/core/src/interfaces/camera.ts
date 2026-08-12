import { FrameInput } from './cv.js';

export interface CameraDevice {
  id: string;
  label: string;
  groupId?: string;
  isDefault?: boolean;
}

export interface CameraConstraints {
  deviceId?: string;
  width?: { ideal?: number; min?: number; max?: number };
  height?: { ideal?: number; min?: number; max?: number };
  frameRate?: { ideal?: number; max?: number };
}

export interface CameraService {
  enumerateDevices(): Promise<CameraDevice[]>;
  requestPermission(): Promise<boolean>;
  start(constraints?: CameraConstraints): Promise<MediaStream>;
  stop(): Promise<void>;
  pause(): void;
  resume(): void;
  getFrame(): FrameInput | null;
  getSelectedDevice(): CameraDevice | null;
  on(event: 'device-change' | 'disconnect' | 'error', listener: (...args: any[]) => void): void;
  off(event: string, listener: (...args: any[]) => void): void;
}
