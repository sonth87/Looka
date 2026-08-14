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
  test('a queued job becomes due immediately', async () => {
    const { adapter, repo } = await makeRepo();
    repo.enqueue(job('j1'));

    const due = repo.claimDue(Date.now());
    assert.equal(due.length, 1);
    assert.equal(due[0].virtualPath, 'raw/sess_1/j1.jpg');
    assert.equal(due[0].status, 'PENDING');
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

  test('a dependent job waits until its parent has been uploaded', async () => {
    // The card photo is derived from the raw capture and must not be sent first.
    const { adapter, repo } = await makeRepo();
    repo.enqueue(job('raw1'));
    repo.enqueue(job('card1', { kind: 'card_3x4', dependsOn: 'raw1' }));

    let due = repo.claimDue(Date.now());
    assert.deepEqual(due.map((d) => d.id), ['raw1']);

    repo.markSending('raw1');
    repo.markUploaded('raw1', 'file_1', 'SCANNING');

    due = repo.claimDue(Date.now());
    assert.deepEqual(due.map((d) => d.id), ['card1']);
    adapter.close();
  });
});

describe('UploadOutbox — retry and failure', () => {
  test('a retry is scheduled in the future and is not due yet', async () => {
    const { adapter, repo } = await makeRepo();
    repo.enqueue(job('j1'));
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
