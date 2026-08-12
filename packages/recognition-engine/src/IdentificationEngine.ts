import { FaceProfile, RecognitionCandidate, RecognitionResult } from '@face/core';
import { cosineSimilarity } from '@face/biometric';
import { SecurityLevel, ThresholdPolicy } from './ThresholdPolicy.js';

export interface GalleryEntry {
  profile: FaceProfile;
  centroid: Float32Array;
}

export class IdentificationEngine {
  public identify(
    probeVector: Float32Array,
    gallery: GalleryEntry[],
    topK = 5,
    level: SecurityLevel = 'BALANCED'
  ): RecognitionResult {
    const startTime = performance.now();
    const config = ThresholdPolicy.getThreshold(level);

    if (!gallery || gallery.length === 0) {
      return {
        status: 'UNKNOWN',
        modelVersion: 'N/A',
        durationMs: 0,
      };
    }

    const candidates: RecognitionCandidate[] = [];

    for (const entry of gallery) {
      const score = cosineSimilarity(probeVector, entry.centroid);
      candidates.push({
        personId: entry.profile.personId,
        profileId: entry.profile.id,
        score: Number(score.toFixed(4)),
      });
    }

    // Sort descending by score
    candidates.sort((a, b) => b.score - a.score);
    const topCandidates = candidates.slice(0, topK);

    const topCandidate = topCandidates[0];
    const durationMs = Math.round(performance.now() - startTime);

    if (topCandidate.score < config.matchThreshold) {
      return {
        status: 'UNKNOWN',
        candidates: topCandidates,
        modelVersion: gallery[0].profile.modelVersion,
        durationMs,
      };
    }

    // Ambiguity check against second best candidate
    if (topCandidates.length > 1) {
      const secondScore = topCandidates[1].score;
      if (topCandidate.score - secondScore < config.ambiguityMargin) {
        return {
          status: 'AMBIGUOUS',
          personId: topCandidate.personId,
          score: topCandidate.score,
          candidates: topCandidates,
          modelVersion: gallery[0].profile.modelVersion,
          durationMs,
        };
      }
    }

    return {
      status: 'MATCH',
      personId: topCandidate.personId,
      score: topCandidate.score,
      candidates: topCandidates,
      modelVersion: gallery[0].profile.modelVersion,
      durationMs,
    };
  }
}
