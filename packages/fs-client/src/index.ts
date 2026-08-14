export { FsClient, sha256Hex, deterministicUuid, encodeMetadata } from './FsClient.js';
export { UploadWorker } from './UploadWorker.js';
export type {
  OutboxPort,
  OutboxJob,
  FileReader,
  UploadWorkerOptions,
  WorkerEvent,
} from './UploadWorker.js';
export { FsError, FS_ERROR_CODES } from './types.js';
export type {
  FsClientConfig,
  FsFileStatus,
  FsFileInfo,
  UploadInput,
  UploadResult,
  DownloadLink,
  FsUsage,
} from './types.js';
