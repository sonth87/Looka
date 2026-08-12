import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SQLiteStorageAdapter } from '../SQLiteStorageAdapter.js';
import { SessionRepository } from '../repositories/SessionRepository.js';
import { PersonRepository } from '../repositories/PersonRepository.js';
import { FaceProfileRepository } from '../repositories/FaceProfileRepository.js';
import { CaptureSession, FaceProfile } from '@face/core';

describe('SQLiteStorageAdapter & Repositories', () => {
  test('should initialize and perform get/set/delete operations', async () => {
    const adapter = new SQLiteStorageAdapter();
    await adapter.initialize();

    await adapter.set('test_key', { foo: 'bar' });
    const val = await adapter.get<{ foo: string }>('test_key');
    assert.deepEqual(val, { foo: 'bar' });

    await adapter.delete('test_key');
    const valAfterDelete = await adapter.get('test_key');
    assert.equal(valAfterDelete, null);
  });

  test('SessionRepository should save and retrieve capture session', async () => {
    const adapter = new SQLiteStorageAdapter();
    await adapter.initialize();
    const repo = new SessionRepository(adapter);

    const session: CaptureSession = {
      id: 'sess_123',
      workflowId: 'face-enrollment',
      workflowVersion: 1,
      startedAt: Date.now(),
      status: 'RUNNING',
      steps: [
        {
          stepId: 'front',
          stepType: 'FRONT',
          status: 'COMPLETED',
          attempts: 1,
          capturedImagePath: 'captures/sess_123/front.jpg',
        },
      ],
    };

    await repo.saveSession(session);
    const retrieved = await repo.getSession('sess_123');

    assert.ok(retrieved !== null);
    assert.equal(retrieved?.id, 'sess_123');
    assert.equal(retrieved?.steps[0].status, 'COMPLETED');
  });

  test('PersonRepository & FaceProfileRepository should save person and active profiles', async () => {
    const adapter = new SQLiteStorageAdapter();
    await adapter.initialize();
    const personRepo = new PersonRepository(adapter);
    const profileRepo = new FaceProfileRepository(adapter);

    await personRepo.savePerson({
      id: 'p_001',
      displayName: 'Trần Văn B',
      employeeCode: 'EMP002',
      status: 'ACTIVE',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    const person = await personRepo.getPersonById('p_001');
    assert.equal(person?.displayName, 'Trần Văn B');

    const profile: FaceProfile = {
      id: 'prof_001',
      personId: 'p_001',
      profileVersion: 1,
      status: 'ACTIVE',
      modelFamily: 'ArcFace',
      modelVersion: 'v1.0',
      preprocessingVersion: 'v1.0',
      embeddings: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const dummyVector = new Float32Array(512).fill(0.5);

    await profileRepo.saveProfile({
      profile,
      embeddings: [
        {
          id: 'emb_001',
          embedding: {
            vector: dummyVector,
            dimension: 512,
            modelFamily: 'ArcFace',
            modelVersion: 'v1.0',
            preprocessingVersion: 'v1.0',
            similarityMetric: 'cosine',
          },
          pose: { yaw: 0, pitch: 0, roll: 0 },
          qualityScore: 0.9,
          taskType: 'FRONT',
        },
      ],
    });

    const activeProfiles = await profileRepo.getActiveProfiles();
    assert.equal(activeProfiles.length, 1);
    assert.equal(activeProfiles[0].profile.id, 'prof_001');
    assert.equal(activeProfiles[0].vectors[0].length, 512);
  });
});
