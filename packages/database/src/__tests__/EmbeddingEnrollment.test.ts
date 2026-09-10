import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { PersistentStorageAdapter } from '../PersistentStorageAdapter.js';
import { EmbeddingEnrollmentRepository } from '../repositories/EmbeddingEnrollmentRepository.js';
import type { EnqueueEmbeddingInput } from '../repositories/EmbeddingEnrollmentRepository.js';

async function makeRepo() {
  const adapter = new PersistentStorageAdapter({ filename: ':memory:' });
  await adapter.initialize();
  return { adapter, repo: new EmbeddingEnrollmentRepository(adapter) };
}

const input = (over: Partial<EnqueueEmbeddingInput> = {}): EnqueueEmbeddingInput => ({
  id: 'sess_1:step-front:1',
  sessionId: 'sess_1',
  stepId: 'step-front',
  attempt: 1,
  userCode: 'USR047161',
  localImagePath: '/tmp/embeddings/sess_1/step-front-1.jpg',
  ...over,
});

describe('EmbeddingEnrollmentRepository — enqueue', () => {
  test('enqueue writes a PENDING row, readable back by id', async () => {
    const { adapter, repo } = await makeRepo();
    repo.enqueue(input());

    const row = repo.getById('sess_1:step-front:1');
    assert.ok(row);
    assert.equal(row!.sessionId, 'sess_1');
    assert.equal(row!.stepId, 'step-front');
    assert.equal(row!.attempt, 1);
    assert.equal(row!.userCode, 'USR047161');
    assert.equal(row!.status, 'PENDING');
    assert.equal(row!.embeddingId, null);
    assert.equal(row!.attempts, 0);
    adapter.close();
  });

  test('re-enqueuing the same id is a no-op, not a duplicate row', async () => {
    const { adapter, repo } = await makeRepo();
    repo.enqueue(input());
    repo.enqueue(input({ userCode: 'DIFFERENT_CODE' }));

    const rows = repo.listBySession('sess_1');
    assert.equal(rows.length, 1, 'ON CONFLICT(id) DO NOTHING must keep the first row, not overwrite it');
    assert.equal(rows[0].userCode, 'USR047161');
    adapter.close();
  });

  test('a retake — a different attempt of the same step — gets its own row (the server never overwrites on repeat POST)', async () => {
    const { adapter, repo } = await makeRepo();
    repo.enqueue(input({ id: 'sess_1:step-front:1', attempt: 1 }));
    repo.enqueue(input({ id: 'sess_1:step-front:2', attempt: 2 }));

    const rows = repo.listBySession('sess_1');
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map((r) => r.attempt).sort(), [1, 2]);
    adapter.close();
  });

  test('a session with no rows returns an empty list, not an error', async () => {
    const { adapter, repo } = await makeRepo();
    assert.deepEqual(repo.listBySession('sess_none'), []);
    adapter.close();
  });
});

describe('EmbeddingEnrollmentRepository — claimDue', () => {
  test('a fresh row is immediately due', async () => {
    const { adapter, repo } = await makeRepo();
    repo.enqueue(input());

    const due = repo.claimDue(Date.now());
    assert.equal(due.length, 1);
    assert.equal(due[0].id, 'sess_1:step-front:1');
    adapter.close();
  });

  test('SENDING and DONE rows are never claimed', async () => {
    const { adapter, repo } = await makeRepo();
    repo.enqueue(input({ id: 'a' }));
    repo.enqueue(input({ id: 'b' }));
    repo.markSending('a');
    repo.markDone('b', { embeddingId: 1, sourceImagePath: 'x.jpg' });

    assert.deepEqual(repo.claimDue(Date.now()), []);
    adapter.close();
  });

  test('a row scheduled for the future is not due yet, but is once the clock catches up', async () => {
    const { adapter, repo } = await makeRepo();
    repo.enqueue(input());
    repo.markRetry('sess_1:step-front:1', 'Không kết nối được máy chủ', 60_000);

    assert.deepEqual(repo.claimDue(Date.now()), [], 'not due yet — scheduled 60s out');
    const due = repo.claimDue(Date.now() + 61_000);
    assert.equal(due.length, 1);
    adapter.close();
  });

  test('FAILED rows (a real rejection, not a network failure) are never claimed again', async () => {
    const { adapter, repo } = await makeRepo();
    repo.enqueue(input());
    repo.markFailed('sess_1:step-front:1', { kind: 'IMAGE_REJECTED', error: 'Không phát hiện khuôn mặt nào trong ảnh.' });

    assert.deepEqual(repo.claimDue(Date.now()), []);
    adapter.close();
  });
});

