import { Injectable, Logger } from '@nestjs/common';
import { SIDECAR_TIMEOUT_MS } from '../photo-review.constants';

/** No longer env-configurable — see this class's own doc comment. */
const SIDECAR_BASE_URL = 'http://127.0.0.1:8321';

export interface SidecarCardPhotoInput {
  /** Raw image bytes, base64 — no `data:` prefix required. */
  imageBase64: string;
  cardSpec: Record<string, unknown>;
  /** Mirrors the input horizontally before face detection — product decision 2026-09-10: the live kiosk preview is deliberately mirrored, but the captured still is saved unmirrored by design, so callers producing a card photo from that still pass `mirror: true` to make the result match what the subject saw in the mirror rather than the raw sensor image. Defaults to `false` when omitted. */
  mirror?: boolean;
}

export interface SidecarCardPhotoResult {
  imageBase64: string;
  /** The sidecar always encodes its output as JPEG — not part of its response body, so this is a constant, not something read off the wire. */
  mimeType: string;
  width: number;
  height: number;
  dpi: number;
  /** Non-fatal issues the pipeline noticed (e.g. no face detected, head-ratio out of range). */
  warnings: string[];
}

export interface SidecarIdentitySimilarityInput {
  /** Reference image (the set's original FRONT photo), base64. */
  referenceImageBase64: string;
  /** Candidate image, base64. */
  candidateImageBase64: string;
}

export interface SidecarIdentitySimilarityResult {
  similarity: number;
}

/** Thrown for any sidecar failure (unreachable, non-2xx, timeout, bad JSON, or — for identity-similarity — the sidecar's own explicit "could not compute a similarity" outcome) — callers catch this and decide the app-level fallback (AUTO_FAILED, 503, etc). */
export class SidecarError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'SidecarError';
  }
}

/**
 * Thin HTTP client for the Python AI sidecar (plan §6.4). **`services/
 * python-ai` itself was deleted 2026-09-28** (product decision: its
 * `/embed`/`/liveness` were a hash-based mock with zero real callers, and
 * the local card-photo/identity-similarity pipeline is being retired in
 * favour of real external APIs — the new `/edit` model is already wired
 * via `AiImageEditClient`). `cardPhoto()`/`identitySimilarity()` below are
 * kept only because they are themselves just HTTP-calling code (not local
 * CV) and every caller already treats "sidecar unreachable" as an expected,
 * gracefully-handled outcome (`SidecarError` → `AUTO_FAILED`/503, never a
 * crash — see `PhotoReviewService.reprocess`'s own comment) — with nothing
 * listening at this client's base URL any more, every call now takes that
 * path. Card-photo generation (crop/background/resize/dpi for printing) and
 * identity-similarity scoring are therefore a **known, accepted gap** until
 * a replacement is built in a follow-up task — not a regression introduced
 * silently here.
 *
 * Base URL: hardcoded `http://127.0.0.1:8321` — no longer env-configurable
 * (the `PYTHON_AI_BASE_URL` knob was removed 2026-09-28; a future
 * replacement service should have that address wired back in here, or in a
 * new dedicated env var, rather than reusing this dead name).
 *
 * **Contract this client still speaks** (the shape `services/python-ai`
 * used to implement, kept here as the interface a replacement should match):
 * - `POST /api/v1/card-photo` `{ image_data, card_spec, mirror? }` →
 *   `{ image_data, width, height, dpi, warnings }` — `mirror` (default
 *   `false`) flips the input horizontally before face detection.
 * - `POST /api/v1/identity-similarity` `{ image_data_a, image_data_b }` →
 *   `{ similarity: number | null, error: string | null }` — `similarity`
 *   is `null` (with `error` explaining why) when no similarity could be
 *   produced, never a fabricated number; `identitySimilarity()` below turns
 *   that into a `SidecarError` so callers don't need to special-case a null
 *   similarity themselves.
 *
 * Neither route accepts a URL for the source image, so every caller of
 * this client must resolve actual bytes before calling in. See
 * `PhotoReviewService`'s own `readSourcePhotoBytes` helper for how it does
 * that (preferring `upload_outbox.content`, already in this same Postgres
 * instance since Part A of the capture-routing work, over a file-service
 * round trip).
 */
@Injectable()
export class PhotoReviewSidecarService {
  private readonly logger = new Logger(PhotoReviewSidecarService.name);

  private baseUrl(): string {
    return SIDECAR_BASE_URL.replace(/\/$/, '');
  }

  // `health()` removed 2026-09-28 — it existed solely as the reachability
  // probe `AppController`'s consolidated health check used to call; that
  // check now calls `AiImageEditClient.health()` instead (see
  // `AppController.health`'s own comment), leaving this method with no
  // remaining caller.

  async cardPhoto(
    input: SidecarCardPhotoInput,
  ): Promise<SidecarCardPhotoResult> {
    const res = await this.postJson<{
      image_data: string;
      width: number;
      height: number;
      dpi: number;
      warnings: string[];
    }>('/card-photo', {
      image_data: input.imageBase64,
      card_spec: input.cardSpec,
      mirror: input.mirror ?? false,
    });
    return {
      imageBase64: res.image_data,
      mimeType: 'image/jpeg',
      width: res.width,
      height: res.height,
      dpi: res.dpi,
      warnings: res.warnings ?? [],
    };
  }

  // `edit()` removed 2026-09-28 — the local sidecar's `/edit` stub is gone
  // along with the rest of `services/python-ai`; AI photo editing now goes
  // through `AiImageEditClient`, a real external service with its own
  // multipart/form-data contract (see that class's own doc comment).

  async identitySimilarity(
    input: SidecarIdentitySimilarityInput,
  ): Promise<SidecarIdentitySimilarityResult> {
    const res = await this.postJson<{
      similarity: number | null;
      error: string | null;
    }>('/identity-similarity', {
      image_data_a: input.referenceImageBase64,
      image_data_b: input.candidateImageBase64,
    });
    if (res.similarity == null) {
      throw new SidecarError(
        res.error ??
          'identity-similarity: the sidecar returned no similarity value',
      );
    }
    return { similarity: res.similarity };
  }

  private async postJson<T>(path: string, body: unknown): Promise<T> {
    const url = `${this.baseUrl()}/api/v1${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SIDECAR_TIMEOUT_MS);

    let res: globalThis.Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      this.logger.warn(
        `sidecar call to ${path} failed: ${(error as Error).message}`,
      );
      throw new SidecarError(`Could not reach the AI sidecar at ${url}`, error);
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new SidecarError(
        `Sidecar ${path} returned ${res.status}${detail ? `: ${detail.slice(0, 500)}` : ''}`,
      );
    }

    try {
      return (await res.json()) as T;
    } catch (error) {
      throw new SidecarError(`Sidecar ${path} returned invalid JSON`, error);
    }
  }
}
