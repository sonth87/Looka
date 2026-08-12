import { CaptureSession, FaceProfile, ProfileEmbeddingMetadata } from '@face/core';
import { MockEmbeddingExtractor } from './MockEmbeddingExtractor.js';
import { l2Normalize } from './vectorMath.js';

export class ProfileBuilder {
  private extractor = new MockEmbeddingExtractor();

  public buildProfileFromSession(personId: string, session: CaptureSession): { profile: FaceProfile; centroid: Float32Array } {
    if (!session.steps || session.steps.length === 0) {
      throw new Error('Cannot build profile from empty capture session.');
    }

    const embeddingsMetadata: ProfileEmbeddingMetadata[] = [];
    const dimension = this.extractor.dimension;
    const weightedSum = new Float32Array(dimension);
    let totalWeight = 0;

    for (const step of session.steps) {
      if (step.status !== 'COMPLETED' || !step.capturedImagePath) continue;

      const pose = step.pose || { yaw: 0, pitch: 0, roll: 0 };
      const qualityScore = step.quality?.overallScore || 0.8;
      const embedding = this.extractor.extractFromSample(step.stepId);

      const metadata: ProfileEmbeddingMetadata = {
        id: `emb_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        taskType: step.stepType,
        pose,
        qualityScore,
        createdAt: Date.now(),
      };
      embeddingsMetadata.push(metadata);

      const weight = step.stepType === 'FRONT' ? 2.0 : 1.0;
      for (let i = 0; i < dimension; i++) {
        weightedSum[i] += embedding.vector[i] * weight;
      }
      totalWeight += weight;
    }

    if (embeddingsMetadata.length === 0) {
      throw new Error('No completed steps with captured images found in session.');
    }

    // Centroid vector normalized
    const centroid = l2Normalize(weightedSum);
    const profileId = `prof_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    const profile: FaceProfile = {
      id: profileId,
      personId,
      profileVersion: 1,
      status: 'ACTIVE',
      modelFamily: this.extractor.modelFamily,
      modelVersion: this.extractor.modelVersion,
      preprocessingVersion: this.extractor.preprocessingVersion,
      embeddings: embeddingsMetadata,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    return { profile, centroid };
  }
}
