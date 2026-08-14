import { FaceProfile, RecognitionCandidate, RecognitionResult } from '@face/core';
import { cosineSimilarity } from '@face/biometric';
import { SecurityLevel, ThresholdPolicy } from './ThresholdPolicy.js';

export interface GalleryEntry {
  profile: FaceProfile;
  centroid: Float32Array;
}

/** The embedding space a probe vector belongs to. */
export interface ModelIdentity {
  modelFamily: string;
  modelVersion: string;
  preprocessingVersion: string;
}

export interface IdentifyOptions {
  /**
   * Embedding space of the probe. Gallery entries outside it are excluded.
   *
   * Comparing vectors from different models — or the same model with different
   * preprocessing — yields numbers that look valid but mean nothing, and no
   * error is raised to reveal it. Passing this is how that is prevented.
   */
  requiredModel: ModelIdentity;
  topK?: number;
  level?: SecurityLevel;
  /** Called when gallery entries are dropped as incompatible, so it is never silent. */
  onIncompatible?: (info: { skipped: number; total: number; required: ModelIdentity }) => void;
}

/**
 * Recognition result plus material that must not reach the user interface.
 *
 * Candidate identities are kept for later review of a disputed decision, but
 * showing them on a kiosk turns it into an identity-lookup tool: stand in front
 * of the camera long enough and it reveals who is enrolled.
 */
export interface IdentifyOutcome {
  /** Safe to render. Carries a personId only on a confirmed MATCH. */
  result: RecognitionResult;
  /** For audit storage only. Never forward to the renderer. */
  audit: {
    candidates: RecognitionCandidate[];
    gallerySize: number;
    skippedIncompatible: number;
  };
}

function sameModel(profile: FaceProfile, m: ModelIdentity): boolean {
  return (
    profile.modelFamily === m.modelFamily &&
    profile.modelVersion === m.modelVersion &&
    profile.preprocessingVersion === m.preprocessingVersion
  );
}

export class IdentificationEngine {
  public identify(
    probeVector: Float32Array,
    gallery: GalleryEntry[],
    options: IdentifyOptions
  ): IdentifyOutcome {
    const startTime = performance.now();
    const { requiredModel, topK = 5, level = 'BALANCED' } = options;
    const config = ThresholdPolicy.getThreshold(level);

    const modelVersion = `${requiredModel.modelFamily}/${requiredModel.modelVersion}/${requiredModel.preprocessingVersion}`;
    const total = gallery?.length ?? 0;

    const compatible = (gallery ?? []).filter((e) => sameModel(e.profile, requiredModel));
    const skipped = total - compatible.length;
    if (skipped > 0) {
      options.onIncompatible?.({ skipped, total, required: requiredModel });
    }

    const empty = (durationMs: number): IdentifyOutcome => ({
      result: { status: 'UNKNOWN', modelVersion, durationMs },
      audit: { candidates: [], gallerySize: compatible.length, skippedIncompatible: skipped },
    });

    if (compatible.length === 0) return empty(Math.round(performance.now() - startTime));

    const candidates: RecognitionCandidate[] = compatible.map((entry) => ({
      personId: entry.profile.personId,
      profileId: entry.profile.id,
      score: Number(cosineSimilarity(probeVector, entry.centroid).toFixed(4)),
    }));

    candidates.sort((a, b) => b.score - a.score);
    const top = candidates.slice(0, topK);
    const durationMs = Math.round(performance.now() - startTime);
    const audit = {
      candidates: top,
      gallerySize: compatible.length,
      skippedIncompatible: skipped,
    };

    const best = top[0];

    // Below threshold: not similar enough to anyone.
    if (best.score < config.matchThreshold) {
      return { result: { status: 'UNKNOWN', modelVersion, durationMs }, audit };
    }

    // Above threshold but too close to the runner-up: similar to more than one
    // person. Look-alikes and siblings live here, and this is exactly where a
    // threshold-only engine confidently attributes the wrong identity.
    if (top.length > 1 && best.score - top[1].score < config.ambiguityMargin) {
      return { result: { status: 'AMBIGUOUS', modelVersion, durationMs }, audit };
    }

    return {
      result: { status: 'MATCH', personId: best.personId, score: best.score, modelVersion, durationMs },
      audit,
    };
  }
}
