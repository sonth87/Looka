import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CaptureStreamItem, EndStreamInput } from '@face/database';
import { endVideoStream, EndVideoStreamRepo } from '../streams.js';

/**
 * Stands in for `CaptureStreamRepository` — `endVideoStream`'s injectable
 * second parameter (see streams.ts's own doc comment) needs only
 * `getById`/`endStream`. The real repository needs Electron's `app`
 * (`streamsDir()`'s `app.getPath('userData')`) plus an initialized database
 * (`getDatabase()`), neither of which exists under plain `node --test` —
 * `require('electron')` here resolves to the path of the electron binary,
 * not `{ app, ... }`, so anything that touches the real singleton would
 * throw before this test could even set up its fixture.
 */
class FakeRepo implements EndVideoStreamRepo {
  public ended: EndStreamInput[] = [];
  constructor(private item: CaptureStreamItem | null) {}

  getById(id: string): CaptureStreamItem | null {
    return this.item && this.item.id === id ? this.item : null;
  }

  endStream(input: EndStreamInput): void {
    this.ended.push(input);
  }
}

function makeItem(localPath: string): CaptureStreamItem {
  return {
    id: 'stream-1',
    sessionId: 'session-1',
    cameraId: 'camera-1',
    localPath,
    mimeType: 'video/webm',
    sizeBytes: 0,
    durationMs: 0,
    startedAt: Date.now(),
    endedAt: null,
    createdAt: Date.now(),
  };
}

describe('endVideoStream', () => {
  test('writes the Uint8Array payload to disk and records real size/duration/endedAt', () => {
    const dir = mkdtempSync(join(tmpdir(), 'face-streams-'));
    try {
      const localPath = join(dir, 'stream-1.webm');
      const repo = new FakeRepo(makeItem(localPath));
      const data = new Uint8Array([1, 2, 3, 4, 5]);

      const result = endVideoStream({ streamId: 'stream-1', data, durationMs: 4200 }, repo);

      assert.deepEqual(result, { ok: true });
      assert.equal(existsSync(localPath), true);
      assert.deepEqual(new Uint8Array(readFileSync(localPath)), data);

      assert.equal(repo.ended.length, 1);
      assert.equal(repo.ended[0].id, 'stream-1');
      assert.equal(repo.ended[0].sizeBytes, 5);
      assert.equal(repo.ended[0].durationMs, 4200);
      assert.ok(repo.ended[0].endedAt > 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('an unknown stream id fails without touching disk or the repo', () => {
    const repo = new FakeRepo(null);
    const result = endVideoStream({ streamId: 'missing', data: new Uint8Array([1]), durationMs: 100 }, repo);

    assert.deepEqual(result, { ok: false, error: 'Unknown stream id missing' });
    assert.equal(repo.ended.length, 0);
  });

  test('a write failure (bad localPath) is reported, not thrown, and the row is left unfinalized', () => {
    const repo = new FakeRepo(makeItem(join('this', 'directory', 'does', 'not', 'exist', 'stream-1.webm')));

    const result = endVideoStream({ streamId: 'stream-1', data: new Uint8Array([1, 2, 3]), durationMs: 50 }, repo);

    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /ENOENT|no such file/i);
    // A failed write must not still close out the row — the whole point of
    // the two-call start/end shape is that ended_at only ever reflects bytes
    // that actually made it to disk.
    assert.equal(repo.ended.length, 0);
  });
});
