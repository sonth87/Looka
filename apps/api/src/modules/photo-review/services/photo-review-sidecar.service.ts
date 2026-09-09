import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SIDECAR_TIMEOUT_MS } from '../photo-review.constants';

export interface SidecarCardPhotoInput {
  /** Raw image bytes, base64 — no `data:` prefix required (the sidecar tolerates one, but never sends it), matching `services/python-ai/src/models/image_codec.py`'s `decode_image()`. */
  imageBase64: string;
  cardSpec: Record<string, unknown>;
}

export interface SidecarCardPhotoResult {
  imageBase64: string;
  /** The sidecar always encodes its output as JPEG (`image_codec.encode_image`) — not part of its response body, so this is a constant, not something read off the wire. */
  mimeType: string;
  width: number;
  height: number;
  dpi: number;
  /** Non-fatal issues the pipeline noticed (e.g. no face detected, head-ratio out of range) — `services/python-ai/src/api/routes/card_photo.py`'s `CardPhotoResponse.warnings`. */
  warnings: string[];
}

export interface SidecarEditInput {
  imageBase64: string;
  prompt: string;
  region?: string;
  fromVariantId?: string;
}

export interface SidecarEditResult {
  imageBase64: string;
  mimeType: string;
  width?: number;
  height?: number;
  seed?: string;
  identitySimilarity?: number;
  modelId?: string;
  algorithmVersion?: string;
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
 * Thin HTTP client for the Python AI sidecar (plan §6.4) — a different
 * agent's module (`services/python-ai`), possibly not built or not running
 * in any given environment. Every call here is deliberately defensive: a
 * network failure, a non-2xx response, or a timeout all resolve to a
 * `SidecarError` rather than throwing something uncaught or hanging past
 * `SIDECAR_TIMEOUT_MS` — see `PhotoReviewService.reprocess`'s own comment
 * for why a clean `AUTO_FAILED` (not a crash) is the required behaviour
 * when the sidecar is absent.
 *
 * Base URL: `PYTHON_AI_BASE_URL` env var, default `http://127.0.0.1:8321` —
 * matches how `services/python-ai` is actually run everywhere else in this
 * repo (`apps/desktop/src/main/aiService.ts`, `docs/ROADMAP.md`); the old
 * `:8000` default here never matched anything real. Read directly from
 * `ConfigService` (which falls back to `process.env`) rather than through a
 * dedicated `registerAs('pythonAi', …)` config file under
 * `apps/api/src/config/` — that would be the normal convention here (see
 * `file-service.ts`), but this task is scoped to only touch
 * `apps/api/src/modules/photo-review/**` plus one line in `app.module.ts`,
 * so the env var is read inline instead. A follow-up outside this module's
 * scope could promote it to a proper config file for consistency.
 *
 * **Sidecar contract used by this client** — every real FastAPI route is
 * mounted under `/api/v1` (`services/python-ai/src/api/app.py`), and every
 * request/response body below is read straight off that side's own Pydantic
 * models (`card_photo.py`/`edit.py`/`identity.py`), not invented here:
 * - `POST /api/v1/card-photo` `{ image_data, card_spec }` →
 *   `{ image_data, width, height, dpi, warnings }`
 * - `POST /api/v1/edit` `{ image_data, prompt, region?, fromVariantId? }` —
 *   the route validates the prompt and defines the contract but has no
 *   generative model wired in this environment (`services/python-ai/src/api/routes/edit.py`'s
 *   own module doc comment): it always resolves to HTTP 501
 *   `{ error, detail }` today. This client still sends/parses the real
 *   shape so nothing here needs to change once a model is wired in.
 * - `POST /api/v1/identity-similarity` `{ image_data_a, image_data_b }` →
 *   `{ similarity: number | null, error: string | null }` — `similarity`
 *   is `null` (with `error` explaining why) when the sidecar's face-
 *   embedding model genuinely could not produce one (no face detected,
 *   model unavailable), never a fabricated number; `identitySimilarity()`
 *   below turns that into a `SidecarError` so callers don't need to special-
 *   case a null similarity themselves.
 *
 * None of these three routes accept a URL for the source image — the
 * sidecar has no url-fetching code anywhere (`decode_image()` only ever
 * does `base64.b64decode()`) — so every caller of this client must resolve
 * actual bytes before calling in. See `PhotoReviewService`'s own
 * `readSourcePhotoBytes` helper for how it does that (preferring
 * `upload_outbox.content`, already in this same Postgres instance since
 * Part A of the capture-routing work, over a file-service round trip).
 */
@Injectable()
export class PhotoReviewSidecarService {
  private readonly logger = new Logger(PhotoReviewSidecarService.name);

  constructor(private readonly configService: ConfigService) {}

  private baseUrl(): string {
    return (
      this.configService.get<string>('PYTHON_AI_BASE_URL') ?? 'http://127.0.0.1:8321'
    ).replace(/\/$/, '');
  }

  async cardPhoto(input: SidecarCardPhotoInput): Promise<SidecarCardPhotoResult> {
    const res = await this.postJson<{
      image_data: string;
      width: number;
      height: number;
      dpi: number;
      warnings: string[];
    }>('/card-photo', {
      image_data: input.imageBase64,
      card_spec: input.cardSpec,
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

  async edit(input: SidecarEditInput): Promise<SidecarEditResult> {
    // Response shape is read defensively (camelCase AND snake_case): the
    // route has no generative model wired in this environment and always
    // 501s today (see this class's own doc comment) — `postJson` already
    // turns that into a `SidecarError` before this ever runs — but once a
    // real model IS wired in, its actual field naming is not yet known, so
    // this does not assume one convention over the other.
    const res = await this.postJson<Record<string, unknown>>('/edit', {
      image_data: input.imageBase64,
      prompt: input.prompt,
      region: input.region,
      fromVariantId: input.fromVariantId,
    });
    return {
      imageBase64: String(res.image_data ?? res.imageBase64 ?? ''),
      mimeType: 'image/jpeg',
      width: (res.width as number | undefined) ?? undefined,
      height: (res.height as number | undefined) ?? undefined,
      seed: (res.seed as string | undefined) ?? undefined,
      identitySimilarity:
        (res.identitySimilarity as number | undefined) ??
        (res.identity_similarity as number | undefined) ??
        undefined,
      modelId: (res.modelId as string | undefined) ?? (res.model_id as string | undefined) ?? undefined,
      algorithmVersion:
        (res.algorithmVersion as string | undefined) ??
        (res.algorithm_version as string | undefined) ??
        undefined,
    };
  }

  async identitySimilarity(
    input: SidecarIdentitySimilarityInput,
  ): Promise<SidecarIdentitySimilarityResult> {
    const res = await this.postJson<{ similarity: number | null; error: string | null }>(
      '/identity-similarity',
      {
        image_data_a: input.referenceImageBase64,
        image_data_b: input.candidateImageBase64,
      },
    );
    if (res.similarity == null) {
      throw new SidecarError(
        res.error ?? 'identity-similarity: the sidecar returned no similarity value',
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
      this.logger.warn(`sidecar call to ${path} failed: ${(error as Error).message}`);
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
