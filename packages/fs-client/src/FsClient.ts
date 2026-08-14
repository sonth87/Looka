import { createHash } from 'node:crypto';
import {
  FsClientConfig,
  UploadInput,
  UploadResult,
  FsFileInfo,
  FsFileStatus,
  DownloadLink,
  FsUsage,
  FsError,
  FS_ERROR_CODES,
} from './types.js';

const MiB = 1024 * 1024;

/** sha256 of a byte range, as lowercase hex. */
export function sha256Hex(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

/**
 * A UUID derived from a key, so the same logical upload always resumes the same
 * server-side session — even after the app crashed and lost its memory of it.
 */
export function deterministicUuid(key: string): string {
  const h = createHash('sha256').update(key).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

/**
 * Encode metadata as `k=v;k=v`.
 *
 * Separators are stripped from values so a stray character cannot split one
 * field into two. Keys are restricted for the same reason.
 */
export function encodeMetadata(meta: Record<string, string>): string {
  return Object.entries(meta)
    .map(([k, v]) => `${k.replace(/[;=]/g, '_')}=${String(v).replace(/[;=]/g, '_')}`)
    .join(';');
}

/**
 * Client for the file-service.
 *
 * Two behaviours matter more than the rest:
 *
 *   - Raw photos always upload in chunks, never as a single request. Their size
 *     sits right at the server's single-request ceiling, so choosing per file
 *     would work for some images and fail for others.
 *
 *   - A completed upload is not a readable file. The server returns SCANNING and
 *     only reaches READY after its virus scan. Anything that downloads or links
 *     to the file must wait for that.
 */
export class FsClient {
  private readonly cfg: Required<Omit<FsClientConfig, 'fetchImpl'>> & { fetchImpl: typeof fetch };

  constructor(config: FsClientConfig) {
    this.cfg = {
      chunkSize: 4 * MiB,
      directMaxBytes: 10 * MiB,
      requestTimeoutMs: 60_000,
      fetchImpl: config.fetchImpl ?? globalThis.fetch,
      ...config,
    } as Required<Omit<FsClientConfig, 'fetchImpl'>> & { fetchImpl: typeof fetch };

    if (!this.cfg.fetchImpl) {
      throw new FsError(0, FS_ERROR_CODES.NETWORK, 'No fetch implementation available');
    }
  }

  // ── Upload ────────────────────────────────────────────────────────────────

  /** Full-resolution capture. Always chunked — see the class note. */
  public async uploadRaw(input: UploadInput): Promise<UploadResult> {
    return this.uploadChunked(input);
  }

  /** Small derived artefact (thumbnail, card photo). Single request. */
  public async uploadDirect(input: UploadInput): Promise<UploadResult> {
    const res = await this.request('/api/v1/files', {
      method: 'POST',
      headers: {
        ...this.uploadHeaders(input),
        'Content-Type': input.mimeType,
        'Content-Length': String(input.data.byteLength),
      },
      body: toBody(input.data),
    });
    return toUploadResult(await res.json());
  }

  /** Size-based choice. Only safe for artefacts comfortably below the ceiling. */
  public async upload(input: UploadInput): Promise<UploadResult> {
    return input.data.byteLength <= this.cfg.directMaxBytes
      ? this.uploadDirect(input)
      : this.uploadChunked(input);
  }

  /**
   * Chunked upload that resumes where a previous attempt stopped.
   *
   * Asks the server for its current offset first: after a dropped connection the
   * bytes it already accepted stay accepted, so a retry sends the remainder
   * instead of starting over.
   */
  public async uploadChunked(input: UploadInput): Promise<UploadResult> {
    const total = input.data.byteLength;
    const uploadId = input.uploadId ?? deterministicUuid(input.idempotencyKey);

    let offset = await this.probeOffset(uploadId, total, input);

    while (offset < total) {
      const end = Math.min(offset + this.cfg.chunkSize, total) - 1;
      const chunk = input.data.subarray(offset, end + 1);

      const res = await this.request('/api/v1/files', {
        method: 'POST',
        headers: {
          ...this.uploadHeaders(input),
          'X-Upload-ID': uploadId,
          'X-Content-Type': input.mimeType,
          'X-Chunk-SHA256': sha256Hex(chunk),
          'Content-Range': `bytes ${offset}-${end}/${total}`,
          'Content-Type': 'application/octet-stream',
        },
        body: toBody(chunk),
      });

      // 201 closes the file; anything else means the server wants more bytes.
      if (res.status === 201) return toUploadResult(await res.json());

      const reported = res.headers.get('Upload-Offset');
      const next = reported !== null ? Number(reported) : end + 1;

      // Guard against a response that would leave us looping forever.
      if (!Number.isFinite(next) || next <= offset) {
        throw new FsError(
          0,
          FS_ERROR_CODES.UPLOAD_INCOMPLETE,
          `Server did not advance the upload offset (was ${offset}, reported ${reported})`
        );
      }
      offset = next;
    }

    throw new FsError(
      0,
      FS_ERROR_CODES.UPLOAD_INCOMPLETE,
      'All bytes were sent but the server did not finalise the file'
    );
  }

  /** Ask how much the server already holds. A missing session simply starts at 0. */
  private async probeOffset(uploadId: string, total: number, input: UploadInput): Promise<number> {
    try {
      const res = await this.request('/api/v1/files', {
        method: 'POST',
        headers: {
          ...this.uploadHeaders(input),
          'X-Upload-ID': uploadId,
          'Content-Range': `bytes */${total}`,
        },
      });
      const reported = res.headers.get('Upload-Offset');
      const offset = reported !== null ? Number(reported) : 0;
      return Number.isFinite(offset) && offset >= 0 && offset <= total ? offset : 0;
    } catch (err) {
      if (err instanceof FsError && err.httpStatus === 404) return 0;
      throw err;
    }
  }

  // ── Read ──────────────────────────────────────────────────────────────────

  public async getFile(fileId: string): Promise<FsFileInfo> {
    const res = await this.request(`/api/v1/files/${encodeURIComponent(fileId)}`, { method: 'GET' });
    const body = (await res.json()) as Record<string, unknown>;
    return {
      fileId: String(body.file_id ?? fileId),
      virtualPath: String(body.virtual_path ?? ''),
      status: body.status as FsFileStatus,
      size: Number(body.size ?? 0),
    };
  }

  /**
   * Wait until the server has scanned the file and made it readable.
   *
   * Call this before issuing a link or downloading. A file that has only just
   * been uploaded is not yet retrievable, and treating 201 as "done" produces
   * failures that come and go with scan timing.
   */
  public async waitUntilReady(
    fileId: string,
    opts: { timeoutMs?: number; pollMs?: number; signal?: AbortSignal } = {}
  ): Promise<FsFileInfo> {
    const timeoutMs = opts.timeoutMs ?? 120_000;
    const pollMs = opts.pollMs ?? 3_000;
    const deadline = Date.now() + timeoutMs;

    for (;;) {
      const info = await this.getFile(fileId);
      if (info.status === 'READY') return info;

      if (info.status === 'QUARANTINED' || info.status === 'FAILED') {
        throw new FsError(0, FS_ERROR_CODES.QUARANTINED, `File ended in state ${info.status}`, {
          fileId,
          status: info.status,
        });
      }

      if (Date.now() >= deadline) {
        // SCAN_PENDING in particular does not resolve on its own on the server
        // side, so this is an operator-visible condition, not a slow path.
        throw new FsError(
          0,
          FS_ERROR_CODES.SCAN_TIMEOUT,
          `File still ${info.status} after ${Math.round(timeoutMs / 1000)}s`,
          { fileId, status: info.status }
        );
      }

      await delay(pollMs, opts.signal);
    }
  }

  public async issueDownloadLink(
    fileId: string,
    viewerId: string,
    ttlSeconds = 300
  ): Promise<DownloadLink> {
    const res = await this.request(
      `/api/v1/files/${encodeURIComponent(fileId)}/download-link?ttl_seconds=${ttlSeconds}`,
      { method: 'POST', headers: { 'X-Viewer-ID': viewerId } }
    );
    const body = (await res.json()) as { url: string; expires_at: string };
    return {
      url: new URL(body.url, this.cfg.baseUrl).toString(),
      expiresAt: body.expires_at,
    };
  }

  public async getUsage(): Promise<FsUsage> {
    const res = await this.request('/api/v1/usage', { method: 'GET' });
    const body = (await res.json()) as Record<string, unknown>;
    return {
      usedBytes: Number(body.used_bytes ?? 0),
      limitBytes: body.limit_bytes === null || body.limit_bytes === undefined
        ? null
        : Number(body.limit_bytes),
    };
  }

  /** Cheap reachability probe for the status panel. */
  public async ping(): Promise<boolean> {
    try {
      await this.request('/healthz', { method: 'GET' }, 5_000);
      return true;
    } catch {
      return false;
    }
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private uploadHeaders(input: UploadInput): Record<string, string> {
    const headers: Record<string, string> = {
      'X-Virtual-Path': input.virtualPath,
      'X-Content-SHA256': sha256Hex(input.data),
      'Idempotency-Key': input.idempotencyKey,
    };
    if (input.tags?.length) headers['X-Tags'] = input.tags.join(',');
    if (input.metadata) headers['X-Metadata'] = encodeMetadata(input.metadata);
    return headers;
  }

  private async request(path: string, init: RequestInit, timeoutMs?: number): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs ?? this.cfg.requestTimeoutMs);

    try {
      const res = await this.cfg.fetchImpl(new URL(path, this.cfg.baseUrl).toString(), {
        ...init,
        signal: controller.signal,
        headers: {
          'X-API-Key': this.cfg.apiKey,
          ...(init.headers as Record<string, string> | undefined),
        },
      });

      if (res.status >= 400) {
        const text = await res.text().catch(() => '');
        throw new FsError(
          res.status,
          FS_ERROR_CODES.HTTP,
          `file-service ${res.status}: ${text.slice(0, 300)}`
        );
      }
      return res;
    } catch (err) {
      if (err instanceof FsError) throw err;
      throw new FsError(0, FS_ERROR_CODES.NETWORK, (err as Error).message);
    } finally {
      clearTimeout(timer);
    }
  }
}

function toUploadResult(body: unknown): UploadResult {
  const b = body as Record<string, unknown>;
  return {
    fileId: String(b.file_id ?? ''),
    virtualPath: String(b.virtual_path ?? ''),
    status: b.status as FsFileStatus,
    size: Number(b.size ?? 0),
    etag: String(b.etag ?? ''),
    version: Number(b.version ?? 1),
    dedupHit: Boolean(b.dedup_hit),
  };
}

/**
 * A Uint8Array is a valid fetch body at runtime, but the DOM lib's BodyInit
 * union does not cover the generic form TypeScript infers for a subarray.
 * Casting keeps the zero-copy view instead of duplicating megabytes per chunk.
 */
function toBody(data: Uint8Array): BodyInit {
  return data as unknown as BodyInit;
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('aborted'));
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new Error('aborted'));
    });
  });
}
