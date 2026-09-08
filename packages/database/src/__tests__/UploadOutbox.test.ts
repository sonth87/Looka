import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { PersistentStorageAdapter } from '../PersistentStorageAdapter.js';
import { UploadOutboxRepository, nextRetryDelayMs } from '../repositories/UploadOutboxRepository.js';

async function makeRepo() {
  const adapter = new PersistentStorageAdapter({ filename: ':memory:' });
  await adapter.initialize();
  return { adapter, repo: new UploadOutboxRepository(adapter) };
}

const job = (id: string, over: Partial<Parameters<UploadOutboxRepository['enqueue']>[0]> = {}) => ({
  id,
  sessionId: 'sess_1',
  kind: 'raw',
  localPath: `/data/${id}.jpg`,
  virtualPath: `raw/sess_1/${id}.jpg`,
  sha256: 'a'.repeat(64),
  sizeBytes: 1024,
  idemKey: `sess_1:${id}:1:raw`,
  uploadId: `upload-${id}`,
  ...over,
});

describe('UploadOutbox — queueing', () => {
  test('a queued job is staged, not due, until the session is approved', async () => {
    const { adapter, repo } = await makeRepo();
    repo.enqueue(job('j1'));

    // Captured and queued, but nobody has reviewed it yet — must not be
    // picked up by the background worker.
    assert.equal(repo.claimDue(Date.now()).length, 0);
    assert.equal(repo.getById('j1')!.approvedAt, null);

    repo.approveSession('sess_1');

    const due = repo.claimDue(Date.now());
    assert.equal(due.length, 1);
    assert.equal(due[0].virtualPath, 'raw/sess_1/j1.jpg');
    assert.equal(due[0].status, 'PENDING');
    assert.ok(due[0].approvedAt !== null && due[0].approvedAt <= Date.now());
    adapter.close();
  });

  test('re-queueing the same capture does not create a second job', async () => {
    // A crash between writing the image and confirming the queue insert would
    // otherwise upload the same photo twice.
    const { adapter, repo } = await makeRepo();
    repo.enqueue(job('j1'));
    repo.enqueue(job('j1-retry', { idemKey: 'sess_1:j1:1:raw' }));

    assert.equal(adapter.exec('SELECT * FROM upload_outbox').length, 1);
    adapter.close();
  });

  test('enqueue with an explicit approvedAt skips the staging window entirely (the video path)', async () => {
    const { adapter, repo } = await makeRepo();
    const now = Date.now();
    repo.enqueue(job('vid1', { kind: 'video', idemKey: 'sess_1:stream-1:1:video', approvedAt: now }));

    const item = repo.getById('vid1')!;
    assert.equal(item.approvedAt, now);
    assert.deepEqual(repo.claimDue(Date.now()).map((d) => d.id), ['vid1'], 'already approved — visible to the worker immediately');
    adapter.close();
  });

  test('a dependent job waits until its parent has been uploaded', async () => {
    // The card photo is derived from the raw capture and must not be sent first.
    const { adapter, repo } = await makeRepo();
    repo.enqueue(job('raw1'));
    repo.enqueue(job('card1', { kind: 'card_3x4', dependsOn: 'raw1' }));
    // Both belong to sess_1 (the job() helper's default) and are reviewed
    // together — approval is orthogonal to the dependsOn ordering under test.
    repo.approveSession('sess_1');

    let due = repo.claimDue(Date.now());
    assert.deepEqual(due.map((d) => d.id), ['raw1']);

    repo.markSending('raw1');
    repo.markUploaded('raw1', 'file_1', 'SCANNING');

    due = repo.claimDue(Date.now());
    assert.deepEqual(due.map((d) => d.id), ['card1']);
    adapter.close();
  });
});

describe('UploadOutbox — staging and approval', () => {
  test('approveSession only releases the targeted session, leaving others staged', async () => {
    const { adapter, repo } = await makeRepo();
    repo.enqueue(job('a1', { sessionId: 'sess_A', virtualPath: 'raw/sess_A/a1.jpg', idemKey: 'sess_A:a1:1:raw' }));
    repo.enqueue(job('b1', { sessionId: 'sess_B', virtualPath: 'raw/sess_B/b1.jpg', idemKey: 'sess_B:b1:1:raw' }));

    repo.approveSession('sess_A');

    assert.deepEqual(repo.claimDue(Date.now()).map((d) => d.id), ['a1']);
    assert.equal(repo.getById('a1')!.approvedAt !== null, true);
    assert.equal(repo.getById('b1')!.approvedAt, null, 'a different session is untouched');
    adapter.close();
  });

  test('approveSession reports how many rows it moved, and is a no-op the second time', async () => {
    const { adapter, repo } = await makeRepo();
    repo.enqueue(job('j1'));
    repo.enqueue(job('j2', { idemKey: 'sess_1:j2:1:raw', virtualPath: 'raw/sess_1/j2.jpg' }));

    const firstCall = repo.approveSession('sess_1');
    assert.equal(firstCall.approved, 2, 'both staged rows were released');
    assert.deepEqual(firstCall.superseded, [], 'distinct steps — nothing superseded');

    const secondCall = repo.approveSession('sess_1');
    assert.equal(secondCall.approved, 0, 'nothing left to approve — a harmless no-op');
    assert.deepEqual(secondCall.superseded, []);
    assert.equal(repo.claimDue(Date.now()).length, 2, 'the earlier approval still holds');
    adapter.close();
  });

  test('a session with nothing staged approves harmlessly', async () => {
    const { adapter, repo } = await makeRepo();
    const result = repo.approveSession('sess_nonexistent');
    assert.equal(result.approved, 0);
    assert.deepEqual(result.superseded, []);
    adapter.close();
  });
});

