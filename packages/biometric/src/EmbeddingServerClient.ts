import { FacePlatformError } from '@face/core';

/**
 * Typed client for the external "Attendance — Face Enrollment API"
 * (`http://10.20.107.17:8000`, spec `GET /openapi.json`) — see
 * docs/plans/face-embedding-server-integration-plan.md §4 for the full
 * design and §1 for a summary of the server's own behaviour.
 *
 * The server does everything itself: it accepts a portrait image, extracts
 * the embedding, stores it, and answers similarity searches — this client
 * never sees a vector, and neither does anything above it (see the plan's
 * §3 architecture decision for why the local database only ever stores a
 * *reference* to what the server has, never the embedding itself).
 */
export interface EmbeddingServerConfig {
  /** e.g. http://10.20.107.17:8000 — from EMBEDDING_SERVER_BASE_URL, same optional-override pattern as AI_SERVICE_BASE_URL in apps/desktop's aiService.ts. */
  baseUrl: string;
  /**
   * Default 8000ms. The server documents ~0.3-0.5s per enrollment; a search
   * scales with the number of faces in the query image. Generous enough that
   * a normal call never trips it, short enough that a dead server never
   * stalls a whole capture step.
   */
  timeoutMs?: number;
  /** Injected in tests. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

export interface EnrollFaceResult {
  userCode: string;
  /**
   * Null only in the pathological case where the server's own response omits
   * it (the schema marks this field optional) — every real `201` observed so
   * far (including a live-confirmed call against the real server) always
   * carries a concrete id. Still handled as nullable here rather than
   * asserted non-null, matching the server's own `EnrollResponse` schema
   * (`embedding_id` is `anyOf[integer, null]`, not required).
   */
  embeddingId: number | null;
  /** The filename the server recorded for this upload — not a real path, just what was sent as the multipart filename. */
  sourceImagePath: string;
}

export interface EnrolledFace {
  id: number;
  sourceImagePath: string;
  /** ISO 8601 with offset, as the server sends it — not reparsed into a number here since nothing currently needs to sort/compare it locally. */
  createdAt: string;
}

export interface ListFacesResult {
  userCode: string;
  count: number;
  /** Newest first, per the server's own documented ordering. */
  images: EnrolledFace[];
}

export interface DeleteFacesResult {
  userCode: string;
  /** How many rows were actually removed — 0 is a normal, valid outcome (nothing registered, or an unknown embeddingId for deleteFace), never an error on its own. */
  deleted: number;
}

export interface HealthResult {
  ok: boolean;
  /** false means the server is still starting and cannot process images yet — see aiService.ts's pingAiService for the same "preflight before a session" idea applied to the sidecar. */
  modelsLoaded: boolean;
}

export interface SearchMatch {
  userCode: string;
  /** -1 to 1; closer to 1 is more similar. */
  similarity: number;
  embeddingId: number;
  sourceImagePath: string;
}

export interface SearchFaceResult {
  /** [x1, y1, x2, y2] in the query image, pixels. */
  bbox: [number, number, number, number];
  /** Short edge of the detected face, pixels — the server's own basis for "too small to trust." */
  faceSizePx: number;
  /** false means the face looks like a photo of a photo/screen — a warning, never a reason the server itself drops the result. */
  isLive: boolean;
  /** Sorted by similarity, descending. Empty when nobody clears minSimilarity. */
  matches: SearchMatch[];
}

/**
 * Discriminated by the server's own documented error shape for
 * `POST /users/{user_code}/faces` (§1/§4 of the plan; §6 for the UI copy
 * that reacts to each). `NETWORK_ERROR` also covers an unexpected/5xx
 * response — nothing in the documented contract distinguishes "server is
 * down" from "server errored on this request" in a way that changes what a
 * caller should do (retry later), so both collapse to the one retryable kind.
 */
