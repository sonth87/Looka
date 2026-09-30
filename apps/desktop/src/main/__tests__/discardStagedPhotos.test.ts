import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { discardStagedPhotos } from '../uploads.js';

/**
 * `discardStagedPhotos` is what removes the photos of a run the operator
 * abandoned (cancel / "Chụp lại toàn bộ" / next student). The row selection —
 * "unapproved rows of this session only" — is covered against a real database
 * in @face/database's UploadOutbox.test.ts; this suite covers what the main
 * process adds on top: unlinking the files of exactly the rows the repository
 * reported, and never failing because of a file that is already gone.
 */
describe('discardStagedPhotos', () => {
  test('unlinks the file of every row the repository discarded and reports how many', () => {
    const dir = mkdtempSync(join(tmpdir(), 'discard-staged-'));
    try {
      const a = join(dir, 'face-step-front-1.jpg');
      const b = join(dir, 'face-step-front-2.jpg');
      const keep = join(dir, 'face-step-front-3.jpg'); // an approved photo: the repo never lists it
      writeFileSync(a, 'a');
      writeFileSync(b, 'b');
      writeFileSync(keep, 'c');

      const calls: string[] = [];
      const deletedIds: string[][] = [];
      const result = discardStagedPhotos('sess-1', {
        listStaged: (sessionId) => {
          calls.push(sessionId);
          return [
            { id: 'a', localPath: a },
            { id: 'b', localPath: b },
          ];
        },
        deleteOutboxRows: (ids) => {
          deletedIds.push(ids);
        },
      });

      assert.deepEqual(calls, ['sess-1']);
      assert.deepEqual(result, { removed: 2 });
      assert.equal(existsSync(a), false);
      assert.equal(existsSync(b), false);
      assert.equal(existsSync(keep), true, 'a file the repository did not report is never touched');
      assert.deepEqual(deletedIds, [['a', 'b']], 'rows are only deleted once their file is actually gone');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a file that is already gone does not fail the discard', () => {
    const result = discardStagedPhotos('sess-1', {
      listStaged: () => [{ id: 'gone', localPath: join(tmpdir(), 'discard-staged-does-not-exist.jpg') }],
      deleteOutboxRows: () => {},
    });
    assert.deepEqual(result, { removed: 1 });
  });

  test('a file that fails to unlink for a reason other than "already gone" leaves its row staged for retry', () => {
    const dir = mkdtempSync(join(tmpdir(), 'discard-staged-locked-'));
    try {
      // A directory can be listed but not unlinked as a file — stands in for
      // a Windows EBUSY/EPERM (AV scanner, thumbnail reader) without relying
      // on platform-specific locking.
      const locked = join(dir, 'locked-dir');
      mkdirSync(locked);
      const deletedIds: string[][] = [];
      const result = discardStagedPhotos('sess-1', {
        listStaged: () => [{ id: 'locked', localPath: locked }],
        deleteOutboxRows: (ids) => {
          deletedIds.push(ids);
        },
      });

      assert.deepEqual(result, { removed: 0 }, 'the row is not counted as removed');
      assert.deepEqual(deletedIds, [[]], 'and is not deleted from the outbox either');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('nothing staged is a harmless no-op', () => {
    assert.deepEqual(
      discardStagedPhotos('sess-1', { listStaged: () => [], deleteOutboxRows: () => {} }),
      { removed: 0 }
    );
  });
});
