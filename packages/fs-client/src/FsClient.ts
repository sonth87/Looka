import { createHash } from 'node:crypto';
import {
  ProvisionResult,
  UpdateResult,
  FsVersion,
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
 *   - The single-request ceiling is an operator setting, not a constant. Rather
 *     than guessing it, an oversized upload is sent once, and the 400 that comes
 *     back states the limit and the chunk size the server wants; the client
 *     then repeats in chunks and remembers the figures for later uploads.
 *
 *   - A completed upload is not a readable file. The server returns SCANNING and
 *     only reaches READY after its virus scan. Anything that downloads or links
 *     to the file must wait for that.
 */
export class FsClient {
  private readonly cfg: Required<Omit<FsClientConfig, 'fetchImpl'>> & { fetchImpl: typeof fetch };

  constructor(config: FsClientConfig) {
    this.cfg = {
      // 32 MiB is the size the service documents as its preferred chunk.
      chunkSize: 32 * MiB,
      directMaxBytes: 2048 * MiB,
      requestTimeoutMs: 60_000,
      fetchImpl: config.fetchImpl ?? globalThis.fetch,
      ...config,
    } as Required<Omit<FsClientConfig, 'fetchImpl'>> & { fetchImpl: typeof fetch };

    if (!this.cfg.fetchImpl) {
      throw new FsError(0, FS_ERROR_CODES.NETWORK, 'No fetch implementation available');
    }
  }

  // ── Upload ────────────────────────────────────────────────────────────────

  /** Full-resolution capture. */
  public async uploadRaw(input: UploadInput): Promise<UploadResult> {
    return this.upload(input);
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

  /**
   * Send in one request when it fits, in chunks when it does not.
   *
   * The threshold is learned rather than assumed: a photo is a few hundred
   * kilobytes and chunking one costs an extra round trip for nothing, while a
   * hardcoded ceiling breaks silently the day an operator lowers it. If the
   * server rejects the size, it says what it will accept and the upload is
   * repeated in chunks at the size it asked for.
   */
  public async upload(input: UploadInput): Promise<UploadResult> {
    if (input.data.byteLength > this.cfg.directMaxBytes) {
      return this.uploadChunked(input);
    }

    try {
      return await this.uploadDirect(input);
    } catch (err) {
      const limits = err instanceof FsError ? err.uploadLimits : null;
      if (!limits) throw err;

      // Remember, so the next photo skips the rejected attempt entirely.
      this.cfg.directMaxBytes = limits.maxSingleRequest;
      this.cfg.chunkSize = limits.chunkSize;
      return this.uploadChunked(input);
    }
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

      // An allowlist of states that are still working, rather than a list of
      // known failures. The server reports states the integration guide does not
      // enumerate — a deleted file comes back TRASHED — and treating an
      // unrecognised state as "keep waiting" turned that into a silent stall for
      // the whole timeout instead of an immediate, accurate error.
      if (info.status !== 'UPLOADING' && info.status !== 'SCANNING' && info.status !== 'SCAN_PENDING') {
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

  /**
   * A URL a browser can load without the API key.
   *
   * The key covers the whole namespace, so it must never reach a page: anyone
   * holding it can read and write every file this service owns. Permission is
   * checked when the link is opened, not when it is issued, which is why a link
   * can be built before knowing whether the viewer is allowed to see it.
   *
   * `viewerId` identifies the person the check will run against — not this
   * service.
   */
  public async issueDownloadLink(
    fileId: string,
    viewerId: string,
    ttlSeconds = 300,
    allowDownload = true
  ): Promise<DownloadLink> {
    // The service caps this at an hour and defaults to ten minutes; asking for
    // more is rejected rather than silently trimmed.
    const ttl = Math.min(3600, Math.max(1, Math.floor(ttlSeconds)));

    const res = await this.request(
      `/api/v1/files/${encodeURIComponent(fileId)}/download-link` +
        `?ttl_seconds=${ttl}&allow_download=${allowDownload}`,
      { method: 'POST', headers: { 'X-Viewer-ID': viewerId } }
    );
    const body = (await res.json()) as {
      url: string;
      view_url?: string;
      expires_at: string;
      allow_download?: boolean;
    };
    return {
      url: new URL(body.url, this.cfg.baseUrl).toString(),
      viewUrl: body.view_url ? new URL(body.view_url, this.cfg.baseUrl).toString() : undefined,
      expiresAt: body.expires_at,
      allowDownload: body.allow_download,
    };
  }

  /**
   * Obtain the API key for a service, creating the tenant if it does not exist.
   *
   * Keyed by name and idempotent: calling again with the same tenant returns the
   * same key rather than minting a second one, so running it at startup is safe.
   * Static because it is the one call that happens before a key exists.
   */
  public static async provision(
    baseUrl: string,
    tenantName: string,
    opts: { contactEmail?: string; quotaBytes?: number; fetchImpl?: typeof fetch } = {}
  ): Promise<ProvisionResult> {
    const doFetch = opts.fetchImpl ?? globalThis.fetch;
    if (!doFetch) {
      throw new FsError(0, FS_ERROR_CODES.NETWORK, 'No fetch implementation available');
    }

    const res = await doFetch(new URL('/api/v1/self-service/provision', baseUrl).toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenant_name: tenantName,
        ...(opts.contactEmail ? { contact_email: opts.contactEmail } : {}),
        ...(opts.quotaBytes ? { quota_bytes: opts.quotaBytes } : {}),
      }),
    });

    if (res.status >= 400) {
      const text = await res.text().catch(() => '');
      // 403 here means the caller is outside the allowed source range, which is
      // a network placement problem rather than anything the code can retry.
      throw new FsError(res.status, FS_ERROR_CODES.HTTP, `provision ${res.status}: ${text.slice(0, 300)}`);
    }

    const body = (await res.json()) as Record<string, unknown>;
    const apiKey = String(body.api_key ?? '');
    if (!apiKey) {
      throw new FsError(0, FS_ERROR_CODES.HTTP, 'provision succeeded but returned no api_key');
    }
    return {
      apiKey,
      tenantName: String(body.tenant_name ?? tenantName),
      // The server calls it namespace_prefix; accept the shorter spelling too
      // in case a future version normalises it.
      namespace: body.namespace_prefix
        ? String(body.namespace_prefix)
        : body.namespace
        ? String(body.namespace)
        : undefined,
    };
  }

  /**
   * Fetch the bytes directly, using this service's own key.
   *
   * A share link is for handing to a browser. Reaching for one here would spend
   * a token and route through the public path for a call the service is already
   * authorised to make.
   *
   * `range` requests a byte range, which is what lets a player seek in a video
   * rather than pull the whole file first.
   */
  public async download(
    fileId: string,
    opts: { range?: { start: number; end?: number }; version?: number } = {}
  ): Promise<Uint8Array> {
    const headers: Record<string, string> = {};
    if (opts.range) {
      headers.Range = `bytes=${opts.range.start}-${opts.range.end ?? ''}`;
    }

    const path =
      opts.version === undefined
        ? `/api/v1/files/${encodeURIComponent(fileId)}/download`
        : `/api/v1/files/${encodeURIComponent(fileId)}/versions/${opts.version}/download`;

    const res = await this.request(path, { method: 'GET', headers });

    // 202 is not success. A file that has aged onto cold storage answers the
    // first read with a JSON notice saying it is being thawed, and treating any
    // sub-400 status as content hands that notice back as if it were the image.
    // Nothing fails; the bytes are simply wrong.
    if (res.status === 202) {
      let retryAfter = 10;
      try {
        const body = (await res.clone().json()) as { detail?: { retry_after?: number } };
        const stated = Number(body?.detail?.retry_after);
        if (Number.isFinite(stated) && stated > 0) retryAfter = stated;
      } catch {
        /* keep the default when the notice cannot be parsed */
      }
      throw new FsError(
        202,
        'THAWING',
        `File is being restored from cold storage; retry in ${retryAfter}s`,
        { fileId, retryAfter }
      );
    }

    return new Uint8Array(await res.arrayBuffer());
  }

  /**
   * Fetch bytes, waiting out a cold-storage thaw rather than failing on it.
   *
   * Restoration is a normal condition for a file nobody has touched in a while,
   * and the server states how long it wants before the next attempt.
   */
  public async downloadWhenWarm(
    fileId: string,
    opts: { version?: number; timeoutMs?: number; signal?: AbortSignal } = {}
  ): Promise<Uint8Array> {
    const deadline = Date.now() + (opts.timeoutMs ?? 120_000);

    for (;;) {
      try {
        return await this.download(fileId, { version: opts.version });
      } catch (err) {
        const thawing = err instanceof FsError && err.httpStatus === 202;
        if (!thawing || Date.now() >= deadline) throw err;

        const wait = Number((err.details as { retryAfter?: number } | undefined)?.retryAfter) || 10;
        await delay(Math.min(wait * 1000, deadline - Date.now()), opts.signal);
      }
    }
  }

  /**
   * Move the file to the trash.
   *
   * A soft delete: the file is recoverable and permanent removal is an
   * administrative action, so this is safe to call on a mistaken capture.
   */
  public async deleteFile(fileId: string): Promise<void> {
    await this.request(`/api/v1/files/${encodeURIComponent(fileId)}`, { method: 'DELETE' });
  }

  /**
   * Replace a file's content, creating a new version.
   *
   * `etag` must be the one currently held. The service refuses to guess: without
   * the condition it answers 428 rather than overwriting, because a caller that
   * forgot to state which version it was editing is the quietest way to lose
   * data — nothing errors and nobody learns the old content is gone.
   *
   * On a 409 the conflict carries the winning etag, so the caller can report
   * what happened without another round trip.
   */
  public async updateContent(
    fileId: string,
    input: { etag: string; data: Uint8Array; mimeType: string; comment?: string }
  ): Promise<UpdateResult> {
    const res = await this.request(`/api/v1/files/${encodeURIComponent(fileId)}`, {
      method: 'PUT',
      headers: {
        // Sent verbatim, quotes included — the service compares the whole token.
        'If-Match': input.etag,
        'Content-Type': input.mimeType,
        'Content-Length': String(input.data.byteLength),
        // Read before the body is touched, so identical content is recognised
        // without transferring it — and it is what lets the service answer
        // "unchanged" instead of storing a version that differs from its
        // predecessor in nothing at all.
        'X-Content-SHA256': sha256Hex(input.data),
        ...(input.comment ? { 'X-Comment': input.comment } : {}),
      },
      body: toBody(input.data),
    });

    const b = (await res.json()) as Record<string, unknown>;
    return {
      fileId: String(b.file_id ?? fileId),
      version: Number(b.version ?? 0),
      etag: String(b.etag ?? ''),
      size: Number(b.size ?? 0),
      dedupHit: Boolean(b.dedup_hit),
      // Present only when the bytes matched what was already stored: no version
      // was created, which is a no-op rather than a failure.
      unchanged: b.unchanged === true,
    };
  }

  /** Versions of a file, newest first, capped at 100 by the service. */
  public async listVersions(fileId: string): Promise<FsVersion[]> {
    const res = await this.request(`/api/v1/files/${encodeURIComponent(fileId)}/versions`, {
      method: 'GET',
    });
    const b = (await res.json()) as { items?: Array<Record<string, unknown>> };
    return (b.items ?? []).map((v) => ({
      version: Number(v.version_no ?? 0),
      etag: String(v.etag ?? ''),
      size: Number(v.size ?? 0),
      locked: Boolean(v.locked),
      createdAt: String(v.created_at ?? ''),
      comment: v.comment ? String(v.comment) : undefined,
    }));
  }

  /**
   * Restore an earlier version by copying it forward.
   *
   * The history in between is kept: it is what answers the question that
   * actually gets asked after a data incident — how long the wrong content was
   * live, and who read it.
   */
  public async rollback(fileId: string, version: number, etag: string): Promise<UpdateResult> {
    const res = await this.request(
      `/api/v1/files/${encodeURIComponent(fileId)}/versions/${version}/rollback`,
      { method: 'POST', headers: { 'If-Match': etag } }
    );
    const b = (await res.json()) as Record<string, unknown>;
    return {
      fileId: String(b.file_id ?? fileId),
      version: Number(b.version ?? 0),
      etag: String(b.etag ?? ''),
      size: Number(b.size ?? 0),
      dedupHit: false,
      unchanged: false,
      restoredFrom: b.restored_from === undefined ? undefined : Number(b.restored_from),
    };
  }

  /** Bring a file back out of the trash. */
  public async restore(fileId: string): Promise<FsFileStatus> {
    const res = await this.request(`/api/v1/files/${encodeURIComponent(fileId)}/restore`, {
      method: 'POST',
    });
    const b = (await res.json()) as { status?: string };
    return (b.status ?? 'READY') as FsFileStatus;
  }

  /**
   * Abandon a chunked session and release the quota it was holding.
   *
   * Without this a cancelled upload keeps its reservation until the session
   * expires on its own, which counts against the tenant in the meantime.
   */
  public async cancelUpload(uploadId: string): Promise<void> {
    await this.request('/api/v1/files', {
      method: 'DELETE',
      headers: { 'X-Upload-ID': uploadId },
    });
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

        // Every error comes back as { error: { code, message, detail } }, and
        // the code is what the service documents as the field to branch on.
        // Flattening it into a truncated string threw away both the code and
        // the detail — which is where an oversized upload is told the limit it
        // should have used.
        let code: string = FS_ERROR_CODES.HTTP;
        let message = text.slice(0, 300);
        let detail: unknown;
        let requestId: unknown;

        try {
          const body = JSON.parse(text) as {
            error?: { code?: string; message?: string; detail?: unknown; request_id?: unknown };
          };
          if (body?.error?.code) code = body.error.code;
          if (body?.error?.message) message = body.error.message;
          detail = body?.error?.detail;
          requestId = body?.error?.request_id;
        } catch {
          // Not JSON — a proxy or gateway spoke instead of the service.
        }

        throw new FsError(
          res.status,
          code,
          `file-service ${res.status} ${code}: ${message}`,
          { detail, requestId }
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
