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

    assert.deepEqual(second, { approved: 0, superseded: [], approvedRows: [], missingKeepAttempts: [] });
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

describe('UploadOutbox — post-save retake (2026-09-08)', () => {
  test('supersedeOlderApprovedAttempts finds and deletes an attempt approved in an EARLIER call', async () => {
    const { adapter, repo } = await makeRepo();
    repo.enqueue(job('front-1', { kind: 'face', stepId: 'step-front', attempt: 1, idemKey: 'sess_1:step-front:1:face' }));
    repo.approveSession('sess_1');
    // Simulate the file having already been uploaded before the retake happens.
    repo.markSending('front-1');
    repo.markUploaded('front-1', 'file_front_1', 'READY');

    // A later, separate approveSession() call for a freshly staged retake —
    // this is the case approveSession()'s own supersede logic cannot reach,
    // since front-1 is no longer in the staged set it considers.
    repo.enqueue(job('front-2', { kind: 'face', stepId: 'step-front', attempt: 2, idemKey: 'sess_1:step-front:2:face' }));
    const result = repo.approveSession('sess_1');
    assert.equal(result.approved, 1);
    assert.equal(result.approvedRows[0].id, 'front-2');

    const superseded = repo.supersedeOlderApprovedAttempts('sess_1', 'face', 'step-front', 'front-2');

    assert.deepEqual(superseded, [{ id: 'front-1', localPath: '/data/front-1.jpg', fsFileId: 'file_front_1' }]);
    assert.equal(repo.getById('front-1'), null, 'the stale approved row is gone, not just unapproved');
    assert.equal(repo.getById('front-2')!.status, 'PENDING', 'the new attempt itself is untouched');
    adapter.close();
  });

  test('supersedeOlderApprovedAttempts is a harmless no-op when there is nothing stale', async () => {
    const { adapter, repo } = await makeRepo();
    repo.enqueue(job('front-1', { kind: 'face', stepId: 'step-front', idemKey: 'sess_1:step-front:1:face' }));
    repo.approveSession('sess_1');

    // keepId is the only approved row for this (kind, stepId) — nothing else to find.
    const superseded = repo.supersedeOlderApprovedAttempts('sess_1', 'face', 'step-front', 'front-1');
    assert.deepEqual(superseded, []);
    assert.ok(repo.getById('front-1'), 'the kept row itself must survive');
    adapter.close();
  });

  test('supersedeOlderApprovedAttempts never touches a different step in the same session', async () => {
    const { adapter, repo } = await makeRepo();
    repo.enqueue(job('a1', { sessionId: 'sess_A', stepId: 'step-front', idemKey: 'sess_A:step-front:1:face', kind: 'face' }));
    repo.approveSession('sess_A');
    repo.enqueue(job('a2', { sessionId: 'sess_A', stepId: 'step-left', idemKey: 'sess_A:step-left:1:face', kind: 'face' }));
    repo.approveSession('sess_A');

    // Superseding step-front must not delete step-left's already-approved row.
    const superseded = repo.supersedeOlderApprovedAttempts('sess_A', 'face', 'step-front', 'nonexistent-keep-id');
    assert.deepEqual(superseded, [{ id: 'a1', localPath: '/data/a1.jpg', fsFileId: null }]);
    assert.ok(repo.getById('a2'), 'a different step in the same session is untouched');
    adapter.close();
  });
});

