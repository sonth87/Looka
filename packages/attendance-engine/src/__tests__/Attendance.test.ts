import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { AttendanceService } from '../AttendanceService.js';
import { SQLiteStorageAdapter, AttendanceRepository } from '@face/database';
import { MockEmbeddingExtractor, ProfileBuilder } from '@face/biometric';
import { CaptureSession } from '@face/core';

describe('AttendanceService & Anti-duplicate Cooldown Window', () => {
  const extractor = new MockEmbeddingExtractor();
  const builder = new ProfileBuilder();

  const dummySession: CaptureSession = {
    id: 'sess_att_1',
    workflowId: 'w1',
    workflowVersion: 1,
    startedAt: Date.now(),
    status: 'COMPLETED',
    steps: [
      { stepId: 'sample_person_att', stepType: 'FRONT', status: 'COMPLETED', attempts: 1, capturedImagePath: 'a.jpg' },
    ],
  };

  const { profile: profileA, centroid: centroidA } = builder.buildProfileFromSession('person_att_A', dummySession);
  const gallery = [{ profile: profileA, centroid: centroidA }];

  test('should record attendance on first check-in and prevent duplicates within cooldown window', async () => {
    const adapter = new SQLiteStorageAdapter();
    await adapter.initialize();
    const repo = new AttendanceRepository(adapter);

    const attendanceService = new AttendanceService(repo, { cooldownWindowMs: 300000 });

    const startTime = 1000000;

    // 1. First recognition -> RECORDED
    const res1 = await attendanceService.processRecognition(centroidA, gallery, startTime);
    assert.equal(res1.status, 'RECORDED');
    assert.equal(res1.personId, 'person_att_A');

    // 2. Second recognition after 2 minutes (120,000ms) -> ALREADY_RECORDED
    const res2 = await attendanceService.processRecognition(centroidA, gallery, startTime + 120000);
    assert.equal(res2.status, 'ALREADY_RECORDED');
    assert.equal(res2.personId, 'person_att_A');

    // 3. Third recognition after 6 minutes (360,000ms) -> RECORDED
    const res3 = await attendanceService.processRecognition(centroidA, gallery, startTime + 360000);
    assert.equal(res3.status, 'RECORDED');
    assert.equal(res3.personId, 'person_att_A');
  });

  test('should return REJECTED for unknown person', async () => {
    const adapter = new SQLiteStorageAdapter();
    await adapter.initialize();
    const repo = new AttendanceRepository(adapter);

    const attendanceService = new AttendanceService(repo);
    const unknownVector = extractor.generateEmbedding('unrelated_stranger');

    const res = await attendanceService.processRecognition(unknownVector, gallery);
    assert.equal(res.status, 'REJECTED');
  });
});
