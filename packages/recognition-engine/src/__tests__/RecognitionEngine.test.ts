import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { VerificationEngine } from '../VerificationEngine.js';
import { IdentificationEngine, GalleryEntry, ModelIdentity } from '../IdentificationEngine.js';
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

  const model: ModelIdentity = {
    modelFamily: profileA.modelFamily,
    modelVersion: profileA.modelVersion,
    preprocessingVersion: profileA.preprocessingVersion,
  };

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
    const gallery: GalleryEntry[] = [{ profile: profileA, centroid: centroidA }];

    const { result } = identifier.identify(centroidA, gallery, { requiredModel: model });

    assert.equal(result.status, 'MATCH');
    assert.equal(result.personId, 'person_A');
  });

  test('IdentificationEngine (1:N) should mark AMBIGUOUS if top 2 scores are too close', () => {
    const identifier = new IdentificationEngine();

    const vecA = new Float32Array(512);
    for (let i = 0; i < 512; i++) vecA[i] = 1 / Math.sqrt(512);
    const vecB = vecA.slice();
    vecB[0] += 0.01;

    const profile1 = { ...profileA, id: 'p1', personId: 'person_1' };
    const profile2 = { ...profileA, id: 'p2', personId: 'person_2' };

    const gallery: GalleryEntry[] = [
      { profile: profile1, centroid: vecA },
      { profile: profile2, centroid: vecB },
    ];

    const { result, audit } = identifier.identify(vecA, gallery, { requiredModel: model });

    assert.equal(result.status, 'AMBIGUOUS');
    // An ambiguous outcome must not name anyone: showing the nearest candidate
    // would turn the kiosk into an identity-lookup tool.
    assert.equal(result.personId, undefined);
    assert.equal(result.score, undefined);
    // The candidates are still available for later review of a disputed decision.
    assert.equal(audit.candidates.length, 2);
    assert.equal(audit.candidates[0].personId, 'person_1');
  });

  test('UNKNOWN result carries no identity either', () => {
    const identifier = new IdentificationEngine();
    const gallery: GalleryEntry[] = [{ profile: profileA, centroid: centroidA }];
    const stranger = extractor.generateEmbedding('someone_not_enrolled');

    const { result, audit } = identifier.identify(stranger, gallery, { requiredModel: model });

    assert.equal(result.status, 'UNKNOWN');
    assert.equal(result.personId, undefined);
    assert.equal(audit.candidates.length, 1);
  });

  test('gallery entries from another embedding space are excluded, not compared', () => {
    const identifier = new IdentificationEngine();

    const foreign = {
      ...profileA,
      id: 'p_foreign',
      personId: 'person_foreign',
      modelVersion: 'some-other-version',
    };
    const gallery: GalleryEntry[] = [{ profile: foreign, centroid: centroidA }];

    let reported: { skipped: number; total: number } | null = null;
    const { result, audit } = identifier.identify(centroidA, gallery, {
      requiredModel: model,
      onIncompatible: (info) => {
        reported = info;
      },
    });

    // Identical vector, yet no match: the entry does not belong to this space.
    assert.equal(result.status, 'UNKNOWN');
    assert.equal(audit.gallerySize, 0);
    assert.equal(audit.skippedIncompatible, 1);
    // And it is reported rather than dropped silently.
    assert.equal(reported!.skipped, 1);
    assert.equal(reported!.total, 1);
  });

  test('modelVersion in the result describes the space actually searched', () => {
    const identifier = new IdentificationEngine();
    const { result } = identifier.identify(centroidA, [], { requiredModel: model });
    assert.equal(
      result.modelVersion,
      `${model.modelFamily}/${model.modelVersion}/${model.preprocessingVersion}`
    );
  });
});

describe('Mock embeddings must not reach recognition', () => {
  test('a profile built from mock embeddings is DRAFT, never ACTIVE', () => {
    const builder = new ProfileBuilder();
    const session: CaptureSession = {
      id: 'sess_mock',
      workflowId: 'w1',
      workflowVersion: 1,
      startedAt: Date.now(),
      status: 'COMPLETED',
      steps: [
        { stepId: 's1', stepType: 'FRONT', status: 'COMPLETED', attempts: 1, capturedImagePath: 'a.jpg' },
      ],
    };

    const { profile } = builder.buildProfileFromSession('person_mock', session);

    assert.equal(profile.modelFamily, 'MOCK');
    assert.equal(profile.status, 'DRAFT');
  });
});