describe('UploadOutbox — operator-chosen attempt (multi-shot keepAttempts)', () => {
  const face = (
    id: string,
    stepId: string,
    attempt: number,
    over: Partial<Parameters<UploadOutboxRepository['enqueue']>[0]> = {}
  ) =>
    job(id, {
      kind: 'face',
      stepId,
      attempt,
      idemKey: `sess_1:${stepId}:${attempt}:face`,
      virtualPath: `face/sess_1/${stepId}-${attempt}.jpg`,
      ...over,
    });

  test('the chosen attempt wins even when a higher attempt exists, and the rest are deleted', async () => {
    const { adapter, repo } = await makeRepo();
    repo.enqueue(face('front-1', 'step-front', 1));
    repo.enqueue(face('front-2', 'step-front', 2));
    repo.enqueue(face('front-3', 'step-front', 3));
    repo.enqueue(face('left-1', 'step-left', 1));

    const result = repo.approveSession('sess_1', { keepAttempts: { 'step-front': 2 } });

    assert.deepEqual(result.missingKeepAttempts, []);
    assert.equal(result.approved, 2, 'the chosen center attempt plus the untouched corner step');
    assert.deepEqual(result.superseded.map((s) => s.id).sort(), ['front-1', 'front-3']);
    assert.deepEqual(repo.claimDue(Date.now()).map((d) => d.id).sort(), ['front-2', 'left-1']);
    assert.equal(repo.getById('front-1'), null, 'not uploaded, deleted');
    assert.equal(repo.getById('front-3'), null, 'the newest shot is discarded when the operator chose an older one');
    adapter.close();
  });

  test('choosing the highest attempt behaves like the default rule', async () => {
    const { adapter, repo } = await makeRepo();
    repo.enqueue(face('front-1', 'step-front', 1));
    repo.enqueue(face('front-2', 'step-front', 2));

    const result = repo.approveSession('sess_1', { keepAttempts: { 'step-front': 2 } });

    assert.equal(result.approved, 1);
    assert.deepEqual(result.superseded.map((s) => s.id), ['front-1']);
    assert.deepEqual(result.approvedRows.map((r) => r.id), ['front-2']);
    adapter.close();
  });

  test('a step without an entry keeps the highest-attempt rule', async () => {
    const { adapter, repo } = await makeRepo();
    repo.enqueue(face('front-1', 'step-front', 1));
    repo.enqueue(face('front-2', 'step-front', 2));
    repo.enqueue(face('left-1', 'step-left', 1));
    repo.enqueue(face('left-2', 'step-left', 2));

    repo.approveSession('sess_1', { keepAttempts: { 'step-front': 1 } });

    assert.deepEqual(repo.claimDue(Date.now()).map((d) => d.id).sort(), ['front-1', 'left-2']);
    adapter.close();
  });

  test('case (b): the chosen attempt is ALREADY approved, so every staged row of that step is deleted and none approved', async () => {
    const { adapter, repo } = await makeRepo();
    repo.enqueue(face('front-1', 'step-front', 1));
    repo.approveSession('sess_1');
    repo.markSending('front-1');
    repo.markUploaded('front-1', 'file_1', 'READY');

    // Post-save retake: two extra center shots staged, but the operator goes
    // back to the photo that was already saved.
    repo.enqueue(face('front-2', 'step-front', 2));
    repo.enqueue(face('front-3', 'step-front', 3));
    const result = repo.approveSession('sess_1', { keepAttempts: { 'step-front': 1 } });

    assert.deepEqual(result.missingKeepAttempts, []);
    assert.equal(result.approved, 0, 'nothing new to approve, the earlier approval stands');
    assert.deepEqual(result.approvedRows, []);
    assert.deepEqual(result.superseded.map((s) => s.id).sort(), ['front-2', 'front-3']);
    assert.equal(repo.getById('front-2'), null);
    assert.equal(repo.getById('front-3'), null);
    assert.equal(repo.getById('front-1')!.status, 'UPLOADED', 'the saved photo is untouched');
    adapter.close();
  });

  test('case (b) still works when nothing at all is staged for the session', async () => {
    const { adapter, repo } = await makeRepo();
    repo.enqueue(face('front-1', 'step-front', 1));
    repo.approveSession('sess_1');

    const result = repo.approveSession('sess_1', { keepAttempts: { 'step-front': 1 } });

    assert.deepEqual(result, { approved: 0, superseded: [], approvedRows: [], missingKeepAttempts: [] });
    adapter.close();
  });

  test('case (c): a chosen attempt that exists nowhere refuses the WHOLE call and writes nothing', async () => {
    const { adapter, repo } = await makeRepo();
    repo.enqueue(face('front-1', 'step-front', 1));
    repo.enqueue(face('front-2', 'step-front', 2));
    repo.enqueue(face('left-1', 'step-left', 1));

    const result = repo.approveSession('sess_1', { keepAttempts: { 'step-front': 7 } });

    assert.deepEqual(result, {
      approved: 0,
      superseded: [],
      approvedRows: [],
      missingKeepAttempts: ['step-front:7'],
    });
    // Not even the unrelated corner photo was approved, and nothing was deleted.
    assert.equal(repo.claimDue(Date.now()).length, 0);
    for (const id of ['front-1', 'front-2', 'left-1']) {
      const row = repo.getById(id);
      assert.ok(row, `${id} still exists`);
      assert.equal(row!.approvedAt, null, `${id} is still staged`);
    }
    adapter.close();
  });

  test('case (c) is detected even when nothing is staged', async () => {
    const { adapter, repo } = await makeRepo();
    const result = repo.approveSession('sess_1', { keepAttempts: { 'step-front': 1 } });
    assert.deepEqual(result.missingKeepAttempts, ['step-front:1']);
    assert.equal(result.approved, 0);
    adapter.close();
  });

  test('only kind "face" rows can satisfy a choice', async () => {
    const { adapter, repo } = await makeRepo();
    // Same step id and attempt, but a different kind, so it must not count.
    repo.enqueue(job('raw-front-2', { kind: 'raw', stepId: 'step-front', attempt: 2, idemKey: 'sess_1:step-front:2:raw' }));

    const result = repo.approveSession('sess_1', { keepAttempts: { 'step-front': 2 } });

    assert.deepEqual(result.missingKeepAttempts, ['step-front:2']);
    assert.equal(repo.getById('raw-front-2')!.approvedAt, null);
    adapter.close();
  });

  test('a nonsensical attempt number is ignored rather than refusing the call', async () => {
    const { adapter, repo } = await makeRepo();
    repo.enqueue(face('front-1', 'step-front', 1));
    repo.enqueue(face('front-2', 'step-front', 2));

    const result = repo.approveSession('sess_1', { keepAttempts: { 'step-front': 0, 'step-x': 1.5 } });

    assert.deepEqual(result.missingKeepAttempts, []);
    assert.deepEqual(result.approvedRows.map((r) => r.id), ['front-2'], 'falls back to the highest-attempt rule');
    adapter.close();
  });

  test('without options the result is unchanged and reports no missing attempts', async () => {
    const { adapter, repo } = await makeRepo();
    repo.enqueue(face('front-1', 'step-front', 1));
    repo.enqueue(face('front-2', 'step-front', 2));

    const result = repo.approveSession('sess_1');

    assert.deepEqual(result.missingKeepAttempts, []);
    assert.equal(result.approved, 1);
    assert.deepEqual(result.superseded.map((s) => s.id), ['front-1']);
    adapter.close();
  });
});

