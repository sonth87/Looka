import { FrameInput } from './cv.js';
import { GestureState } from '../types/face.js';

export interface GestureEngine {
  readonly name: string;
  readonly isInitialized: boolean;
  initialize(): Promise<void>;
  processFrame(frame: FrameInput): Promise<GestureState>;
  dispose(): Promise<void>;
}
