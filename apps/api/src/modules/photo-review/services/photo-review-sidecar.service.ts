import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SIDECAR_TIMEOUT_MS } from '../photo-review.constants';

export interface SidecarCardPhotoInput {
  /** Short-lived URL the sidecar fetches the source image from (same shape `FileStorageService.issueViewLink` already hands the CMS) — used for a source image that already lives on the file-service (reprocess). */
  sourceImageUrl?: string;
  /** Raw bytes for a source image that does not (yet, or ever) live on the file-service — used for a fresh multipart upload (`PhotoReviewService.uploadVariant`) before it has been verified/stored. Exactly one of `sourceImageUrl`/`sourceImageBase64` should be set. */
  sourceImageBase64?: string;
  cardSpec: Record<string, unknown>;
  kindCode: string;
}

export interface SidecarCardPhotoResult {
  imageBase64: string;
  mimeType: string;
  width?: number;
  height?: number;
  dpi?: number;
  qualityReport?: Record<string, unknown>;
  algorithmVersion?: string;
}

export interface SidecarEditInput {
  sourceImageUrl: string;
  prompt: string;
  region?: string;
  cardSpec?: Record<string, unknown>;
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
  /** Reference image (the set's original FRONT photo) — pass a URL when it already lives on the file-service. */
  referenceImageUrl?: string;
  referenceImageBase64?: string;
  /** Candidate image — pass base64 for an in-memory upload that has not (and may never) reach the file-service. */
  candidateImageUrl?: string;
  candidateImageBase64?: string;
}

export interface SidecarIdentitySimilarityResult {
  similarity: number;
}

/** Thrown for any sidecar failure (unreachable, non-2xx, timeout, bad JSON) — callers catch this and decide the app-level fallback (AUTO_FAILED, 503, etc). */
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
 * Base URL: `PYTHON_AI_BASE_URL` env var, default `http://127.0.0.1:8000`.
 * Read directly from `ConfigService` (which falls back to `process.env`)
 * rather than through a dedicated `registerAs('pythonAi', …)` config file
 * under `apps/api/src/config/` — that would be the normal convention here
 * (see `file-service.ts`), but this task is scoped to only touch
 * `apps/api/src/modules/photo-review/**` plus one line in `app.module.ts`,
 * so the env var is read inline instead. A follow-up outside this module's
 * scope could promote it to a proper config file for consistency.
 *
 * **Sidecar contract used by this client** (this module's own design — the
 * plan names the three endpoints but not their exact request/response
 * shape, since the sidecar itself is being built by a different agent):
 * - `POST /card-photo` `{ sourceImageUrl, cardSpec, kindCode }` →
 *   `{ imageBase64, mimeType, width?, height?, dpi?, qualityReport?, algorithmVersion? }`
 * - `POST /edit` `{ sourceImageUrl, prompt, region?, cardSpec? }` →
 *   `{ imageBase64, mimeType, width?, height?, seed?, identitySimilarity?, modelId?, algorithmVersion? }`
 * - `POST /identity-similarity` `{ referenceImageUrl?, referenceImageBase64?, candidateImageUrl?, candidateImageBase64? }`
 *   (at least one of each pair) → `{ similarity: number }` (0-1)
 */
@Injectable()
export class PhotoReviewSidecarService {
  private readonly logger = new Logger(PhotoReviewSidecarService.name);

  constructor(private readonly configService: ConfigService) {}

  private baseUrl(): string {
    return (
      this.configService.get<string>('PYTHON_AI_BASE_URL') ?? 'http://127.0.0.1:8000'
    ).replace(/\/$/, '');
  }

  async cardPhoto(input: SidecarCardPhotoInput): Promise<SidecarCardPhotoResult> {
    return this.postJson<SidecarCardPhotoResult>('/card-photo', input);
  }

  async edit(input: SidecarEditInput): Promise<SidecarEditResult> {
    return this.postJson<SidecarEditResult>('/edit', input);
  }

  async identitySimilarity(
    input: SidecarIdentitySimilarityInput,
  ): Promise<SidecarIdentitySimilarityResult> {
    return this.postJson<SidecarIdentitySimilarityResult>('/identity-similarity', input);
  }

  private async postJson<T>(path: string, body: unknown): Promise<T> {
    const url = `${this.baseUrl()}${path}`;
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
