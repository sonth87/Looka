import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { AttendanceService } from '../AttendanceService.js';
import { PersistentStorageAdapter } from '@face/database/node';
import { AttendanceRepository, PersonRepository } from '@face/database';
import { MockEmbeddingExtractor, ProfileBuilder } from '@face/biometric';
import { CaptureSession, LivenessResult } from '@face/core';
import type { ModelIdentity, GalleryEntry } from '@face/recognition-engine';

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
const gallery: GalleryEntry[] = [{ profile: profileA, centroid: centroidA }];
const model: ModelIdentity = {
  modelFamily: profileA.modelFamily,
  modelVersion: profileA.modelVersion,
  preprocessingVersion: profileA.preprocessingVersion,
};

async function makeService(config = {}) {
  const adapter = new PersistentStorageAdapter({ filename: ':memory:' });
  await adapter.initialize();

  const persons = new PersonRepository(adapter);
  await persons.savePerson({
    id: 'person_att_A',
    displayName: 'Person A',
    status: 'ACTIVE',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });

  adapter.run(
    `INSERT INTO attendance_sessions (id, device_id, mode, started_at, status)
     VALUES ('kiosk_session', 'kiosk_01', 'KIOSK', ?, 'ACTIVE')`,
    [Date.now()]
  );

  const repo = new AttendanceRepository(adapter);
  const service = new AttendanceService(repo, persons, {
    attendanceSessionId: 'kiosk_session',
    // Most cases here exercise the business rules, so they decide on one frame.
    // Multi-frame confirmation has its own suite at the bottom.
    temporal: null,
    ...config,
  });
  return { adapter, repo, persons, service };
}

describe('AttendanceService — cooldown and per-day uniqueness', () => {
  test('first check-in records; a repeat inside the cooldown does not', async () => {
    const { service, adapter } = await makeService({ cooldownWindowMs: 300_000 });
    const t0 = new Date(2026, 7, 20, 8, 0).getTime();

    const first = await service.processRecognition({ probeVector: centroidA, gallery, model, currentTime: t0 });
    assert.equal(first.status, 'RECORDED');
    assert.equal(first.personId, 'person_att_A');

    const second = await service.processRecognition({
      probeVector: centroidA,
      gallery,
      model,
      currentTime: t0 + 120_000,
    });
    assert.equal(second.status, 'ALREADY_RECORDED');

    assert.equal(adapter.exec('SELECT * FROM attendance_records').length, 1);
    adapter.close();
  });

  test('after the cooldown expires, the per-day rule still blocks a second check-in', async () => {
    const { service, adapter } = await makeService({ cooldownWindowMs: 300_000 });
    const t0 = new Date(2026, 7, 20, 8, 0).getTime();

    await service.processRecognition({ probeVector: centroidA, gallery, model, currentTime: t0 });

    // Six minutes later: past the cooldown, same working day.
    const later = await service.processRecognition({
      probeVector: centroidA,
      gallery,
      model,
      currentTime: t0 + 360_000,
    });
    assert.equal(later.status, 'ALREADY_RECORDED');
    assert.equal(adapter.exec('SELECT * FROM attendance_records').length, 1);
    adapter.close();
  });

  test('CHECK_OUT is a separate event on the same day', async () => {
    const { service, adapter } = await makeService();
    const t0 = new Date(2026, 7, 20, 8, 0).getTime();

    await service.processRecognition({ probeVector: centroidA, gallery, model, currentTime: t0 });
    const out = await service.processRecognition({
      probeVector: centroidA,
      gallery,
      model,
      type: 'CHECK_OUT',
      currentTime: t0 + 8 * 3600_000,
    });

    assert.equal(out.status, 'RECORDED');
    assert.equal(adapter.exec('SELECT * FROM attendance_records').length, 2);
    adapter.close();
  });

  test('the next working day allows a new check-in', async () => {
    const { service, adapter } = await makeService();
    const day1 = new Date(2026, 7, 20, 8, 0).getTime();
    const day2 = new Date(2026, 7, 21, 8, 0).getTime();

    await service.processRecognition({ probeVector: centroidA, gallery, model, currentTime: day1 });
    const next = await service.processRecognition({ probeVector: centroidA, gallery, model, currentTime: day2 });

    assert.equal(next.status, 'RECORDED');
    assert.equal(adapter.exec('SELECT * FROM attendance_records').length, 2);
    adapter.close();
  });
});