describe('UploadOutbox — attempt de-duplication (phase-11 D5)', () => {
  test('approveSession keeps only the highest attempt per step and deletes the rest', async () => {
    const { adapter, repo } = await makeRepo();
    // Two attempts at the same step (a retake), plus a different step —
    // only the retaken step's later attempt and the untouched step should
    // survive.
    repo.enqueue(
      job('front-1', { stepId: 'step-front', attempt: 1, idemKey: 'sess_1:step-front:1:face', virtualPath: 'face/sess_1/step-front-1.jpg' })
    );
    repo.enqueue(
      job('front-2', { stepId: 'step-front', attempt: 2, idemKey: 'sess_1:step-front:2:face', virtualPath: 'face/sess_1/step-front-2.jpg' })
    );
    repo.enqueue(
      job('left-1', { stepId: 'step-left', attempt: 1, idemKey: 'sess_1:step-left:1:face', virtualPath: 'face/sess_1/step-left-1.jpg' })
    );

    const result = repo.approveSession('sess_1');

    assert.equal(result.approved, 2, 'one survivor per step');
    assert.deepEqual(result.superseded, [{ id: 'front-1', localPath: '/data/front-1.jpg' }]);

    const due = repo.claimDue(Date.now()).map((d) => d.id).sort();
    assert.deepEqual(due, ['front-2', 'left-1']);
    assert.equal(repo.getById('front-1'), null, 'the superseded row is gone, not just unapproved');
    assert.equal(repo.getById('front-2')!.attempt, 2);
    adapter.close();
  });

  test('a second approveSession call is a no-op once superseded rows are already gone', async () => {
    const { adapter, repo } = await makeRepo();
    repo.enqueue(job('front-1', { stepId: 'step-front', attempt: 1, idemKey: 'sess_1:step-front:1:face' }));
    repo.enqueue(job('front-2', { stepId: 'step-front', attempt: 2, idemKey: 'sess_1:step-front:2:face' }));

    repo.approveSession('sess_1');
    const second = repo.approveSession('sess_1');

    assert.deepEqual(second, { approved: 0, superseded: [] });
    adapter.close();
  });

  test('never deletes a row that is already approved or uploaded', async () => {
    // Simulates the report/approval already having happened once (e.g. a
    // step captured, approved and even uploaded before the operator somehow
    // triggers another approve for the same session) — a later attempt at
    // the same step must never delete an already-approved/uploaded row.
    const { adapter, repo } = await makeRepo();
    repo.enqueue(job('front-1', { stepId: 'step-front', attempt: 1, idemKey: 'sess_1:step-front:1:face' }));
    repo.approveSession('sess_1');
    repo.markSending('front-1');
    repo.markUploaded('front-1', 'file_1', 'SCANNING');

    // A later attempt at the same step, captured (hypothetically) after the
    // first was already uploaded, is still just a fresh staged row.
    repo.enqueue(job('front-2', { stepId: 'step-front', attempt: 2, idemKey: 'sess_1:step-front:2:face' }));
    const result = repo.approveSession('sess_1');

    assert.equal(result.approved, 1, 'only the newly staged row is newly approved');
    assert.deepEqual(result.superseded, [], 'the already-uploaded row is never touched, let alone deleted');
    assert.equal(repo.getById('front-1')!.status, 'UPLOADED', 'untouched');
    assert.equal(repo.getById('front-2')!.status, 'PENDING');
    adapter.close();
  });

  test('a row whose idem_key does not carry a recognisable step is kept, never grouped with an unrelated row', async () => {
    const { adapter, repo } = await makeRepo();
    // Deliberately malformed idemKey (too few segments) — stepId/attempt
    // cannot be recovered, so toItem() falls back to null and approveSession
    // must fall back to a singleton group keyed by the row's own id rather
    // than accidentally merging it with another malformed row.
    repo.enqueue(job('odd-1', { idemKey: 'not-a-valid-key' }));
    repo.enqueue(job('odd-2', { idemKey: 'also:not:valid' }));

    const result = repo.approveSession('sess_1');

    assert.equal(result.approved, 2, 'both kept — neither could be shown to supersede the other');
    assert.deepEqual(result.superseded, []);
    adapter.close();
  });
});