describe('EmbeddingEnrollmentRepository — outcomes', () => {
  test('markDone records the server-assigned embeddingId/sourceImagePath and clears any prior error', async () => {
    const { adapter, repo } = await makeRepo();
    repo.enqueue(input());
    repo.markRetry('sess_1:step-front:1', 'timeout', 1_000);
    repo.markDone('sess_1:step-front:1', { embeddingId: 18, sourceImagePath: 'grace_hopper.jpg' });

    const row = repo.getById('sess_1:step-front:1');
    assert.equal(row!.status, 'DONE');
    assert.equal(row!.embeddingId, 18);
    assert.equal(row!.sourceImagePath, 'grace_hopper.jpg');
    assert.equal(row!.lastError, null);
    assert.ok(row!.doneAt !== null);
    adapter.close();
  });

  test('markDone tolerates a null embeddingId (the server schema marks it optional)', async () => {
    const { adapter, repo } = await makeRepo();
    repo.enqueue(input());
    repo.markDone('sess_1:step-front:1', { embeddingId: null, sourceImagePath: 'x.jpg' });

    assert.equal(repo.getById('sess_1:step-front:1')!.embeddingId, null);
    adapter.close();
  });

  test('markFailed records the failure kind and, for a duplicate identity, the conflicting user_code/similarity', async () => {
    const { adapter, repo } = await makeRepo();
    repo.enqueue(input());
    repo.markFailed('sess_1:step-front:1', {
      kind: 'DUPLICATE_IDENTITY',
      error: 'Khuôn mặt này đã được đăng ký cho mã TEST_LOOKA_VERIFY_20260910 (độ giống 1.00).',
      conflictUserCode: 'TEST_LOOKA_VERIFY_20260910',
      conflictSimilarity: 1.0,
    });

    const row = repo.getById('sess_1:step-front:1');
    assert.equal(row!.status, 'FAILED');
    assert.equal(row!.failureKind, 'DUPLICATE_IDENTITY');
    assert.equal(row!.conflictUserCode, 'TEST_LOOKA_VERIFY_20260910');
    assert.equal(row!.conflictSimilarity, 1.0);
    assert.equal(row!.attempts, 1, 'markFailed still counts as an attempt');
    adapter.close();
  });

  test('markRetry keeps the row PENDING, counts the attempt, and schedules next_retry_at in the future', async () => {
    const { adapter, repo } = await makeRepo();
    repo.enqueue(input());
    const before = Date.now();
    repo.markRetry('sess_1:step-front:1', 'Không kết nối được máy chủ nhận diện khuôn mặt', 5_000);

    const row = repo.getById('sess_1:step-front:1');
    assert.equal(row!.status, 'PENDING');
    assert.equal(row!.attempts, 1);
    assert.ok(row!.nextRetryAt! >= before + 5_000);
    assert.match(row!.lastError!, /Không kết nối được/);
    adapter.close();
  });

  test('markGaveUp records a FAILED row with kind GAVE_UP, distinct from a real server rejection', async () => {
    const { adapter, repo } = await makeRepo();
    repo.enqueue(input());
    repo.markGaveUp('sess_1:step-front:1', 'Hết số lần thử lại');

    const row = repo.getById('sess_1:step-front:1');
    assert.equal(row!.status, 'FAILED');
    assert.equal(row!.failureKind, 'GAVE_UP');
    adapter.close();
  });
});

describe('EmbeddingEnrollmentRepository — recoverInterrupted', () => {
  test('a row left SENDING by a crashed process is returned to PENDING on startup', async () => {
    const { adapter, repo } = await makeRepo();
    repo.enqueue(input());
    repo.markSending('sess_1:step-front:1');

    const recovered = repo.recoverInterrupted();
    assert.equal(recovered, 1);
    assert.equal(repo.getById('sess_1:step-front:1')!.status, 'PENDING');
    adapter.close();
  });

  test('recovering an empty queue is a harmless no-op', async () => {
    const { adapter, repo } = await makeRepo();
    assert.equal(repo.recoverInterrupted(), 0);
    adapter.close();
  });
});
