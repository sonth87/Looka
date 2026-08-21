import { FacePlatformError, ERROR_CODES } from '@face/core';

/** Lifecycle of a file on the server, mirrored locally for fast queries. */
/**
 * States the service reports for a file.
 *
 * TRASHED is not in the integration guide's table but comes back from a real
 * server after a delete, so the union stays open: a state nobody anticipated
 * must be visible as itself rather than forced into a known one.
 */
export type FsFileStatus =
  | 'UPLOADING'
  | 'SCANNING'
  | 'SCAN_PENDING'
  | 'READY'
  | 'QUARANTINED'
  | 'FAILED'
  | 'TRASHED'
  | (string & {});

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
  /** Page a browser can open directly; the plain url is the raw byte stream. */
  viewUrl?: string;
  expiresAt: string;
  allowDownload?: boolean;
}

/** Outcome of writing new content over an existing file. */
export interface UpdateResult {
  fileId: string;
  version: number;
  etag: string;
  size: number;
  dedupHit: boolean;
  /** True when the bytes matched the current version and nothing was created. */
  unchanged: boolean;
  /** Set by a rollback: which version the content was copied from. */
  restoredFrom?: number;
}

export interface FsVersion {
  version: number;
  etag: string;
  size: number;
  /** Held by a legal or retention rule; cannot be removed. */
  locked: boolean;
  createdAt: string;
  comment?: string;
}

/** Credentials handed back by the self-service provisioning endpoint. */
export interface ProvisionResult {
  apiKey: string;
  tenantName: string;
  namespace?: string;
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
    // The integration guide is explicit: repeat only transport failures and
    // server faults. A 4xx is the caller's mistake and will be rejected
    // identically forever — 429 is the one exception, where the server is
    // asking for a slower pace rather than refusing the request.
    return this.httpStatus === 0 || this.httpStatus === 429 || this.httpStatus >= 500;
  }

  /**
   * Whether the chunked session is gone and must be reopened from zero.
   *
   * Distinct from a plain retry: reusing the same X-Upload-ID would keep hitting
   * the same expired session, so the caller has to mint a new one.
   */
  public get needsNewSession(): boolean {
    return this.httpStatus === 410;
  }

  /**
   * Server-declared limits, present when a single-request upload was refused
   * for being too large.
   *
   * The ceiling is an operator setting, so the guide warns against hardcoding
   * it — the server states the value it wants alongside the rejection.
   */
  public get uploadLimits(): { maxSingleRequest: number; chunkSize: number } | null {
    const detail = (this.details as Record<string, unknown> | undefined)?.detail as
      | Record<string, unknown>
      | undefined;
    const max = Number(detail?.max_single_request);
    const chunk = Number(detail?.chunk_size);
    if (!Number.isFinite(max) || max <= 0) return null;
    return {
      maxSingleRequest: max,
      chunkSize: Number.isFinite(chunk) && chunk > 0 ? chunk : Math.floor(max / 2),
    };
  }
}

export const FS_ERROR_CODES = {
  NETWORK: 'FS_NETWORK',
  HTTP: 'FS_HTTP',
  UPLOAD_INCOMPLETE: ERROR_CODES.UPLOAD_INCOMPLETE,
  QUARANTINED: ERROR_CODES.FILE_QUARANTINED,
  SCAN_TIMEOUT: ERROR_CODES.SCAN_TIMEOUT,
} as const;

/**
 * Codes the server puts in `error.code`, which the guide names as the field to
 * branch on. Kept as the server spells them so a log line can be matched
 * against the documentation without translation.
 */
export const FS_SERVER_CODES = {
  BAD_REQUEST: 'BAD_REQUEST',
  TOKEN_INVALID: 'TOKEN_INVALID',
  ACL_DENIED: 'ACL_DENIED',
  NOT_FOUND: 'NOT_FOUND',
  ALREADY_REGISTERED: 'ALREADY_REGISTERED',
  VERSION_CONFLICT: 'VERSION_CONFLICT',
  STATE_CHANGED: 'STATE_CHANGED',
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',
  FILE_QUARANTINED: 'FILE_QUARANTINED',
  PRECONDITION_REQUIRED: 'PRECONDITION_REQUIRED',
  RATE_LIMITED: 'RATE_LIMITED',
  CHUNK_CHECKSUM_MISMATCH: 'CHUNK_CHECKSUM_MISMATCH',
  INSUFFICIENT_STORAGE: 'INSUFFICIENT_STORAGE',
} as const;
