import { FaceProfile, RecognitionResult } from '@face/core';
import { cosineSimilarity } from '@face/biometric';
import { SecurityLevel, ThresholdPolicy } from './ThresholdPolicy.js';

export class VerificationEngine {
  public verify(
    probeVector: Float32Array,
    targetProfile: FaceProfile,
    targetCentroid: Float32Array,
    level: SecurityLevel = 'BALANCED'
  ): RecognitionResult {
    const startTime = performance.now();
    const config = ThresholdPolicy.getThreshold(level);

    const score = cosineSimilarity(probeVector, targetCentroid);
    const durationMs = Math.round(performance.now() - startTime);

    const isMatch = score >= config.matchThreshold;

    return {
      status: isMatch ? 'MATCH' : 'UNKNOWN',
      personId: isMatch ? targetProfile.personId : undefined,
      score: Number(score.toFixed(4)),
      modelVersion: targetProfile.modelVersion,
      durationMs,
    };
  }
}
