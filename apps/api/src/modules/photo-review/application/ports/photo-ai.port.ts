import { IntegrationOutcome } from '@app/shared/integrations/integration-outcome';

/**
 * DI token — `PhotoAiPort` is a TS interface (erased at runtime), so Nest
 * needs a concrete token to bind it to `PhotoAiAdapter` (`photo-ai.adapter.ts`,
 * this module's `providers`/`exports`). Not a class: nothing about this
 * value needs identity beyond being a unique injection key.
 */
export const PHOTO_AI_PORT = Symbol('PhotoAiPort');

export interface PhotoAiHealth {
  reachable: boolean;
  modelLoaded: boolean;
  body: unknown;
  error?: string;
}

export interface PhotoAiMakeCardPhotoInput {
  /** Raw image bytes, base64 — no `data:` prefix required. */
  imageBase64: string;
  cardSpec: Record<string, unknown>;
  /** See `PhotoReviewSidecarService`'s own `SidecarCardPhotoInput.mirror` doc comment — same meaning, carried through unchanged. */
  mirror?: boolean;
}

export interface PhotoAiMakeCardPhotoResult {
  imageBase64: string;
  mimeType: string;
  width: number;
  height: number;
  dpi: number;
  warnings: string[];
}

export interface PhotoAiEditInput {
  imageBuffer: Buffer;
  mimeType: string;
  prompt?: string;
  /** See `AiImageEditInput.cfg`'s own doc comment — omitted here still means "let the adapter apply its own default", not "let the remote service pick". */
  cfg?: number;
  steps?: number;
  seed?: number;
  width?: number;
  height?: number;
}

export interface PhotoAiEditResult {
  imageBuffer: Buffer;
  mimeType: string;
  seed: number | null;
  durationMs: number | null;
}

export interface PhotoAiIdentitySimilarityInput {
  referenceImageBase64: string;
  candidateImageBase64: string;
}

export interface PhotoAiIdentitySimilarityResult {
  similarity: number;
}

/**
 * Port (backend-layering-plan.md §4.5) for every "AI does something to a
 * photo" operation `photo-review` needs. `PhotoReviewService` depends on
 * this interface, never on `AiImageEditClient`/`PhotoReviewSidecarService`
 * directly — see `PhotoAiAdapter` (this module's `services/photo-ai.adapter.ts`)
 * for the concrete implementation those two concrete HTTP clients back
 * today, and that class's own doc comment for why it lives inside this
 * module rather than at the plan's suggested `shared/integrations/python-ai/`
 * path (that relocation is a separate, larger, still-deferred piece of work
 * — `shared/integrations/` may not import `modules/**`, and the two
 * concrete clients still live under `modules/photo-review/services/`).
 *
 * Every method except `health()` returns the same `IntegrationOutcome`
 * `shared/integrations/*` already established (`SsoProfilePort`'s
 * `fetchSsoProfile`, `StudentDirectoryPort`'s adapter, `EligibilityHttpClient`
 * — see `shared/integrations/integration-outcome.ts`'s own doc comment) —
 * reused as-is here, not re-invented, so this port classifies failures the
 * same way every other one in this app already does. `health()` keeps its
 * own long-standing "never throws, always describes" contract instead
 * (matches `AiImageEditClient.health()` and the old
 * `PhotoReviewSidecarService.health()` before it), since a health probe has
 * no "request" to classify as Retryable/Terminal/etc. in the first place.
 * Callers that want exception-based flow control (matching this module's
 * existing convention almost everywhere) can use `unwrapPhotoAi` below.
 */
export interface PhotoAiPort {
  health(): Promise<PhotoAiHealth>;
  makeCardPhoto(
    input: PhotoAiMakeCardPhotoInput,
  ): Promise<IntegrationOutcome<PhotoAiMakeCardPhotoResult>>;
  edit(input: PhotoAiEditInput): Promise<IntegrationOutcome<PhotoAiEditResult>>;
  identitySimilarity(
    input: PhotoAiIdentitySimilarityInput,
  ): Promise<IntegrationOutcome<PhotoAiIdentitySimilarityResult>>;
}

/** Thrown by `unwrapPhotoAi` for any non-`Success` outcome — `.message` is already the real, human-readable failure text (unlike `CustomException`, see `extractSidecarFailureMessage`'s own doc comment in `photo-review.service.ts`), so existing `catch` blocks there need no special-casing for this class. */
export class PhotoAiError extends Error {
  constructor(
    message: string,
    public readonly kind: Exclude<
      IntegrationOutcome<unknown>['kind'],
      'Success'
    >,
  ) {
    super(message);
    this.name = 'PhotoAiError';
  }
}

/**
 * Bridges the outcome-based port contract back to this module's existing
 * exception-based call sites (`reprocess`/`aiEdit`/`uploadVariant`, each
 * already wrapping a sidecar-ish call in a `try`/`catch` that maps any
 * failure to `AUTO_FAILED`/`FAILED`/`SIDECAR_UNREACHABLE`) — returns
 * `outcome.value` on success, throws `PhotoAiError` otherwise, so those call
 * sites need no restructuring beyond swapping which method they call.
 */
export function unwrapPhotoAi<T>(outcome: IntegrationOutcome<T>): T {
  if (outcome.kind === 'Success') return outcome.value;
  throw new PhotoAiError(outcome.reason, outcome.kind);
}