export type EnrollFaceError =
  | { kind: 'EMPTY_OR_UNREADABLE' } // 400 — empty/unreadable file
  | { kind: 'DUPLICATE_IDENTITY'; conflictUserCode: string; conflictSimilarity: number } // 409
  | { kind: 'FILE_TOO_LARGE' } // 413
  | { kind: 'IMAGE_REJECTED'; detail: string } // 422 — no face / >1 face / <112px / screen-capture
  | { kind: 'NETWORK_ERROR'; cause: unknown };

/**
 * Every error kind this client can throw, across every method — a superset
 * of {@link EnrollFaceError}. `NOT_FOUND` (404) only ever occurs from
 * `deleteFace()` (an unknown `embeddingId`); `enrollFace()` never receives it
 * per the server's own documented status codes for that endpoint (confirmed
 * against the live `/openapi.json`), so code that only calls `enrollFace()`
 * can safely narrow `EmbeddingServerError.detail` to {@link EnrollFaceError}.
 */
export type EmbeddingClientError = EnrollFaceError | { kind: 'NOT_FOUND' };

const EMBEDDING_ERROR_CODES: Record<EmbeddingClientError['kind'], string> = {
  EMPTY_OR_UNREADABLE: 'EMBEDDING_EMPTY_OR_UNREADABLE',
  DUPLICATE_IDENTITY: 'EMBEDDING_DUPLICATE_IDENTITY',
  FILE_TOO_LARGE: 'EMBEDDING_FILE_TOO_LARGE',
  IMAGE_REJECTED: 'EMBEDDING_IMAGE_REJECTED',
  NETWORK_ERROR: 'EMBEDDING_NETWORK_ERROR',
  NOT_FOUND: 'EMBEDDING_NOT_FOUND',
};

/**
 * Error carrying enough detail for a caller (the retry queue, the UI) to
 * decide what to do — same shape of idea as `@face/fs-client`'s `FsError`,
 * narrowed to this server's own documented error contract instead of
 * fs-core's.
 */
export class EmbeddingServerError extends FacePlatformError {
  public readonly httpStatus: number;
  public readonly detail: EmbeddingClientError;

  constructor(httpStatus: number, detail: EmbeddingClientError, message: string) {
    super(EMBEDDING_ERROR_CODES[detail.kind], message, 'NETWORK', false, { httpStatus, detail });
    this.name = 'EmbeddingServerError';
    this.httpStatus = httpStatus;
    this.detail = detail;
    Object.setPrototypeOf(this, EmbeddingServerError.prototype);
  }

  /**
   * Whether a background retry could plausibly succeed later.
   *
   * Only a transport failure or an unexpected/server-side status is —
   * everything else (400/409/413/422) is the server rejecting these exact
   * bytes for a reason that will not change on its own, so retrying it
   * automatically would just repeat the same rejection forever. See the
   * plan's §5.1 last bullet and §6's "Mất mạng" row.
   */
  public get retryable(): boolean {
    return this.detail.kind === 'NETWORK_ERROR';
  }
}

interface RawErrorBody {
  detail?: string;
  conflict_user_code?: string;
  conflict_similarity?: number;
}

function networkErrorMessage(cause: unknown): string {
  const raw = cause instanceof Error ? cause.message : String(cause);
  return `Không kết nối được máy chủ nhận diện khuôn mặt: ${raw}`;
}

