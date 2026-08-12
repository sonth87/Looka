import { FaceEmbedding } from '@face/core';
import { l2Normalize } from './vectorMath.js';

export class MockEmbeddingExtractor {
  public readonly dimension = 512;
  public readonly modelFamily = 'ArcFace-Mock';
  public readonly modelVersion = 'v1.0.0';
  public readonly preprocessingVersion = 'v1.0.0';

  /**
   * Generates a deterministic 512-dimensional normalized embedding based on seed string.
   */
  public generateEmbedding(seed: string): Float32Array {
    const raw = new Float32Array(this.dimension);
    let hash = 0;
    for (let i = 0; i < seed.length; i++) {
      hash = (hash << 5) - hash + seed.charCodeAt(i);
      hash |= 0;
    }

    for (let i = 0; i < this.dimension; i++) {
      const x = Math.sin(hash + i) * 10000;
      raw[i] = (x - Math.floor(x)) * 2 - 1;
    }

    return l2Normalize(raw);
  }

  public extractFromSample(sampleId: string): FaceEmbedding {
    const vector = this.generateEmbedding(sampleId);
    return {
      vector,
      dimension: this.dimension,
      modelFamily: this.modelFamily,
      modelVersion: this.modelVersion,
      preprocessingVersion: this.preprocessingVersion,
      similarityMetric: 'cosine',
    };
  }
}
