import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CaptureStreamItem, EnqueueInput, ApproveSessionResult, OutboxItem } from '@face/database';
import {
  approveSessionUpload,
  type ApproveSessionUploadRepo,
  type ApproveSessionUploadStreamRepo,
} from '../uploads.js';

/**
 * Stands in for `UploadOutboxRepository` — same "no Electron needed"
 * reasoning as sessionReport.test.ts's use of `buildSessionReportPayload`.
 * `approveSession` returns a result the test configures directly rather than
 * modelling real grouping logic — that logic already has its own coverage in
 * @face/database's UploadOutbox.test.ts; this suite is only about what
 * approveSessionUpload() itself does with video.
 */
class FakeOutboxRepo implements ApproveSessionUploadRepo {
  public enqueued: EnqueueInput[] = [];
  constructor(
    private approveResult: ApproveSessionResult = { approved: 0, superseded: [] },
    private rows: OutboxItem[] = []
  ) {}

  approveSession(): ApproveSessionResult {
    return this.approveResult;
  }

  listBySession(): OutboxItem[] {
    return this.rows;
  }

  enqueue(input: EnqueueInput): void {
    // ON CONFLICT(idem_key) DO NOTHING, mirrored: a repeat enqueue for an
    // already-known idemKey must not double-count.
    if (this.enqueued.some((e) => e.idemKey === input.idemKey)) return;
    this.enqueued.push(input);
  }
}

class FakeStreamRepo implements ApproveSessionUploadStreamRepo {
  constructor(private items: CaptureStreamItem[]) {}
  listBySession(sessionId: string): CaptureStreamItem[] {
    return this.items.filter((i) => i.sessionId === sessionId);
  }
}

function makeStream(over: Partial<CaptureStreamItem> = {}): CaptureStreamItem {
  return {
    id: 'stream-1',
    sessionId: 'video-session-1',
    cameraId: 'CENTER',
    localPath: '',
    mimeType: 'video/webm',
    sizeBytes: 12345,
    durationMs: 5000,
    startedAt: 1000,
    endedAt: 2000,
    createdAt: 1000,
    ...over,
  };
}

describe('approveSessionUpload — video enqueue', () => {
  test('enqueues a finished recording under the outbox sessionId, not the video-engine sessionId', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'face-video-upload-'));
    try {
      const localPath = join(dir, 'stream-1.webm');
      writeFileSync(localPath, 'fake video bytes');
      const outboxRepo = new FakeOutboxRepo();
      const streamRepo = new FakeStreamRepo([makeStream({ localPath })]);

      const result = await approveSessionUpload(
        'outbox-session-1',
        undefined,
        { videoSessionId: 'video-session-1' },
        outboxRepo,
        streamRepo
      );

      assert.equal(result.videosEnqueued, 1);
      assert.equal(outboxRepo.enqueued.length, 1);
      const row = outboxRepo.enqueued[0];
      // The row itself is filed under the id the API/CMS already know this
      // session by (see enqueueSessionVideos's own doc comment) — never the
      // workflow engine's separate session_<timestamp> id.
      assert.equal(row.sessionId, 'outbox-session-1');
      assert.equal(row.kind, 'video');
      // stepId is the recording's own id, not a camera/role id — see D5 in
      // the plan for why grouping by camera would be wrong.
      assert.equal(row.stepId, 'stream-1');
      assert.equal(row.attempt, 1);
      assert.ok(row.approvedAt && row.approvedAt > 0, 'enqueued already-approved, no staging window');
      assert.equal(row.localPath, localPath);
      assert.equal(row.sizeBytes, 12345);
      assert.match(row.sha256, /^[0-9a-f]{64}$/);
      assert.equal(row.virtualPath, `video/${new Date().getFullYear()}/outbox-session-1/stream-1.webm`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('videoSessionId defaults to sessionId when the caller does not send one', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'face-video-upload-'));
    try {
      const localPath = join(dir, 'stream-1.webm');
      writeFileSync(localPath, 'x');
      const outboxRepo = new FakeOutboxRepo();
      // capture_streams row filed under the SAME id as the outbox session —
      // the fallback path a caller with no separate video-session id takes.
      const streamRepo = new FakeStreamRepo([makeStream({ sessionId: 'sess-1', localPath })]);

      const result = await approveSessionUpload('sess-1', undefined, undefined, outboxRepo, streamRepo);

      assert.equal(result.videosEnqueued, 1);
      assert.equal(outboxRepo.enqueued[0].sessionId, 'sess-1');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a recording still missing endedAt (crash mid-recording) is skipped', async () => {
    const outboxRepo = new FakeOutboxRepo();
    const streamRepo = new FakeStreamRepo([makeStream({ endedAt: null, localPath: '/never/written.webm' })]);

    const result = await approveSessionUpload(
      'sess-1',
      undefined,
      { videoSessionId: 'video-session-1' },
      outboxRepo,
      streamRepo
    );

    assert.equal(result.videosEnqueued, 0);
    assert.equal(outboxRepo.enqueued.length, 0);
  });

  test('every simultaneous-mode recording of a session gets its own stepId, so none can supersede another', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'face-video-upload-'));
    try {
      const paths = ['center.webm', 'left.webm', 'right.webm'].map((n) => join(dir, n));
      paths.forEach((p) => writeFileSync(p, p));
      const outboxRepo = new FakeOutboxRepo();
      const streamRepo = new FakeStreamRepo([
        makeStream({ id: 'stream-center', cameraId: 'CENTER', localPath: paths[0] }),
        makeStream({ id: 'stream-left', cameraId: 'LEFT', localPath: paths[1] }),
        makeStream({ id: 'stream-right', cameraId: 'RIGHT', localPath: paths[2] }),
      ]);

      const result = await approveSessionUpload(
        'sess-1',
        undefined,
        { videoSessionId: 'video-session-1' },
        outboxRepo,
        streamRepo
      );

      assert.equal(result.videosEnqueued, 3);
      const stepIds = outboxRepo.enqueued.map((e) => e.stepId).sort();
      assert.deepEqual(stepIds, ['stream-center', 'stream-left', 'stream-right']);
      // Every idemKey (and therefore id) must be distinct — nothing collides
      // and ON CONFLICT DO NOTHING cannot silently drop one of the three.
      assert.equal(new Set(outboxRepo.enqueued.map((e) => e.idemKey)).size, 3);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a session with no recordings at all enqueues nothing and does not throw', async () => {
    const outboxRepo = new FakeOutboxRepo();
    const streamRepo = new FakeStreamRepo([]);

    const result = await approveSessionUpload('sess-1', undefined, undefined, outboxRepo, streamRepo);

    assert.equal(result.videosEnqueued, 0);
    assert.equal(result.approved, 0);
    assert.equal(result.superseded, 0);
  });

  test('re-approving the same session a second time does not enqueue the video twice', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'face-video-upload-'));
    try {
      const localPath = join(dir, 'stream-1.webm');
      writeFileSync(localPath, 'fake video bytes');
      const outboxRepo = new FakeOutboxRepo();
      const streamRepo = new FakeStreamRepo([makeStream({ localPath })]);
      const options = { videoSessionId: 'video-session-1' };

      await approveSessionUpload('sess-1', undefined, options, outboxRepo, streamRepo);
      const second = await approveSessionUpload('sess-1', undefined, options, outboxRepo, streamRepo);

      assert.equal(second.videosEnqueued, 1, 'the function still reports it processed the row');
      assert.equal(outboxRepo.enqueued.length, 1, 'but the fake outbox — like the real one\'s ON CONFLICT DO NOTHING — only ever holds one');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