describe('UploadOutbox — retry and failure', () => {
  test('a retry is scheduled in the future and is not due yet', async () => {
    const { adapter, repo } = await makeRepo();
    repo.enqueue(job('j1'));
    repo.approveSession('sess_1');
    repo.markSending('j1');
    repo.markRetry('j1', 'connection reset', 60_000);

    const now = Date.now();
    assert.equal(repo.claimDue(now).length, 0, 'not due yet');
    assert.equal(repo.claimDue(now + 61_000).length, 1, 'due once the delay passes');

    const item = repo.getById('j1')!;
    assert.equal(item.attempts, 1);
    assert.match(item.lastError!, /connection reset/);
    adapter.close();
  });

  test('a permanently failed job leaves the queue until someone retries it', async () => {
    const { adapter, repo } = await makeRepo();
    repo.enqueue(job('j1'));
    repo.approveSession('sess_1');
    repo.markFailedPermanent('j1', 'rejected: bad request');

    assert.equal(repo.claimDue(Date.now() + 10_000_000).length, 0);
    assert.equal(repo.stats().failedPermanent, 1);

    repo.retryFailed('j1');
    assert.equal(repo.claimDue(Date.now()).length, 1);
    assert.equal(repo.getById('j1')!.attempts, 0, 'operator retry resets the budget');
    adapter.close();
  });

  test('backoff grows with attempts and stays under the cap', () => {
    const first = nextRetryDelayMs(0);
    const later = nextRetryDelayMs(6);
    const far = nextRetryDelayMs(50);

    assert.ok(first >= 1_000 && first <= 6_500, `unexpected first delay ${first}`);
    assert.ok(later > first);
    assert.ok(far <= 600_000 * 1.2, 'capped rather than growing forever');
  });
});

describe('UploadOutbox — crash recovery', () => {
  test('jobs abandoned in flight are returned to the queue', async () => {
    const { adapter, repo } = await makeRepo();
    repo.enqueue(job('j1'));
    repo.enqueue(job('j2'));
    repo.approveSession('sess_1');
    repo.markSending('j1');
    repo.markSending('j2');

    // Nothing owns a SENDING row after a crash, so without this they never move.
    assert.equal(repo.claimDue(Date.now()).length, 0);

    const recovered = repo.recoverInterrupted();
    assert.equal(recovered, 2);
    assert.equal(repo.claimDue(Date.now()).length, 2);
    adapter.close();
  });
});

describe('UploadOutbox — scan tracking', () => {
  test('an uploaded job waits for the scan and then completes', async () => {
    const { adapter, repo } = await makeRepo();
    repo.enqueue(job('j1'));
    repo.markSending('j1');
    repo.markUploaded('j1', 'file_1', 'SCANNING');

    assert.equal(repo.listAwaitingScan().length, 1);
    assert.equal(repo.stats().awaitingScan, 1);

    repo.markDone('j1', 'READY');
    assert.equal(repo.listAwaitingScan().length, 0);
    assert.equal(repo.getById('j1')!.status, 'DONE');
    adapter.close();
  });

  test('files stuck awaiting a scan can be listed for an alert', async () => {
    // The server does not always leave this state on its own, so nothing else
    // would ever notice these.
    const { adapter, repo } = await makeRepo();
    repo.enqueue(job('j1'));
    repo.markSending('j1');
    repo.markUploaded('j1', 'file_1', 'SCANNING');

    assert.equal(repo.listStuckAwaitingScan(600_000).length, 0, 'not stuck yet');

    const future = Date.now() + 11 * 60_000;
    const stuck = repo.listStuckAwaitingScan(600_000, future);
    assert.equal(stuck.length, 1);
    assert.equal(stuck[0].fsFileId, 'file_1');
    adapter.close();
  });

  test('stats summarise the queue for the status panel', async () => {
    const { adapter, repo } = await makeRepo();
    repo.enqueue(job('j1'));
    repo.enqueue(job('j2'));
    repo.enqueue(job('j3'));
    repo.markSending('j2');
    repo.markUploaded('j2', 'file_2', 'SCANNING');
    repo.markFailedPermanent('j3', 'nope');

    const stats = repo.stats();
    assert.equal(stats.pending, 1);
    assert.equal(stats.awaitingScan, 1);
    assert.equal(stats.failedPermanent, 1);
    assert.ok(stats.oldestPendingAt !== null);
    adapter.close();
  });
});
