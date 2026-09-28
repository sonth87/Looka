import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface AiImageEditInput {
  imageBuffer: Buffer;
  /** `image/jpeg` or `image/png` — service default is jpg/png only, ≤10MB. */
  mimeType: string;
  /** English works far better than Vietnamese on this model — see the service's own integration guide. Omitted → the service's own default portrait-retouch prompt. */
  prompt?: string;
  /** Classifier-free-guidance scale, 1.0–8.0 — how closely the model follows `prompt` vs. the source image. Omitted → `DEFAULT_CFG` (this app's own product default, not the service's 3.0 — see that constant's own comment). Out-of-range values are clamped by the service itself, never rejected. */
  cfg?: number;
  /** Denoising steps, 10–50 — more = sharper fine detail, slower. Omitted → `DEFAULT_STEPS` (this app's own product default, not the service's 30). */
  steps?: number;
  /** -1 (default) asks the service to pick randomly; echo back a previous result's `AiImageEditResult.seed` here to reproduce it exactly (same image, same prompt, same seed → same output). */
  seed?: number;
  /** Output size, 256–2048, rounded down by the service to a multiple of 16 — NOT a crop (see the integration guide's own "những chỗ dễ nhầm"), it changes the canvas/aspect ratio the model fills in. Omitted → the service computes it from the input image's own aspect ratio. */
  width?: number;
  height?: number;
}

export interface AiImageEditResult {
  imageBuffer: Buffer;
  mimeType: string;
  /** `X-Seed-Used` — echo this back as `seed` on a retry to reproduce the exact same output. */
  seed: number | null;
  /** `X-Duration-Ms` — server-side processing time, for logging/observability only. */
  durationMs: number | null;
}

export interface AiImageEditHealth {
  reachable: boolean;
  modelLoaded: boolean;
  body: unknown;
  error?: string;
}

/** Thrown for a permanent failure (bad request, unreachable, unexpected body) — never retryable. */
export class AiImageEditError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'AiImageEditError';
  }
}

/** Thrown for a transient failure the caller may retry (service's own queue full, or it timed out mid-job) — mirrors the integration guide's "503/504 là lỗi tạm thời, retry có thể thành công" note. */
export class AiImageEditRetryableError extends AiImageEditError {
  constructor(message: string, cause?: unknown) {
    super(message, cause);
    this.name = 'AiImageEditRetryableError';
  }
}

const DEFAULT_BASE_URL = 'http://10.20.15.25:8000';
/**
 * The service's own `REQUEST_TIMEOUT_S` defaults to 120s, or 600s when it
 * runs with `LOW_VRAM=1` — this client's timeout must stay >= whatever the
 * operator actually configured there, so it is a separate env var rather
 * than reusing `SIDECAR_TIMEOUT_MS` (30s, sized for the local sidecar's
 * fast deterministic-CV endpoints, far too short for a generative model).
 *
 * 600s (the LOW_VRAM=1 ceiling), not 120s — confirmed necessary by a real,
 * successful call during this task's own live verification (2026-09-28):
 * `steps=15` on a real portrait took `X-Duration-Ms: 278473` (~278s)
 * server-side, ~342s wall time end to end. An earlier `150_000` default
 * here would have aborted that exact request. Whatever this deployment's
 * `LOW_VRAM` setting actually is, real observed latency already exceeds
 * 120s, so 600s is the only safe default without operator confirmation.
 */
const DEFAULT_TIMEOUT_MS = 600_000;
/** The service processes one request at a time (its own internal queue) — a 503 (queue full) is worth one short retry, not a long backoff loop that would just make the caller's own request hang. */
const MAX_RETRY_ATTEMPTS = 2;
const RETRY_DELAY_MS = 2_000;
/**
 * This app's own product default (2026-09-28 user decision) — deliberately
 * NOT the service's own default (3.0/30, per the integration guide). Sent
 * explicitly on every call whose caller didn't specify a value, rather than
 * omitting the field and letting the remote service fall back to its own
 * default, so this app's calls behave consistently regardless of what that
 * service's own default happens to be configured to.
 */
const DEFAULT_CFG = 2;
const DEFAULT_STEPS = 20;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * HTTP client for the external "AI photo edit" service — a locally-hosted
 * generative image-edit model, per the integration guide ("Hướng dẫn tích
 * hợp API Chỉnh sửa ảnh sử dụng Model local"). Unlike
 * `PhotoReviewSidecarService` (JSON body, base64 image, talks to
 * `services/python-ai` — removed 2026-09-28), this service's own contract is
 * `multipart/form-data` in, raw JPEG bytes out, so it gets its own client
 * rather than reusing that one's `postJson` helper.
 *
 * Base URL: `AI_IMAGE_EDIT_URL` env var, default `http://10.20.15.25:8000` —
 * the address the integration guide documents. Only `image` is ever sent as
 * required; every other field (`prompt`/`cfg`/`steps`/`seed`/`width`/
 * `height`) is optional on the service's own side (falls back to its own
 * defaults, and clamps out-of-range values rather than rejecting them).
 * `prompt`/`seed`/`width`/`height` are sent only when a caller actually
 * provides them; `cfg`/`steps` are the one exception — always sent, with
 * this app's own default (`DEFAULT_CFG`/`DEFAULT_STEPS`) standing in for an
 * unspecified value rather than leaving it to the service's own default —
 * see those constants' own comment.
 */
