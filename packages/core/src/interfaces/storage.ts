export interface StorageAdapter {
  type: 'sqlite' | 'indexeddb' | 'filesystem' | 'memory';
  initialize(): Promise<void>;
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
}

export interface ModelInfo {
  id: string;
  name: string;
  family: string;
  version: string;
  type: 'face-detection' | 'face-landmark' | 'face-embedding' | 'face-liveness';
  runtime: 'tflite-wasm' | 'onnx-wasm' | 'python-service';
  sizeBytes: number;
  sha256: string;
}

export interface InstalledModel extends ModelInfo {
  installedAt: number;
  localPath: string;
}

export interface ModelLoader {
  listAvailable(): Promise<ModelInfo[]>;
  listInstalled(): Promise<InstalledModel[]>;
  downloadModel(modelId: string, version: string, onProgress?: (percent: number) => void): Promise<InstalledModel>;
  deleteModel(modelId: string, version: string): Promise<void>;
  getModelPath(modelId: string, version: string): Promise<string>;
}
