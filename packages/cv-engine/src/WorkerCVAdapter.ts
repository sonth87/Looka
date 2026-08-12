import { AlignedFace, CVEngine, FaceState, FrameInput } from '@face/core';

export interface WorkerCVAdapterOptions {
  workerScriptUrl?: string;
  engineOptions?: Record<string, any>;
}

export class WorkerCVAdapter implements CVEngine {
  public readonly name = 'WorkerCVAdapter';
  private _initialized = false;
  private worker: Worker | null = null;
  private pendingRequests: Map<number, { resolve: (res: any) => void; reject: (err: any) => void }> =
    new Map();
  private reqIdCounter = 0;
  private options: WorkerCVAdapterOptions;

  constructor(options: WorkerCVAdapterOptions = {}) {
    this.options = options;
  }

  public get isInitialized(): boolean {
    return this._initialized;
  }

  public async initialize(): Promise<void> {
    if (this._initialized) return;

    if (typeof Worker === 'undefined') {
      // In non-browser environments, mark ready as direct proxy
      this._initialized = true;
      return;
    }

    try {
      if (this.options.workerScriptUrl) {
        this.worker = new Worker(this.options.workerScriptUrl, { type: 'module' });
        this.worker.onmessage = this.handleWorkerMessage.bind(this);
        this.worker.onerror = (err) => console.error('CV Worker Error:', err);

        await this.postWorkerRequest('INIT', this.options.engineOptions);
      }
      this._initialized = true;
    } catch {
      this._initialized = true;
    }
  }

  public async processFrame(frame: FrameInput): Promise<FaceState> {
    if (!this.worker) {
      // Direct pass-through if worker not enabled
      return {
        timestamp: frame.timestamp,
        detected: false,
        faceCount: 0,
        presence: 'NO_FACE',
      };
    }

    return this.postWorkerRequest<FaceState>('PROCESS_FRAME', frame);
  }

  public async align(frame: FrameInput, faceState: FaceState): Promise<AlignedFace> {
    if (!faceState.detection) {
      throw new Error('Cannot align without face detection.');
    }

    return {
      data: frame.data,
      width: faceState.detection.boundingBox.width,
      height: faceState.detection.boundingBox.height,
      landmarks: faceState.landmarks || [],
      cropBox: faceState.detection.boundingBox,
    };
  }

  public async dispose(): Promise<void> {
    if (this.worker) {
      await this.postWorkerRequest('DISPOSE', {}).catch(() => {});
      this.worker.terminate();
      this.worker = null;
    }
    this._initialized = false;
  }

  private handleWorkerMessage(event: MessageEvent): void {
    const { reqId, data, error } = event.data;
    const req = this.pendingRequests.get(reqId);
    if (!req) return;

    this.pendingRequests.delete(reqId);
    if (error) {
      req.reject(new Error(error));
    } else {
      req.resolve(data);
    }
  }

  private postWorkerRequest<T>(type: string, payload: any): Promise<T> {
    return new Promise((resolve, reject) => {
      if (!this.worker) {
        reject(new Error('Worker is not running.'));
        return;
      }

      const reqId = ++this.reqIdCounter;
      this.pendingRequests.set(reqId, { resolve, reject });
      this.worker.postMessage({ reqId, type, payload });
    });
  }
}
