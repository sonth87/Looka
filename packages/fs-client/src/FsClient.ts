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
  FS_SERVER_CODES,
} from './types.js';

const MiB = 1024 * 1024;

/** sha256 of a byte range, as lowercase hex. */
export function sha256Hex(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

/**
 * A UUID derived from a key, so the same logical upload always resumes the same
 * server-side session — even after the app crashed and lost its memory of it.
 *
 * Forces the version nibble to `4` and the variant nibble to `8-b` (2026-09-09
 * fix — a raw hash slice has no such guarantee, and apps/api's `@IsUUID()`
 * DTO validators reject anything that doesn't look like a real UUID: only
 * ~7.8% of raw SHA-256 slices happen to pass by chance, so roughly 92% of
 * kiosk photo uploads were permanently rejected with "photoId must be a
 * UUID" — see `AddDevicePhotoDto.photoId`). Every other nibble is still the
 * hash's own, so this stays fully deterministic and collision-resistant.
 */
export function deterministicUuid(key: string): string {
  const h = createHash('sha256').update(key).digest('hex');
  const variantNibble = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${variantNibble}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/**
 * @deprecated fs-core no longer accepts the `X-Metadata` header at all — a
 * request carrying it is rejected with `400 BAD_REQUEST` ("Header X-Metadata
 * không còn được hỗ trợ — gửi trong meta.metadata của multipart/form-data").
 * Metadata now travels as a plain JSON object in the multipart `meta` part,
 * which `FsClient` builds itself; nothing here calls this any more. Kept
 * exported only so an external caller that imported it does not break.
 *
 * Encode metadata as fs-core's (former) `X-Metadata` header value.
 *
 * Since fs-engine v0.2.10 (2026-09-09) this is `encodeURIComponent(JSON.stringify(obj))`
 * — a url-encoded, flat JSON object. The previous `k1=v1;k2=v2` string-join
 * format is no longer accepted: the server's `json.Unmarshal` fails on it and
 * the whole upload/patch is rejected with `400 BAD_REQUEST`, non-backward-compatibly.
 *
 * This function does not itself validate the server's constraints (integration
 * guide §3: ≤16 keys, key names `a-z0-9_` only ≤64 chars and never starting
 * with `_`/`fs.`, ≤1KB per value / ≤8KB total when JSON-encoded) — those are
 * enforced server-side and surface as a `BAD_REQUEST` from `request()` below.
 * Callers populating `metadata` should stick to lowercase snake_case keys.
 */
export function encodeMetadata(meta: Record<string, string>): string {
  return encodeURIComponent(JSON.stringify(meta));
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
      // 10 MiB matches the service's own documented default. Deliberately not
      // set higher: `upload()` below self-corrects from the 400 response if
      // the real operator-configured ceiling differs, so a conservative guess
      // costs at most one wasted round trip, while an inflated guess would
      // send an oversized body before ever learning the true limit.
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

  /** Full-resolution capture. */
  public async uploadRaw(input: UploadInput): Promise<UploadResult> {
    return this.upload(input);
  }

  /**
   * Small derived artefact (thumbnail, card photo). Single request.
   *
   * fs-core only accepts `multipart/form-data` here (2026-09-30 discovery —
   * the old `X-Virtual-Path`/`X-Content-SHA256`/`X-Visibility`/… headers are
   * rejected with 400 the moment any one of them is present): a leading
   * `meta` text part holding JSON, then the bytes as a `file` part. The
   * request `Content-Type` (with its boundary) and `Content-Length` are
   * produced by `fetch` from the `FormData` — setting either by hand would
   * break the boundary. `Idempotency-Key` stays a real header.
   */
  public async uploadDirect(input: UploadInput): Promise<UploadResult> {
    const res = await this.request('/api/v1/files', {
      method: 'POST',
      headers: { 'Idempotency-Key': input.idempotencyKey },
      body: multipartBody(
        {
          ...this.uploadMeta(input),
          // A non-empty file part must declare a size ≥ 1 (and never above the
          // request's Content-Length, which it cannot exceed: the multipart
          // envelope only adds bytes).
          ...(input.data.byteLength > 0 ? { size: input.data.byteLength } : {}),
        },
        { name: 'file', data: input.data, mimeType: input.mimeType, filename: fileNameOf(input.virtualPath) }
      ),
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

    let offset = await this.probeOffset(uploadId, total);

    while (offset < total) {
      const end = Math.min(offset + this.cfg.chunkSize, total) - 1;
      const chunk = input.data.subarray(offset, end + 1);

      // File attributes are read only from the chunk that OPENS the session
      // (offset 0); every later chunk needs just the session id, its range and
      // its own checksum. A resume at offset > 0 continues a session the server
      // already holds (it told us the offset), so it sends only the latter.
      const res = await this.request('/api/v1/files', {
        method: 'POST',
        body: multipartBody(
          {
            ...(offset === 0 ? this.uploadMeta(input) : {}),
            upload_id: uploadId,
            content_range: `bytes ${offset}-${end}/${total}`,
            chunk_sha256: sha256Hex(chunk),
          },
          { name: 'chunk', data: chunk, mimeType: input.mimeType, filename: fileNameOf(input.virtualPath) }
        ),
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

  /**
   * Ask how much the server already holds. A missing session simply starts at 0.
   * The question is a `meta`-only multipart request — just the session id and
   * a `content_range` of the form "bytes STAR/total" (no file attributes, no
   * bytes part).
   */
  private async probeOffset(uploadId: string, total: number): Promise<number> {
    try {
      const res = await this.request('/api/v1/files', {
        method: 'POST',
        body: multipartBody({ upload_id: uploadId, content_range: `bytes */${total}` }),
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

  /**
   * Current scan/lifecycle state for a file already accepted by the server.
   *
   * A file still being virus-scanned answers this with `423 SCAN_PENDING`
   * rather than `200` + a `status` field — confirmed live against the real
   * server (2026-09-09), and NOT what the integration guide's own example
   * flow (and this package's mock server, `mock-fs-core.mjs`) suggested,
   * which was a plain `200` for this metadata-only endpoint at every stage
   * and reserved the 423 for the byte-fetching `/download` route alone. Left
   * as a bare `throw`, this took down every caller that expects a normal
   * `FsFileInfo` back while a scan is in flight: `waitUntilReady`'s poll
   * loop below never got the chance to recognise "still working" and retry
   * (the throw happens before its own SCANNING/SCAN_PENDING allowlist check
   * ever runs), and apps/api's `UploadWorkerService.pollScans` — which calls
   * this directly, once per photo, every 3 seconds — caught the exception,
   * logged a warning, and left `photos.fs_status` frozen at whatever the
   * original upload response said, forever, even long after the real scan
   * had finished. A photo's status badge stuck on "SCANNING" with no route
   * back to READY was the direct, live-reproduced symptom of exactly this.
   *
   * Recovering the real state from the error rather than re-throwing is the
   * fix: the server's own error `detail` already carries the file's current
   * status (see `mock-fs-core.mjs`'s `NOT_READY` envelope, `{ status:
   * f.status }`) even on this real deployment's differently-shaped 423, so
   * a `SCAN_PENDING`-coded failure is translated back into an ordinary
   * `FsFileInfo` instead of propagating. Any OTHER error (network failure,
   * a genuine 404 for a file that no longer exists, a hard quarantine)
   * still throws — those are not "still working" states, and a caller like
   * `pollScans` needs to see them to mark a photo as failed rather than
   * silently stuck.
   */
  public async getFile(fileId: string): Promise<FsFileInfo> {
    try {
      const res = await this.request(`/api/v1/files/${encodeURIComponent(fileId)}`, { method: 'GET' });
      const body = (await res.json()) as Record<string, unknown>;
      return {
        fileId: String(body.file_id ?? fileId),
        virtualPath: String(body.virtual_path ?? ''),
        status: body.status as FsFileStatus,
        size: Number(body.size ?? 0),
      };
    } catch (err) {
      if (err instanceof FsError && err.code === FS_SERVER_CODES.SCAN_PENDING) {
        const detail = err.details?.detail as { status?: string } | undefined;
        return {
          fileId,
          virtualPath: '',
          status: (detail?.status as FsFileStatus) ?? 'SCAN_PENDING',
          size: 0,
        };
      }
      throw err;
    }
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
      // Sent verbatim, quotes included — the service compares the whole token.
      // `If-Match` is the one condition that stays a real header (it is
      // required on EVERY request of a PUT, including each chunk).
      headers: { 'If-Match': input.etag },
      // Same multipart contract as POST (2026-09-30): `meta` first, then the
      // bytes. The content hash is declared up front so identical content is
      // recognised without transferring it — it is what lets the service
      // answer "unchanged" instead of storing a version that differs from its
      // predecessor in nothing at all. `X-Comment`/`X-Content-SHA256` headers
      // are rejected with 400; both now live in `meta`.
      body: multipartBody(
        {
          content_type: input.mimeType,
          sha256: sha256Hex(input.data),
          ...(input.data.byteLength > 0 ? { size: input.data.byteLength } : {}),
          ...(input.comment ? { comment: input.comment } : {}),
        },
        { name: 'file', data: input.data, mimeType: input.mimeType, filename: 'content' }
      ),
    });

    const b = (await res.json()) as Record<string, unknown>;
    return {
      fileId: String(b.file_id ?? fileId),
      version: Number(b.version ?? 0),
      etag: String(b.etag ?? ''),
      size: Number(b.size ?? 0),
      dedupHit: Boolean(b.dedup_hit),
      snapshot: Boolean(b.snapshot),
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
      // Not confirmed in the curl example for this endpoint (rollback/restore
      // are not among the response fields shown there); read it defensively
      // rather than assume a value the spec did not state for this call.
      snapshot: Boolean(b.snapshot),
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

  /**
   * The file's attributes for fs-core's `meta` part. Only read on a whole-file
   * upload or on the chunk that opens a chunked session. fs-core rejects any
   * field it does not know (400 with `detail.field`), so this lists exactly the
   * documented ones (`UploadMeta` in fs-core's openapi.yaml) and nothing more.
   */
  private uploadMeta(input: UploadInput): Record<string, unknown> {
    const meta: Record<string, unknown> = {
      virtual_path: input.virtualPath,
      content_type: input.mimeType,
      // Hash of the WHOLE file, also for a chunked upload: the server checks
      // it when the session closes (mismatch → 460).
      sha256: sha256Hex(input.data),
    };
    if (input.tags?.length) meta.tags = input.tags;
    // A plain JSON object now — no URL-encoding (that was the X-Metadata header).
    if (input.metadata) meta.metadata = input.metadata;
    if (input.visibility) meta.visibility = input.visibility;
    return meta;
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
    // Known gap (2026-09-24, low impact — nothing in this codebase reads
    // UploadResult.visibility today): fs-core can also return 'department'
    // for a file whose file_type_rule sets force_visibility, or one
    // uploaded with meta.visibility: department + an org unit. The shared
    // `Visibility` type (@face/core) is only 'public' | 'private', so a
    // 'department' response is reported here as 'public' rather than
    // widening that type across the whole monorepo for a value nothing
    // consumes yet. Revisit together with adding a real 'department'
    // consumer, not in isolation.
    visibility: b.visibility === 'private' ? 'private' : 'public',
  };
}

/**
 * The `multipart/form-data` body fs-core requires on `POST /api/v1/files` and
 * `PUT /api/v1/files/{id}`: a `meta` text part holding JSON — ALWAYS FIRST
 * (the server rejects a request whose first part is not `meta`) — then at most
 * one bytes part, named `file` (whole file) or `chunk` (one chunk). A request
 * that only asks a question (declare-a-hash, ask-for-offset) sends `meta` alone.
 *
 * Append order is the wire order, so `meta` is appended before anything else.
 * The part's `Content-Type` is the server's fallback MIME when `meta` omits
 * `content_type`; its filename is the fallback path when `meta` omits
 * `virtual_path` (and must be non-empty, or an empty-looking part is treated
 * as "not sent").
 */
function multipartBody(
  meta: Record<string, unknown>,
  bytes?: { name: 'file' | 'chunk'; data: Uint8Array; mimeType: string; filename: string }
): FormData {
  const form = new FormData();
  form.append('meta', JSON.stringify(meta));
  if (bytes) {
    // A Uint8Array is a valid Blob source at runtime, but TypeScript's
    // BlobPart union does not cover the generic form it infers for a subarray.
    form.append(bytes.name, new Blob([bytes.data as unknown as BlobPart], { type: bytes.mimeType }), bytes.filename);
  }
  return form;
}

/** Last path segment of a virtual path — used only as the multipart part's filename (fs-core's fallback path; `meta.virtual_path` is what actually names the file). */
function fileNameOf(virtualPath: string): string {
  return virtualPath.split('/').filter(Boolean).pop() ?? 'file';
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
