import { FaceEmbedding } from '@face/core';
import { l2Normalize } from './vectorMath.js';

/**
 * Model family reserved for non-real embeddings.
 *
 * Anything stored under this family is a placeholder that does not describe a
 * face, so it must never enter recognition and must be purgeable in one query:
 *   DELETE FROM face_embeddings WHERE model_family = 'MOCK';
 *
 * Naming a stub after a real architecture ("ArcFace-…") is what makes such rows
 * indistinguishable later, once a genuine model is installed.
 */
export const MOCK_MODEL_FAMILY = 'MOCK';

export class MockEmbeddingExtractor {
  public readonly dimension = 512;
  public readonly modelFamily = MOCK_MODEL_FAMILY;
  public readonly modelVersion = 'mock-v0';
  public readonly preprocessingVersion = 'mock-v0';

  /**
   * Deterministic 512-d unit vector derived from a seed string.
   *
   * This is a wiring placeholder, not face recognition: the output depends on
   * the seed text, not on any image content. Two photos of the same person
   * produce unrelated vectors.
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
