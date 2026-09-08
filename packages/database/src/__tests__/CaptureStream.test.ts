import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { PersistentStorageAdapter } from '../PersistentStorageAdapter.js';
import { CaptureStreamRepository } from '../repositories/CaptureStreamRepository.js';

async function makeRepo() {
  const adapter = new PersistentStorageAdapter({ filename: ':memory:' });
  await adapter.initialize();
  return { adapter, repo: new CaptureStreamRepository(adapter) };
}

describe('CaptureStreamRepository', () => {
  test('a stream starts with no duration/size until it ends', async () => {
    const { adapter, repo } = await makeRepo();
    repo.startStream({
      id: 'stream_1',
      sessionId: 'sess_1',
      cameraId: 'CENTER',
      localPath: '/data/streams/stream_1.webm',
      startedAt: 1000,
    });

    const item = repo.getById('stream_1');
    assert.ok(item);
    assert.equal(item!.sessionId, 'sess_1');
    assert.equal(item!.cameraId, 'CENTER');
    assert.equal(item!.mimeType, 'video/webm');
    assert.equal(item!.durationMs, 0);
    assert.equal(item!.sizeBytes, 0);
    assert.equal(item!.endedAt, null);
    adapter.close();
  });

  test('ending a stream fills in duration, size, and endedAt', async () => {
    const { adapter, repo } = await makeRepo();
    repo.startStream({
      id: 'stream_1',
      sessionId: 'sess_1',
      cameraId: 'CENTER',
      localPath: '/data/streams/stream_1.webm',
      startedAt: 1000,
    });
    repo.endStream({ id: 'stream_1', sizeBytes: 4096, durationMs: 5000, endedAt: 6000 });

    const item = repo.getById('stream_1');
    assert.equal(item!.durationMs, 5000);
    assert.equal(item!.sizeBytes, 4096);
    assert.equal(item!.endedAt, 6000);
    adapter.close();
  });

  test('a stream nobody ever ends (a crash mid-recording) stays ended_at NULL, not lost', async () => {
    const { adapter, repo } = await makeRepo();
    repo.startStream({
      id: 'orphan',
      sessionId: 'sess_1',
      cameraId: 'CENTER',
      localPath: '/data/streams/orphan.webm',
      startedAt: 1000,
    });

    const item = repo.getById('orphan');
    assert.ok(item, 'the row must still exist for later inspection, not be silently dropped');
    assert.equal(item!.endedAt, null);
    adapter.close();
  });

  test('listBySession returns only that session, ordered by start time', async () => {
    const { adapter, repo } = await makeRepo();
    repo.startStream({ id: 'a', sessionId: 'sess_1', cameraId: 'CENTER', localPath: '/a.webm', startedAt: 2000 });
    repo.startStream({ id: 'b', sessionId: 'sess_1', cameraId: 'LEFT', localPath: '/b.webm', startedAt: 1000 });
    repo.startStream({ id: 'c', sessionId: 'sess_2', cameraId: 'CENTER', localPath: '/c.webm', startedAt: 1500 });

    const items = repo.listBySession('sess_1');
    assert.equal(items.length, 2);
    assert.deepEqual(
      items.map((i) => i.id),
      ['b', 'a']
    );
    adapter.close();
  });

  test('deleteBySession removes only that session\'s rows and reports how many', async () => {
    const { adapter, repo } = await makeRepo();
    repo.startStream({ id: 'a', sessionId: 'sess_1', cameraId: 'CENTER', localPath: '/a.webm', startedAt: 1000 });
    repo.startStream({ id: 'b', sessionId: 'sess_1', cameraId: 'LEFT', localPath: '/b.webm', startedAt: 2000 });
    repo.startStream({ id: 'c', sessionId: 'sess_2', cameraId: 'CENTER', localPath: '/c.webm', startedAt: 1500 });

    const removed = repo.deleteBySession('sess_1');

    assert.equal(removed, 2);
    assert.deepEqual(repo.listBySession('sess_1'), []);
    assert.equal(repo.listBySession('sess_2').length, 1, 'a different session is untouched');
    adapter.close();
  });

  test('deleteBySession on a session with no rows is a harmless no-op', async () => {
    const { adapter, repo } = await makeRepo();
    const removed = repo.deleteBySession('sess_missing');
    assert.equal(removed, 0);
    adapter.close();
  });
});
