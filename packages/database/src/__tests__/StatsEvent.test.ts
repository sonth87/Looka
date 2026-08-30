import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { PersistentStorageAdapter } from '../PersistentStorageAdapter.js';
import { StatsEventRepository } from '../repositories/StatsEventRepository.js';

async function makeRepo() {
  const adapter = new PersistentStorageAdapter({ filename: ':memory:' });
  await adapter.initialize();
  return { adapter, repo: new StatsEventRepository(adapter) };
}

describe('StatsEventRepository', () => {
  test('an enqueued event is PENDING and claimable', async () => {
    const { adapter, repo } = await makeRepo();
    repo.enqueue({ id: 'e1', type: 'SESSION_COMPLETED', occurredAt: Date.now() });

    const pending = repo.claimPending();
    assert.equal(pending.length, 1);
    assert.equal(pending[0].status, 'PENDING');
    assert.equal(pending[0].type, 'SESSION_COMPLETED');
    adapter.close();
  });

  test('metadata round-trips through JSON', async () => {
    const { adapter, repo } = await makeRepo();
    repo.enqueue({ id: 'e1', type: 'RETAKE', occurredAt: Date.now(), metadata: { stepId: 'LEFT', attempt: 2 } });

    const [item] = repo.claimPending();
    assert.deepEqual(item.metadata, { stepId: 'LEFT', attempt: 2 });
    adapter.close();
  });

  test('marking sent removes an event from claimPending', async () => {
    const { adapter, repo } = await makeRepo();
    repo.enqueue({ id: 'e1', type: 'UPLOAD_SUCCESS', occurredAt: Date.now() });
    repo.enqueue({ id: 'e2', type: 'UPLOAD_FAILED', occurredAt: Date.now() });

    repo.markSent(['e1']);

    const pending = repo.claimPending();
    assert.equal(pending.length, 1);
    assert.equal(pending[0].id, 'e2');
    adapter.close();
  });

  test('a push that never confirms leaves the event PENDING for the next attempt', async () => {
    // The whole point of this table: a kiosk that goes offline mid-push
    // must not lose the event — it just tries again next tick.
    const { adapter, repo } = await makeRepo();
    repo.enqueue({ id: 'e1', type: 'CB_HELP_INTERVENTION', occurredAt: Date.now() });

    assert.equal(repo.claimPending().length, 1);
    assert.equal(repo.claimPending().length, 1, 'claiming does not itself consume the row');
    adapter.close();
  });
});