export class EmbeddingServerClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(config: EmbeddingServerConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.timeoutMs = config.timeoutMs ?? 8_000;
    this.fetchImpl = config.fetchImpl ?? globalThis.fetch;
  }

  /**
   * Preflight before a capture session — same idea as `pingAiService()` for
   * the Python sidecar. Never throws: an unreachable/erroring server just
   * reports `ok: false`, since the only thing a caller ever does with this
   * is decide whether to warn the operator before starting.
   */
  public async health(): Promise<HealthResult> {
    try {
      const res = await this.fetchImpl(`${this.baseUrl}/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!res.ok) return { ok: false, modelsLoaded: false };
      const body = (await res.json()) as { status?: string; models_loaded?: boolean };
      return { ok: body.status === 'ok', modelsLoaded: body.models_loaded === true };
    } catch {
      return { ok: false, modelsLoaded: false };
    }
  }

  /**
   * Registers one face image under `userCode`. Synchronous on the server's
   * side — a `201` means the image is already saved and searchable, per the
   * plan's §1 ("`201` nghĩa là ảnh đã lưu xong").
   *
   * Callers enrolling several images for one session (the plan's original
   * 5-step idea, narrowed for now to just the CENTER step — see the
   * integration task's own scope note) must call this sequentially, never
   * with `Promise.all`: the server documents itself as synchronous and asks
   * for a low concurrency ceiling on batch registration.
   *
   * Throws {@link EmbeddingServerError} with `detail` typed as
   * {@link EnrollFaceError} on any failure — never returns an error value,
   * matching the plan's §4 interface.
   */
  public async enrollFace(userCode: string, imageBlob: Blob, fileName: string): Promise<EnrollFaceResult> {
    const form = new FormData();
    form.append('image', imageBlob, fileName);

    const res = await this.send(`/users/${encodeURIComponent(userCode)}/faces`, {
      method: 'POST',
      body: form,
    });

    if (res.status !== 201) throw await this.errorFromResponse(res);

    const body = (await res.json()) as {
      user_code: string;
      embedding_id: number | null;
      source_image_path: string;
    };
    return {
      userCode: body.user_code,
      embeddingId: body.embedding_id ?? null,
      sourceImagePath: body.source_image_path,
    };
  }

  /** Every image currently registered for `userCode`, newest first. An unknown/never-used code is not an error — it comes back as an empty list. */
  public async listFaces(userCode: string): Promise<ListFacesResult> {
    const res = await this.send(`/users/${encodeURIComponent(userCode)}/faces`, { method: 'GET' });
    if (res.status !== 200) throw await this.errorFromResponse(res);

    const body = (await res.json()) as {
      user_code: string;
      count: number;
      images: Array<{ id: number; source_image_path: string; created_at: string }>;
    };
    return {
      userCode: body.user_code,
      count: body.count,
      images: body.images.map((img) => ({
        id: img.id,
        sourceImagePath: img.source_image_path,
        createdAt: img.created_at,
      })),
    };
  }

  /** Deletes one registered image. `deleted: 0` (never thrown) would be surprising here since a 404 is what the server sends for an unknown `embeddingId` — surfaced as `EmbeddingServerError` with `detail.kind === 'NOT_FOUND'`. */
  public async deleteFace(userCode: string, embeddingId: number): Promise<DeleteFacesResult> {
    const res = await this.send(`/users/${encodeURIComponent(userCode)}/faces/${embeddingId}`, {
      method: 'DELETE',
    });
    if (res.status !== 200) throw await this.errorFromResponse(res);
    const body = (await res.json()) as { user_code: string; deleted: number };
    return { userCode: body.user_code, deleted: body.deleted };
  }

  /** Deletes every image registered for `userCode`. `deleted: 0` is a normal outcome (nothing registered), not an error — the server never 404s this call. */
  public async deleteAllFaces(userCode: string): Promise<DeleteFacesResult> {
    const res = await this.send(`/users/${encodeURIComponent(userCode)}/faces`, { method: 'DELETE' });
    if (res.status !== 200) throw await this.errorFromResponse(res);
    const body = (await res.json()) as { user_code: string; deleted: number };
    return { userCode: body.user_code, deleted: body.deleted };
  }

  /**
   * Looks up who a face belongs to — the recognition/attendance flow's own
   * entry point (plan §5.2), not wired to anything yet: this method exists
   * because it is part of the server's documented contract (and this
   * client's own §4 design), but the caller that will actually use it
   * (`apps/desktop/src/main/attendance.ts`) is a separate, later task. Kept
   * here rather than split into its own client so every method sees the same
   * base URL/timeout/error handling.
   */
  public async search(
    imageBlob: Blob,
    opts?: { limit?: number; minSimilarity?: number }
  ): Promise<SearchFaceResult[]> {
    const form = new FormData();
    form.append('image', imageBlob, 'query.jpg');

    const params = new URLSearchParams();
    if (opts?.limit !== undefined) params.set('limit', String(opts.limit));
    if (opts?.minSimilarity !== undefined) params.set('min_similarity', String(opts.minSimilarity));
    const qs = params.toString();

    const res = await this.send(`/search${qs ? `?${qs}` : ''}`, { method: 'POST', body: form });
    if (res.status !== 200) throw await this.errorFromResponse(res);

    const body = (await res.json()) as {
      faces: Array<{
        bbox: [number, number, number, number];
        face_size_px: number;
        is_live: boolean;
        matches: Array<{ user_code: string; similarity: number; embedding_id: number; source_image_path: string }>;
      }>;
    };
    return body.faces.map((f) => ({
      bbox: f.bbox,
      faceSizePx: f.face_size_px,
      isLive: f.is_live,
      matches: f.matches.map((m) => ({
        userCode: m.user_code,
        similarity: m.similarity,
        embeddingId: m.embedding_id,
        sourceImagePath: m.source_image_path,
      })),
    }));
  }

  /** Sends the request, translating a transport failure/timeout into a retryable {@link EmbeddingServerError} rather than letting `fetch`'s own rejection propagate untyped. */
  private async send(path: string, init: RequestInit): Promise<Response> {
    try {
      return await this.fetchImpl(`${this.baseUrl}${path}`, {
        ...init,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (cause) {
      throw new EmbeddingServerError(0, { kind: 'NETWORK_ERROR', cause }, networkErrorMessage(cause));
    }
  }

  /**
   * Maps a non-2xx response to a typed {@link EmbeddingServerError}, per the
   * server's documented `{"detail": "..."}` error shape (409 additionally
   * carries `conflict_user_code`/`conflict_similarity` — see
   * `DuplicateIdentityError` in the server's own `/openapi.json`). Live-
   * confirmed against the real server for 400 empty-file*, 409 duplicate,
   * 422 no-face, and 404 unknown-embedding-id.
   *
   * *the live empty-file probe itself did not get a clean response (curl
   * could not send a genuinely empty multipart part), so 400 specifically
   * is mapped from the documented contract rather than independently
   * observed — every other branch here was exercised against the real
   * server during this task's verification pass.
   */
  private async errorFromResponse(res: Response): Promise<EmbeddingServerError> {
    const body = (await res.json().catch(() => ({}))) as RawErrorBody;
    const message = body.detail ?? `HTTP ${res.status}`;

    switch (res.status) {
      case 400:
        return new EmbeddingServerError(400, { kind: 'EMPTY_OR_UNREADABLE' }, message);
      case 404:
        return new EmbeddingServerError(404, { kind: 'NOT_FOUND' }, message);
      case 409:
        return new EmbeddingServerError(
          409,
          {
            kind: 'DUPLICATE_IDENTITY',
            conflictUserCode: body.conflict_user_code ?? '',
            conflictSimilarity: typeof body.conflict_similarity === 'number' ? body.conflict_similarity : 0,
          },
          message
        );
      case 413:
        return new EmbeddingServerError(413, { kind: 'FILE_TOO_LARGE' }, message);
      case 422:
        return new EmbeddingServerError(422, { kind: 'IMAGE_REJECTED', detail: message }, message);
      default:
        // An unexpected/5xx status is treated the same as a transport
        // failure: nothing in the documented contract says a caller should
        // react to it any differently than "try again later" (see
        // EmbeddingServerError.retryable's own doc comment).
        return new EmbeddingServerError(res.status, { kind: 'NETWORK_ERROR', cause: message }, message);
    }
  }
}
