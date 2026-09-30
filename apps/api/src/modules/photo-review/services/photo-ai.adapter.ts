import { Injectable } from '@nestjs/common';
import {
  IntegrationOutcome,
  success,
  retryable,
  terminal,
  timeout,
  unavailable,
} from '@app/shared/integrations/integration-outcome';
import {
  PhotoAiEditInput,
  PhotoAiEditResult,
  PhotoAiHealth,
  PhotoAiIdentitySimilarityInput,
  PhotoAiIdentitySimilarityResult,
  PhotoAiMakeCardPhotoInput,
  PhotoAiMakeCardPhotoResult,
  PhotoAiPort,
} from '../application/ports/photo-ai.port';
import {
  AiImageEditClient,
  AiImageEditError,
  AiImageEditRetryableError,
  AiImageEditTimeoutError,
} from './ai-image-edit.client';
import {
  PhotoReviewSidecarService,
  SidecarError,
  SidecarTimeoutError,
} from './photo-review-sidecar.service';

/**
 * Concrete `PhotoAiPort` — composes the two existing HTTP clients this
 * module already had (`AiImageEditClient` for the real, live `/edit`
 * service; `PhotoReviewSidecarService` for `makeCardPhoto`/
 * `identitySimilarity`, still backed by the now-dead `services/python-ai`
 * sidecar — see that class's own doc comment on why it is kept anyway).
 * Neither client is touched by this class — both keep their own working
 * retry/timeout/error behavior; this adapter's only job is translating
 * their thrown errors into `IntegrationOutcome`s at the port boundary
 * (reusing `shared/integrations/integration-outcome.ts` as-is — see
 * `PhotoAiPort`'s own doc comment for why this does not fork that type).
 *
 * Deliberately named `photo-ai.adapter.ts` and placed here, inside
 * `modules/photo-review/services/`, rather than at the plan's suggested
 * `shared/integrations/python-ai/photo-ai.adapter.ts` (backend-layering-plan.md
 * §4.5): that location's own rule forbids importing `modules/**`, but the
 * two clients this adapter wraps still live under `modules/photo-review/
 * services/` — moving them to `shared/integrations/` too ("chuyển hẳn hai
 * service lớn") is explicitly called out in the plan as separate, larger,
 * still-deferred work, not required for `PhotoAiPort` itself to exist and
 * be used.
 */
@Injectable()
export class PhotoAiAdapter implements PhotoAiPort {
  constructor(
    private readonly aiImageEdit: AiImageEditClient,
    private readonly sidecar: PhotoReviewSidecarService,
  ) {}

  health(): Promise<PhotoAiHealth> {
    return this.aiImageEdit.health();
  }

  async makeCardPhoto(
    input: PhotoAiMakeCardPhotoInput,
  ): Promise<IntegrationOutcome<PhotoAiMakeCardPhotoResult>> {
    try {
      const result = await this.sidecar.cardPhoto(input);
      return success(result);
    } catch (error) {
      // `SidecarTimeoutError` checked first (it extends `SidecarError`) —
      // 2026-09-29: a timeout classifies as `Timeout` (→ `PENDING`,
      // auto-recovered by `AiEditRecoveryService`) rather than
      // `Unavailable` (→ `FAILED`). Every other `SidecarError` (unreachable,
      // non-2xx, bad JSON) still classifies as `Unavailable` — the sidecar
      // this talks to is permanently dead (see `PhotoReviewSidecarService`'s
      // own top doc comment), so those stay a hard, non-retried failure.
      if (error instanceof SidecarTimeoutError) {
        return timeout(errorMessage(error));
      }
      return unavailable(errorMessage(error));
    }
  }

  async identitySimilarity(
    input: PhotoAiIdentitySimilarityInput,
  ): Promise<IntegrationOutcome<PhotoAiIdentitySimilarityResult>> {
    try {
      const result = await this.sidecar.identitySimilarity(input);
      return success(result);
    } catch (error) {
      if (error instanceof SidecarTimeoutError) {
        return timeout(errorMessage(error));
      }
      return unavailable(errorMessage(error));
    }
  }

  async edit(
    input: PhotoAiEditInput,
  ): Promise<IntegrationOutcome<PhotoAiEditResult>> {
    try {
      const result = await this.aiImageEdit.edit(input);
      return success(result);
    } catch (error) {
      // Checked first (it extends `AiImageEditError`, not
      // `AiImageEditRetryableError` — see that class's own doc comment):
      // this app's own call (or undici's own lower ceiling underneath it)
      // timing out is worth an automatic retry via the AI-edit recovery
      // sweep (`Timeout` → `PENDING`), same as the service's own 503/504
      // (`Retryable` → also `PENDING`, see `resolveAiJobFailureStatus`) —
      // but tracked as a distinct outcome kind since they are different
      // failure modes (our timeout vs. the service's own signal).
      if (error instanceof AiImageEditTimeoutError) {
        return timeout(error.message);
      }
      if (error instanceof AiImageEditRetryableError) {
        return retryable(error.message);
      }
      if (error instanceof AiImageEditError) {
        // `AiImageEditClient.attemptEdit` sets `cause` only on the
        // network-level failure branch ("Could not reach …") — a non-2xx
        // response the service itself returned (bad image, 4xx/5xx) throws
        // with no `cause`. That distinction is exactly Unavailable (infra
        // problem) vs Terminal (this specific request was rejected) — see
        // `integration-outcome.ts`'s own doc comment on the Retryable vs
        // Terminal "deadly trap".
        return error.cause
          ? unavailable(error.message)
          : terminal(error.message);
      }
      return terminal(errorMessage(error));
    }
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof SidecarError) return error.message;
  return (error as Error)?.message ?? String(error);
}