describe('AttendanceService — gates before storage', () => {
  test('an unrecognised face is rejected', async () => {
    const { service, adapter } = await makeService();
    const stranger = extractor.generateEmbedding('unrelated_stranger');

    const res = await service.processRecognition({ probeVector: stranger, gallery, model });
    assert.equal(res.status, 'REJECTED');
    assert.equal(adapter.exec('SELECT * FROM attendance_records').length, 0);
    adapter.close();
  });

  test('an inactive person is rejected even when recognised', async () => {
    const { service, persons, adapter } = await makeService();
    await persons.savePerson({
      id: 'person_att_A',
      displayName: 'Person A',
      status: 'INACTIVE',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    const res = await service.processRecognition({ probeVector: centroidA, gallery, model });
    assert.equal(res.status, 'REJECTED');
    assert.match(res.message ?? '', /INACTIVE/);
    adapter.close();
  });

  test('when liveness is required, a missing check rejects before identity is used', async () => {
    const { service, adapter } = await makeService({ requireLiveness: true });

    const res = await service.processRecognition({ probeVector: centroidA, gallery, model });
    assert.equal(res.status, 'REJECTED');
    assert.equal(adapter.exec('SELECT * FROM attendance_records').length, 0);
    adapter.close();
  });

  test('liveness score is stored as measured, and stays null when not evaluated', async () => {
    const { service, adapter } = await makeService();
    const t0 = new Date(2026, 7, 20, 8, 0).getTime();

    await service.processRecognition({ probeVector: centroidA, gallery, model, currentTime: t0 });
    const withoutLiveness = adapter.exec<{ liveness_score: number | null }>(
      'SELECT liveness_score FROM attendance_records'
    );
    // Not measured → recorded as null, never as a passing 1.0.
    assert.equal(withoutLiveness[0].liveness_score, null);
    adapter.close();

    const second = await makeService();
    const liveness: LivenessResult = {
      isLive: true,
      score: 0.93,
      status: 'LIVE',
      modelVersion: 'mock-v0',
      durationMs: 5,
    };
    await second.service.processRecognition({
      probeVector: centroidA,
      gallery,
      model,
      liveness,
      qualityScore: 0.81,
      currentTime: t0,
    });
    const stored = second.adapter.exec<{ liveness_score: number; quality_score: number }>(
      'SELECT liveness_score, quality_score FROM attendance_records'
    );
    assert.equal(stored[0].liveness_score, 0.93);
    assert.equal(stored[0].quality_score, 0.81);
    second.adapter.close();
  });

  test('a gallery from another embedding space produces no attendance', async () => {
    const { service, adapter } = await makeService();
    const foreignGallery: GalleryEntry[] = [
      { profile: { ...profileA, modelVersion: 'other-version' }, centroid: centroidA },
    ];

    const res = await service.processRecognition({ probeVector: centroidA, gallery: foreignGallery, model });
    assert.equal(res.status, 'REJECTED');
    assert.equal(adapter.exec('SELECT * FROM attendance_records').length, 0);
    adapter.close();
  });
});

describe('AttendanceService — multi-frame confirmation', () => {
  test('a single frame never creates an attendance record', async () => {
    // The whole point: one unlucky frame must not be able to attribute
    // attendance to someone, because the record keeps that mistake.
    const { service, adapter } = await makeService({ temporal: { n: 5, m: 3 } });

    const first = await service.processRecognition({
      probeVector: centroidA,
      gallery,
      model,
      currentTime: 1000,
    });

    assert.equal(first.status, 'PENDING');
    assert.equal(adapter.exec('SELECT * FROM attendance_records').length, 0);
    adapter.close();
  });

  test('records once enough frames agree', async () => {
    const { service, adapter } = await makeService({ temporal: { n: 5, m: 3 } });

    const a = await service.processRecognition({ probeVector: centroidA, gallery, model, currentTime: 1000 });
    const b = await service.processRecognition({ probeVector: centroidA, gallery, model, currentTime: 1100 });
    const c = await service.processRecognition({ probeVector: centroidA, gallery, model, currentTime: 1200 });

    assert.equal(a.status, 'PENDING');
    assert.equal(b.status, 'PENDING');
    assert.equal(c.status, 'RECORDED');
    assert.equal(c.personId, 'person_att_A');
    assert.equal(adapter.exec('SELECT * FROM attendance_records').length, 1);
    adapter.close();
  });

  test('a person standing there afterwards does not generate an event per frame', async () => {
    const { service, adapter } = await makeService({ temporal: { n: 5, m: 3 } });

    for (const t of [1000, 1100, 1200]) {
      await service.processRecognition({ probeVector: centroidA, gallery, model, currentTime: t });
    }
    for (const t of [1300, 1400, 1500, 1600]) {
      const r = await service.processRecognition({ probeVector: centroidA, gallery, model, currentTime: t });
      assert.ok(r.status === 'ALREADY_RECORDED' || r.status === 'PENDING', `got ${r.status}`);
    }

    assert.equal(adapter.exec('SELECT * FROM attendance_records').length, 1);
    adapter.close();
  });

  test('PENDING is progress, not failure — it carries no rejection', async () => {
    const { service, adapter } = await makeService({ temporal: { n: 5, m: 3 } });
    const seen: string[] = [];
    service.on('pending', (r: { status: string }) => seen.push(r.status));

    await service.processRecognition({ probeVector: centroidA, gallery, model, currentTime: 1000 });

    assert.deepEqual(seen, ['PENDING']);
    adapter.close();
  });

  test('an unrecognised face still rejects rather than waiting for frames', async () => {
    const { service, adapter } = await makeService({ temporal: { n: 5, m: 3 } });
    const stranger = extractor.generateEmbedding('unrelated_stranger');

    // Not a match on any frame, so the window can never agree on anyone.
    for (const t of [1000, 1100, 1200, 1300]) {
      const r = await service.processRecognition({ probeVector: stranger, gallery, model, currentTime: t });
      assert.equal(r.status, 'PENDING');
    }
    assert.equal(adapter.exec('SELECT * FROM attendance_records').length, 0);
    adapter.close();
  });

  test('resetTemporal clears the confirmation window', async () => {
    const { service, adapter } = await makeService({ temporal: { n: 5, m: 3 } });

    await service.processRecognition({ probeVector: centroidA, gallery, model, currentTime: 1000 });
    await service.processRecognition({ probeVector: centroidA, gallery, model, currentTime: 1100 });
    service.resetTemporal();

    const third = await service.processRecognition({ probeVector: centroidA, gallery, model, currentTime: 1200 });
    assert.equal(third.status, 'PENDING', 'evidence was discarded, so it starts again');
    adapter.close();
  });
});
