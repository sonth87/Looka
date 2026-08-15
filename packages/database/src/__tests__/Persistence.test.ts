import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PersistentStorageAdapter } from '../PersistentStorageAdapter.js';
import { AttendanceRepository, businessDayOf } from '../repositories/AttendanceRepository.js';
import { PersonRepository } from '../repositories/PersonRepository.js';

function tempDbPath(): { dir: string; file: string } {
  const dir = mkdtempSync(join(tmpdir(), 'face-db-'));
  return { dir, file: join(dir, 'test.db') };
}

async function seedPerson(adapter: PersistentStorageAdapter, id = 'p1'): Promise<void> {
  const repo = new PersonRepository(adapter);
  await repo.savePerson({
    id,
    displayName: 'Nguyen Van A',
    status: 'ACTIVE',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
}

/** attendance_records has a FK to attendance_sessions, so the session must exist first. */
function seedSession(adapter: PersistentStorageAdapter, id = 'sess_1'): void {
  adapter.run(
    `INSERT INTO attendance_sessions (id, device_id, mode, started_at, status)
     VALUES (?, 'kiosk_01', 'KIOSK', ?, 'ACTIVE')`,
    [id, Date.now()]
  );
}

describe('Persistence — data must survive a restart', () => {
  test('records written before close are still there after reopening', async () => {
    const { dir, file } = tempDbPath();
    try {
      const first = new PersistentStorageAdapter({ filename: file });
      await first.initialize();
      await seedPerson(first);
      await first.set('kiosk_mode', { fullscreen: true });
      first.close();

      assert.ok(existsSync(file), 'database file should exist on disk');

      // Reopen: this is the check the previous in-memory adapter could not pass.
      const second = new PersistentStorageAdapter({ filename: file });
      await second.initialize();

      const persons = new PersonRepository(second);
      const person = await persons.getPersonById('p1');
      assert.equal(person?.displayName, 'Nguyen Van A');

      const setting = await second.get<{ fullscreen: boolean }>('kiosk_mode');
      assert.deepEqual(setting, { fullscreen: true });
      second.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('migrations are idempotent and report the version reached', async () => {
    const { dir, file } = tempDbPath();
    try {
      const first = new PersistentStorageAdapter({ filename: file });
      await first.initialize();
      const firstRun = first.getMigrationReport();
      assert.equal(firstRun?.from, 0);
      assert.ok(firstRun!.applied.length >= 2);
      first.close();

      const second = new PersistentStorageAdapter({ filename: file });
      await second.initialize();
      const secondRun = second.getMigrationReport();
      assert.deepEqual(secondRun?.applied, [], 'second run should apply nothing');
      assert.equal(secondRun?.to, firstRun?.to);
      second.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('Failure must be loud, never a silent no-op', () => {
  test('using the adapter before initialize throws instead of pretending to work', async () => {
    const adapter = new PersistentStorageAdapter({ filename: ':memory:' });
    assert.throws(() => adapter.run('SELECT 1'), /DB_NOT_READY|not initialized/i);
    await assert.rejects(() => adapter.get('anything'), /DB_NOT_READY|not initialized/i);
    assert.equal(adapter.isHealthy(), false);
  });
});

describe('Attendance transaction', () => {
  test('attendance and its sync queue item are committed together', async () => {
    const adapter = new PersistentStorageAdapter({ filename: ':memory:' });
    await adapter.initialize();
    await seedPerson(adapter);
    seedSession(adapter);

    const repo = new AttendanceRepository(adapter);
    const now = Date.now();
    repo.recordAttendance({
      id: 'att_1',
      personId: 'p1',
      attendanceSessionId: 'sess_1',
      timestamp: now,
      identityScore: 0.91,
      livenessScore: null,
      qualityScore: null,
      modelVersion: 'mock-v0',
      policyVersion: 'BALANCED',
      deviceId: 'kiosk_01',
      businessDay: businessDayOf(now),
    });

    assert.equal(adapter.exec('SELECT * FROM attendance_records').length, 1);
    assert.equal(adapter.exec('SELECT * FROM sync_queue').length, 1);
    adapter.close();
  });

  test('a failing insert rolls back the whole record — no orphan rows', async () => {
    const adapter = new PersistentStorageAdapter({ filename: ':memory:' });
    await adapter.initialize();
    await seedPerson(adapter);
    seedSession(adapter);

    const repo = new AttendanceRepository(adapter);
    const now = Date.now();
    const params = {
      id: 'att_dup',
      personId: 'p1',
      attendanceSessionId: 'sess_1',
      timestamp: now,
      identityScore: 0.9,
      livenessScore: null,
      qualityScore: null,
      modelVersion: 'mock-v0',
      policyVersion: 'BALANCED',
      deviceId: 'kiosk_01',
      businessDay: businessDayOf(now),
    };

    repo.recordAttendance(params);
    // Same id → primary key conflict on the first insert of the transaction.
    assert.throws(() => repo.recordAttendance(params));

    assert.equal(adapter.exec('SELECT * FROM attendance_records').length, 1);
    assert.equal(adapter.exec('SELECT * FROM sync_queue').length, 1);
    adapter.close();
  });

  test('duplicate check-in on the same working day is blocked by the database', async () => {
    const adapter = new PersistentStorageAdapter({ filename: ':memory:' });
    await adapter.initialize();
    await seedPerson(adapter);
    seedSession(adapter);

    const repo = new AttendanceRepository(adapter);
    const now = Date.now();
    const base = {
      personId: 'p1',
      attendanceSessionId: 'sess_1',
      timestamp: now,
      type: 'CHECK_IN' as const,
      identityScore: 0.9,
      livenessScore: null,
      qualityScore: null,
      modelVersion: 'mock-v0',
      policyVersion: 'BALANCED',
      deviceId: 'kiosk_01',
      businessDay: businessDayOf(now),
    };

    repo.recordAttendance({ ...base, id: 'att_a' });
    // Different id, same person/type/day — the race two concurrent frames could win.
    assert.throws(() => repo.recordAttendance({ ...base, id: 'att_b' }), /UNIQUE|constraint/i);

    assert.equal(adapter.exec('SELECT * FROM attendance_records').length, 1);

    // CHECK_OUT on the same day is a different event and must be allowed.
    repo.recordAttendance({ ...base, id: 'att_c', type: 'CHECK_OUT' });
    assert.equal(adapter.exec('SELECT * FROM attendance_records').length, 2);
    adapter.close();
  });

  test('business day starts at 04:00 so a night shift lands on the previous day', () => {
    const at0130 = new Date(2026, 7, 15, 1, 30).getTime();
    const at0930 = new Date(2026, 7, 15, 9, 30).getTime();
    assert.equal(businessDayOf(at0130), '2026-08-14');
    assert.equal(businessDayOf(at0930), '2026-08-15');
  });
});
