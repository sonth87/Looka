import { FacePlatformError, ERROR_CODES } from '@face/core';

/** Lifecycle of a file on the server, mirrored locally for fast queries. */
export type FsFileStatus =
  | 'UPLOADING'
  | 'SCANNING'
  | 'SCAN_PENDING'
  | 'READY'
  | 'QUARANTINED'
  | 'FAILED';

export interface FsClientConfig {
  /** e.g. http://fs-core:8080 */
  baseUrl: string;
  /** App key issued at provisioning. Keep it out of the renderer and out of config files. */
  apiKey: string;
  /**
   * Bytes per chunk. Must not exceed the server's own chunk expectation.
   * Default 4 MiB, matching the service default.
   */
  chunkSize?: number;
  /**
   * Largest body the server accepts in a single request. Default 10 MiB.
   *
   * Full-resolution captures land at 8–12 MB, i.e. straddling this limit, so
   * raw photos always take the chunked path rather than deciding per file —
   * a size-dependent branch here fails on some images and not others.
   */
  directMaxBytes?: number;
  requestTimeoutMs?: number;
  /** Injected in tests. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

export interface UploadInput {
  /** Path relative to the app namespace, e.g. 'raw/2026/KIOSK-A1/sess_1/FRONT-1.jpg'. */
  virtualPath: string;
  data: Uint8Array;
  mimeType: string;
  /**
   * Stable across retries — derived from what is being uploaded, never random.
   * This is what stops a network retry from creating a second file.
   */
  idempotencyKey: string;
  /** Upload session id for the chunked path. Defaults to a hash of idempotencyKey. */
  uploadId?: string;
  tags?: string[];
  /** Key/value metadata. Must not carry personal data — see redactMetadata(). */
  metadata?: Record<string, string>;
}

export interface UploadResult {
  fileId: string;
  virtualPath: string;
  status: FsFileStatus;
  size: number;
  etag: string;
  version: number;
  dedupHit: boolean;
}

export interface FsFileInfo {
  fileId: string;
  virtualPath: string;
  status: FsFileStatus;
  size: number;
}

export interface DownloadLink {
  url: string;
  expiresAt: string;
}

export interface FsUsage {
  usedBytes: number;
  limitBytes: number | null;
}

/** Error carrying enough detail for the queue to decide between retry and stop. */
export class FsError extends FacePlatformError {
  public readonly httpStatus: number;

  constructor(httpStatus: number, code: string, message: string, details?: Record<string, unknown>) {
    super(code, message, 'NETWORK', false, { httpStatus, ...details });
    this.name = 'FsError';
    this.httpStatus = httpStatus;
    Object.setPrototypeOf(this, FsError.prototype);
  }

  /**
   * Whether trying again could plausibly succeed.
   *
   * Transport failures and server faults are worth repeating; a rejected request
   * will be rejected identically forever, and retrying it only delays the point
   * at which a human notices.
   */
  public get retryable(): boolean {
    return this.httpStatus === 0 || this.httpStatus === 429 || this.httpStatus >= 500;
  }
}

export const FS_ERROR_CODES = {
  NETWORK: 'FS_NETWORK',
  HTTP: 'FS_HTTP',
  UPLOAD_INCOMPLETE: ERROR_CODES.UPLOAD_INCOMPLETE,
  QUARANTINED: ERROR_CODES.FILE_QUARANTINED,
  SCAN_TIMEOUT: ERROR_CODES.SCAN_TIMEOUT,
} as const;