describe('UploadOutbox — discardStaged (abandoned run)', () => {
  const stagedFace = (id: string, sessionId: string, attempt: number) =>
    job(id, {
      sessionId,
      kind: 'face',
      stepId: 'step-front',
      attempt,
      idemKey: `${sessionId}:step-front:${attempt}:face`,
      localPath: `/data/${id}.jpg`,
    });

  test('deletes every unapproved row of the session and returns them so the files can be unlinked', async () => {
    const { adapter, repo } = await makeRepo();
    repo.enqueue(stagedFace('front-1', 'sess_1', 1));
    repo.enqueue(stagedFace('front-2', 'sess_1', 2));
    repo.enqueue(stagedFace('front-3', 'sess_1', 3));

    const discarded = repo.discardStaged('sess_1');

    assert.deepEqual(
      discarded.map((d) => [d.id, d.localPath]).sort(),
      [
        ['front-1', '/data/front-1.jpg'],
        ['front-2', '/data/front-2.jpg'],
        ['front-3', '/data/front-3.jpg'],
      ]
    );
    assert.equal(adapter.exec('SELECT * FROM upload_outbox').length, 0);
    adapter.close();
  });

  test('never touches an approved row, so a given-up post-save retake leaves the earlier approval standing', async () => {
    const { adapter, repo } = await makeRepo();
    repo.enqueue(stagedFace('front-1', 'sess_1', 1));
    repo.approveSession('sess_1'); // the saved photo
    repo.markUploaded('front-1', 'fs-1', 'PENDING_SCAN');
    repo.enqueue(stagedFace('front-2', 'sess_1', 2)); // a retake, never confirmed
    repo.enqueue(stagedFace('front-3', 'sess_1', 3));

    const discarded = repo.discardStaged('sess_1');

    assert.deepEqual(discarded.map((d) => d.id).sort(), ['front-2', 'front-3']);
    const left = adapter.exec<{ id: string }>('SELECT id FROM upload_outbox');
    assert.deepEqual(left.map((r) => r.id), ['front-1']);
    assert.notEqual(repo.getById('front-1')!.approvedAt, null);
    adapter.close();
  });

  test('leaves other sessions alone and is a harmless no-op when nothing is staged', async () => {
    const { adapter, repo } = await makeRepo();
    repo.enqueue(stagedFace('other-1', 'sess_other', 1));

    assert.deepEqual(repo.discardStaged('sess_1'), []);
    assert.deepEqual(repo.discardStaged('sess_1'), [], 'idempotent');
    assert.notEqual(repo.getById('other-1'), null);
    adapter.close();
  });

  test('a discarded attempt number can be captured again without hitting the old idem_key', async () => {
    // Cancel / "Chụp lại toàn bộ" on a session whose id is reused (cross-sitting
    // retake) restarts the engine's attempt counter — the old staged row would
    // otherwise swallow the new photo through ON CONFLICT(idem_key) DO NOTHING.
    const { adapter, repo } = await makeRepo();
    repo.enqueue(stagedFace('front-1', 'sess_1', 1));
    repo.discardStaged('sess_1');

    repo.enqueue(stagedFace('front-1-again', 'sess_1', 1));

    assert.notEqual(repo.getById('front-1-again'), null);
    adapter.close();
  });
});