@Injectable()
export class AiImageEditClient {
  private readonly logger = new Logger(AiImageEditClient.name);

  constructor(private readonly configService: ConfigService) {}

  private baseUrl(): string {
    return (
      this.configService.get<string>('AI_IMAGE_EDIT_URL') ?? DEFAULT_BASE_URL
    ).replace(/\/$/, '');
  }

  private timeoutMs(): number {
    const raw = this.configService.get<string>('AI_IMAGE_EDIT_TIMEOUT_MS');
    const parsed = raw ? Number(raw) : NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS;
  }

  /** `GET /health` — never throws; a down/unconfigured service is a reported fact, matching `PhotoReviewSidecarService.health()`'s own contract. Callers should only proceed to `edit()` once `modelLoaded` is true (the service rejects calls made before its model finishes loading). */
  async health(): Promise<AiImageEditHealth> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5_000);
    try {
      const res = await fetch(`${this.baseUrl()}/health`, {
        signal: controller.signal,
      });
      if (!res.ok) {
        return {
          reachable: false,
          modelLoaded: false,
          body: null,
          error: `HTTP ${res.status}`,
        };
      }
      const body = await res.json().catch(() => null);
      const modelLoaded =
        !!body &&
        typeof body === 'object' &&
        (body as Record<string, unknown>).model_loaded === true;
      return { reachable: true, modelLoaded, body };
    } catch (error) {
      return {
        reachable: false,
        modelLoaded: false,
        body: null,
        error: (error as Error).message,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  /** `POST /edit`. Retries a bounded number of times on 503 (queue full)/504 (the service gave up waiting) — both documented as transient — then gives up with `AiImageEditRetryableError` so the caller can surface a clear "try again shortly" rather than a generic failure. */
  async edit(input: AiImageEditInput): Promise<AiImageEditResult> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= MAX_RETRY_ATTEMPTS; attempt++) {
      if (attempt > 0) await sleep(RETRY_DELAY_MS);
      try {
        return await this.attemptEdit(input);
      } catch (error) {
        lastError = error;
        if (!(error instanceof AiImageEditRetryableError)) throw error;
        this.logger.warn(
          `AI image-edit attempt ${attempt + 1}/${MAX_RETRY_ATTEMPTS + 1} failed transiently: ${error.message}`,
        );
      }
    }
    throw lastError;
  }

  private async attemptEdit(
    input: AiImageEditInput,
  ): Promise<AiImageEditResult> {
    const form = new FormData();
    form.append(
      'image',
      new Blob([Uint8Array.from(input.imageBuffer)], {
        type: input.mimeType,
      }),
      `source.${input.mimeType === 'image/png' ? 'png' : 'jpg'}`,
    );
    if (input.prompt) form.append('prompt', input.prompt);
    // `cfg`/`steps` always sent — this app's own default (2/20) overrides
    // the service's own (3.0/30) whenever a caller didn't specify one; see
    // `DEFAULT_CFG`/`DEFAULT_STEPS`'s own comment. `seed`/`width`/`height`
    // stay conditional — no app-level opinion on those, omitted means "let
    // the service decide" exactly as the integration guide documents.
    form.append('cfg', String(input.cfg ?? DEFAULT_CFG));
    form.append('steps', String(input.steps ?? DEFAULT_STEPS));
    if (input.seed !== undefined) form.append('seed', String(input.seed));
    if (input.width !== undefined) form.append('width', String(input.width));
    if (input.height !== undefined) form.append('height', String(input.height));

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs());
    let res: globalThis.Response;
    try {
      res = await fetch(`${this.baseUrl()}/edit`, {
        method: 'POST',
        body: form,
        signal: controller.signal,
      });
    } catch (error) {
      throw new AiImageEditError(
        `Could not reach the AI image-edit service at ${this.baseUrl()}`,
        error,
      );
    } finally {
      clearTimeout(timer);
    }

    if (res.status === 503 || res.status === 504) {
      const detail = await res.text().catch(() => '');
      throw new AiImageEditRetryableError(
        `AI image-edit service returned ${res.status}${detail ? `: ${detail.slice(0, 300)}` : ''}`,
      );
    }

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new AiImageEditError(
        `AI image-edit service returned ${res.status}${detail ? `: ${detail.slice(0, 500)}` : ''}`,
      );
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    const seedHeader = res.headers.get('x-seed-used');
    const durationHeader = res.headers.get('x-duration-ms');
    return {
      imageBuffer: buffer,
      mimeType: 'image/jpeg',
      seed: seedHeader ? Number(seedHeader) : null,
      durationMs: durationHeader ? Number(durationHeader) : null,
    };
  }
}
