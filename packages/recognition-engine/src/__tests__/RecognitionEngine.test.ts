import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { VerificationEngine } from '../VerificationEngine.js';
import { IdentificationEngine, GalleryEntry } from '../IdentificationEngine.js';
import { MockEmbeddingExtractor, ProfileBuilder } from '@face/biometric';
import { CaptureSession } from '@face/core';

describe('RecognitionEngine (1:1 & 1:N)', () => {
  const extractor = new MockEmbeddingExtractor();
  const builder = new ProfileBuilder();

  const createDummySession = (): CaptureSession => ({
    id: 'sess_1',
    workflowId: 'w1',
    workflowVersion: 1,
    startedAt: Date.now(),
    status: 'COMPLETED',
    steps: [
      { stepId: 'sample_person_A', stepType: 'FRONT', status: 'COMPLETED', attempts: 1, capturedImagePath: 'a.jpg' },
    ],
  });

  const sessionA = createDummySession();
  const { profile: profileA, centroid: centroidA } = builder.buildProfileFromSession('person_A', sessionA);

  test('VerificationEngine (1:1) should return MATCH for identical vector', () => {
    const verifier = new VerificationEngine();
    const result = verifier.verify(centroidA, profileA, centroidA, 'BALANCED');

    assert.equal(result.status, 'MATCH');
    assert.equal(result.personId, 'person_A');
    assert.ok(result.score !== undefined && result.score > 0.99);
  });

  test('VerificationEngine (1:1) should return UNKNOWN for different vector', () => {
    const verifier = new VerificationEngine();
    const differentVector = extractor.generateEmbedding('unrelated_person');
    const result = verifier.verify(differentVector, profileA, centroidA, 'BALANCED');

    assert.equal(result.status, 'UNKNOWN');
    assert.equal(result.personId, undefined);
  });

  test('IdentificationEngine (1:N) should identify top matching candidate', () => {
    const identifier = new IdentificationEngine();
    const gallery: GalleryEntry[] = [
      { profile: profileA, centroid: centroidA },
    ];

    const result = identifier.identify(centroidA, gallery, 5, 'BALANCED');

    assert.equal(result.status, 'MATCH');
    assert.equal(result.personId, 'person_A');
  });

  test('IdentificationEngine (1:N) should mark AMBIGUOUS if top 2 scores are too close', () => {
    const identifier = new IdentificationEngine();

    // Create 2 profiles with nearly identical vectors
    const vecA = new Float32Array(512).fill(1.0); // Normalized
    for (let i = 0; i < 512; i++) vecA[i] = 1 / Math.sqrt(512);

    const vecB = vecA.slice();
    vecB[0] += 0.01; // Slightly perturbed

    const profile1 = { ...profileA, id: 'p1', personId: 'person_1' };
    const profile2 = { ...profileA, id: 'p2', personId: 'person_2' };

    const gallery: GalleryEntry[] = [
      { profile: profile1, centroid: vecA },
      { profile: profile2, centroid: vecB },
    ];

    const result = identifier.identify(vecA, gallery, 5, 'BALANCED');

    assert.equal(result.status, 'AMBIGUOUS');
    assert.equal(result.personId, 'person_1');
  });
});
