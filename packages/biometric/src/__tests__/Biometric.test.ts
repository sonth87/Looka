import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { l2Normalize, cosineSimilarity } from '../vectorMath.js';
import { MockEmbeddingExtractor } from '../MockEmbeddingExtractor.js';
import { ProfileBuilder } from '../ProfileBuilder.js';
import { CaptureSession } from '@face/core';

describe('Biometric Vector Math & ProfileBuilder', () => {
  test('l2Normalize should normalize vector to length 1', () => {
    const raw = new Float32Array([3, 4]); // length = 5
    const norm = l2Normalize(raw);
    assert.ok(Math.abs(norm[0] - 0.6) < 1e-5);
    assert.ok(Math.abs(norm[1] - 0.8) < 1e-5);
  });

  test('cosineSimilarity should return 1 for identical vectors and 0 for orthogonal', () => {
    const a = new Float32Array([1, 0, 0]);
    const b = new Float32Array([1, 0, 0]);
    const c = new Float32Array([0, 1, 0]);

    assert.ok(Math.abs(cosineSimilarity(a, b) - 1.0) < 1e-5);
    assert.ok(Math.abs(cosineSimilarity(a, c) - 0.0) < 1e-5);
  });

  test('MockEmbeddingExtractor should produce 512-d normalized vectors', () => {
    const extractor = new MockEmbeddingExtractor();
    const vec1 = extractor.generateEmbedding('face_sample_1');
    const vec2 = extractor.generateEmbedding('face_sample_1');
    const vec3 = extractor.generateEmbedding('face_sample_2');

    assert.equal(vec1.length, 512);
    assert.ok(Math.abs(cosineSimilarity(vec1, vec2) - 1.0) < 1e-5); // Deterministic
    assert.ok(cosineSimilarity(vec1, vec3) < 0.99);
  });

  test('ProfileBuilder should aggregate multi-pose session into FaceProfile', () => {
    const builder = new ProfileBuilder();
    const session: CaptureSession = {
      id: 'sess_999',
      workflowId: 'standard-enrollment',
      workflowVersion: 1,
      startedAt: Date.now(),
      status: 'COMPLETED',
      steps: [
        { stepId: 'step-front', stepType: 'FRONT', status: 'COMPLETED', attempts: 1, capturedImagePath: 'c1.jpg' },
        { stepId: 'step-left', stepType: 'LEFT', status: 'COMPLETED', attempts: 1, capturedImagePath: 'c2.jpg' },
        { stepId: 'step-right', stepType: 'RIGHT', status: 'COMPLETED', attempts: 1, capturedImagePath: 'c3.jpg' },
      ],
    };

    const { profile, centroid } = builder.buildProfileFromSession('person_001', session);

    assert.equal(profile.personId, 'person_001');
    assert.equal(profile.embeddings.length, 3);
    assert.ok(centroid !== undefined);
    assert.equal(centroid.length, 512);
  });
});
