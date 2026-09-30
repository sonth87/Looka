import { ConfigService } from '@nestjs/config';
import {
  AiImageEditClient,
  AiImageEditError,
  AiImageEditTimeoutError,
} from './ai-image-edit.client';
import {
  PhotoReviewSidecarService,
  SidecarError,
  SidecarTimeoutError,
} from './photo-review-sidecar.service';
import { PhotoAiAdapter } from './photo-ai.adapter';

/**
 * Timeout classification coverage (2026-09-29, AI-edit queue lifecycle
 * rework, item C.4 of the plan) — the distinction this whole task's
 * retry-vs-FAILED design (`resolveAiJobFailureStatus`) leans on: OUR OWN
 * call timing out (this app's `AbortController`, or undici's own lower
 * `headersTimeout`/`bodyTimeout`/`connectTimeout` firing first) must
 * classify as `Timeout` (→ left `PROCESSING` for the sweep to auto-retry —
 * see `PhotoVariantStatus`'s own doc comment for why there is no separate
 * status for this), while every OTHER failure (the service refusing the
 * request, or being flat-out unreachable) must keep classifying as
 * `Terminal`/`Unavailable` (→ `FAILED`).
 *
 * Mocks `global.fetch` directly rather than spinning up a real HTTP server
 * — both clients' own timeout-detection logic (`isFetchTimeout`) only cares
 * about what `fetch()` rejects WITH, not how a real socket actually
 * misbehaves.
 */
describe('AI-edit timeout classification', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  describe('AiImageEditClient', () => {
    function makeClient(timeoutMs: number): AiImageEditClient {
      const configService = {
        get: (key: string) =>
          key === 'AI_IMAGE_EDIT_TIMEOUT_MS' ? String(timeoutMs) : undefined,
      } as unknown as ConfigService;
      return new AiImageEditClient(configService);
    }

    it('classifies its own AbortController firing as AiImageEditTimeoutError', async () => {
      // Real `fetch` behavior on abort: the promise rejects with a
      // DOMException/Error named 'AbortError' once `signal` fires.
      global.fetch = jest.fn(
        (_url: unknown, init?: RequestInit) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
              const err = new Error('This operation was aborted');
              err.name = 'AbortError';
              reject(err);
            });
          }),
      ) as unknown as typeof fetch;

      const client = makeClient(5); // fires almost immediately
      await expect(
        client.edit({ imageBuffer: Buffer.from('x'), mimeType: 'image/jpeg' }),
      ).rejects.toBeInstanceOf(AiImageEditTimeoutError);
    });

    it("classifies undici's own UND_ERR_HEADERS_TIMEOUT cause code as AiImageEditTimeoutError", async () => {
      global.fetch = jest.fn().mockRejectedValue(
        Object.assign(new TypeError('fetch failed'), {
          cause: { code: 'UND_ERR_HEADERS_TIMEOUT' },
        }),
      );

      const client = makeClient(600_000);
      await expect(
        client.edit({ imageBuffer: Buffer.from('x'), mimeType: 'image/jpeg' }),
      ).rejects.toBeInstanceOf(AiImageEditTimeoutError);
    });

    it('classifies ECONNREFUSED as a plain AiImageEditError (unavailable), not a timeout', async () => {
      global.fetch = jest.fn().mockRejectedValue(
        Object.assign(new TypeError('fetch failed'), {
          cause: { code: 'ECONNREFUSED' },
        }),
      );

      const client = makeClient(600_000);
      const promise = client.edit({
        imageBuffer: Buffer.from('x'),
        mimeType: 'image/jpeg',
      });
      await expect(promise).rejects.toBeInstanceOf(AiImageEditError);
      await expect(promise).rejects.not.toBeInstanceOf(AiImageEditTimeoutError);
    });
  });

  describe('PhotoReviewSidecarService', () => {
    it("classifies undici's own timeout cause code as SidecarTimeoutError", async () => {
      global.fetch = jest.fn().mockRejectedValue(
        Object.assign(new TypeError('fetch failed'), {
          cause: { code: 'UND_ERR_BODY_TIMEOUT' },
        }),
      );

      const sidecar = new PhotoReviewSidecarService();
      await expect(
        sidecar.identitySimilarity({
          referenceImageBase64: 'aa',
          candidateImageBase64: 'bb',
        }),
      ).rejects.toBeInstanceOf(SidecarTimeoutError);
    });

    it('classifies ECONNREFUSED as a plain SidecarError, not a timeout', async () => {
      global.fetch = jest.fn().mockRejectedValue(
        Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:8321'), {
          cause: { code: 'ECONNREFUSED' },
        }),
      );

      const sidecar = new PhotoReviewSidecarService();
      const promise = sidecar.identitySimilarity({
        referenceImageBase64: 'aa',
        candidateImageBase64: 'bb',
      });
      await expect(promise).rejects.toBeInstanceOf(SidecarError);
      await expect(promise).rejects.not.toBeInstanceOf(SidecarTimeoutError);
    });
  });

  describe('PhotoAiAdapter (port-level classification)', () => {
    it('maps AiImageEditTimeoutError to IntegrationOutcome kind Timeout', async () => {
      global.fetch = jest.fn().mockRejectedValue(
        Object.assign(new TypeError('fetch failed'), {
          cause: { code: 'UND_ERR_HEADERS_TIMEOUT' },
        }),
      );

      const configService = {
        get: () => undefined,
      } as unknown as ConfigService;
      const adapter = new PhotoAiAdapter(
        new AiImageEditClient(configService),
        new PhotoReviewSidecarService(),
      );
      const outcome = await adapter.edit({
        imageBuffer: Buffer.from('x'),
        mimeType: 'image/jpeg',
      });
      expect(outcome.kind).toBe('Timeout');
    });

    it('maps SidecarTimeoutError to IntegrationOutcome kind Timeout for makeCardPhoto', async () => {
      global.fetch = jest.fn().mockRejectedValue(
        Object.assign(new TypeError('fetch failed'), {
          cause: { code: 'UND_ERR_CONNECT_TIMEOUT' },
        }),
      );

      const configService = {
        get: () => undefined,
      } as unknown as ConfigService;
      const adapter = new PhotoAiAdapter(
        new AiImageEditClient(configService),
        new PhotoReviewSidecarService(),
      );
      const outcome = await adapter.makeCardPhoto({
        imageBase64: 'aa',
        cardSpec: {},
      });
      expect(outcome.kind).toBe('Timeout');
    });

    it('keeps ECONNREFUSED as Unavailable, not Timeout', async () => {
      global.fetch = jest.fn().mockRejectedValue(
        Object.assign(new TypeError('fetch failed'), {
          cause: { code: 'ECONNREFUSED' },
        }),
      );

      const configService = {
        get: () => undefined,
      } as unknown as ConfigService;
      const adapter = new PhotoAiAdapter(
        new AiImageEditClient(configService),
        new PhotoReviewSidecarService(),
      );
      const outcome = await adapter.edit({
        imageBuffer: Buffer.from('x'),
        mimeType: 'image/jpeg',
      });
      expect(outcome.kind).toBe('Unavailable');
    });
  });
});
