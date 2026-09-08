import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CaptureStreamItem, EnqueueInput, ApproveSessionResult, OutboxItem, RecordApprovalInput } from '@face/database';
import {
  approveSessionUpload,
  type ApproveSessionUploadRepo,
  type ApproveSessionUploadStreamRepo,
  type ApproveSessionUploadStudentRepo,
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
  /** Calls made to supersedeOlderApprovedAttempts(), for assertions. */
  public supersedeCalls: Array<{ sessionId: string; kind: string; stepId: string; keepId: string }> = [];
  constructor(
    private approveResult: ApproveSessionResult = { approved: 0, superseded: [], approvedRows: [] },
    private rows: OutboxItem[] = [],
    /** Canned response for supersedeOlderApprovedAttempts(), keyed by `${kind}:${stepId}` — empty (nothing stale) unless a test configures otherwise. */
    private staleByKey: Record<string, Array<{ id: string; localPath: string; fsFileId: string | null }>> = {}
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

  supersedeOlderApprovedAttempts(
    sessionId: string,
    kind: string,
    stepId: string,
    keepId: string
  ): Array<{ id: string; localPath: string; fsFileId: string | null }> {
    this.supersedeCalls.push({ sessionId, kind, stepId, keepId });
    return this.staleByKey[`${kind}:${stepId}`] ?? [];
  }
}

class FakeStreamRepo implements ApproveSessionUploadStreamRepo {
  public deletedIds: string[] = [];
  constructor(
    private items: CaptureStreamItem[],
    /** Canned response for listOlderFinishedRecordings(), keyed by `${sessionId}:${cameraId}` — empty unless a test configures otherwise. */
    private olderByKey: Record<string, CaptureStreamItem[]> = {}
  ) {}

  listBySession(sessionId: string): CaptureStreamItem[] {
    return this.items.filter((i) => i.sessionId === sessionId);
  }

  listOlderFinishedRecordings(sessionId: string, cameraId: string): CaptureStreamItem[] {
    return this.olderByKey[`${sessionId}:${cameraId}`] ?? [];
  }

  deleteById(id: string): void {
    this.deletedIds.push(id);
  }
}

class FakeStudentRepo implements ApproveSessionUploadStudentRepo {
  public recorded: RecordApprovalInput[] = [];
  recordApproval(input: RecordApprovalInput): void {
    this.recorded.push(input);
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
      const studentRepo = new FakeStudentRepo();

      const result = await approveSessionUpload(
        'outbox-session-1',
        undefined,
        { videoSessionId: 'video-session-1' },
        outboxRepo,
        streamRepo,
        studentRepo
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

      const result = await approveSessionUpload(
        'sess-1',
        undefined,
        undefined,
        outboxRepo,
        streamRepo,
        new FakeStudentRepo()
      );

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
      streamRepo,
      new FakeStudentRepo()
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
        streamRepo,
        new FakeStudentRepo()
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

    const result = await approveSessionUpload(
      'sess-1',
      undefined,
      undefined,
      outboxRepo,
      streamRepo,
      new FakeStudentRepo()
    );

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
      const studentRepo = new FakeStudentRepo();

      await approveSessionUpload('sess-1', undefined, options, outboxRepo, streamRepo, studentRepo);
      const second = await approveSessionUpload('sess-1', undefined, options, outboxRepo, streamRepo, studentRepo);

      assert.equal(second.videosEnqueued, 1, 'the function still reports it processed the row');
      assert.equal(outboxRepo.enqueued.length, 1, 'but the fake outbox — like the real one\'s ON CONFLICT DO NOTHING — only ever holds one');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

function makeOutboxItem(over: Partial<OutboxItem> = {}): OutboxItem {
  return {
    id: 'photo-1',
    sessionId: 'sess-1',
    kind: 'face',
    localPath: '/data/photo-1.jpg',
    virtualPath: 'face/2026/sess-1/step-front-1.jpg',
    mimeType: 'image/jpeg',
    sha256: 'a'.repeat(64),
    sizeBytes: 12345,
    metadata: null,
    idemKey: 'sess-1:step-front:1:face',
    uploadId: 'upload-1',
    dependsOn: null,
    visibility: 'private',
    status: 'PENDING',
    approvedAt: 1_700_000_100_000,
    stepId: 'step-front',
    attempt: 1,
    attempts: 0,
    nextRetryAt: null,
    lastError: null,
    fsFileId: null,
    fsStatus: null,
    fsStatusAt: null,
    createdAt: 1_700_000_000_000,
    doneAt: null,
    ...over,
  };
}

describe('approveSessionUpload — local student index', () => {
  test('records the local student index when the session carries a subjectCode and rows were approved', async () => {
    const outboxRepo = new FakeOutboxRepo({ approved: 1, superseded: [], approvedRows: [makeOutboxItem()] }, [makeOutboxItem()]);
    const streamRepo = new FakeStreamRepo([]);
    const studentRepo = new FakeStudentRepo();

    await approveSessionUpload(
      'sess-1',
      undefined,
      { subjectCode: 'SV001', subjectName: 'Nguyễn Văn An', metadata: { className: 'CNTT01', major: 'CNTT', academicYear: '2025-2026' } },
      outboxRepo,
      streamRepo,
      studentRepo
    );

    assert.equal(studentRepo.recorded.length, 1);
    const recorded = studentRepo.recorded[0];
    assert.equal(recorded.sessionId, 'sess-1');
    assert.equal(recorded.subjectCode, 'SV001');
    assert.equal(recorded.subjectName, 'Nguyễn Văn An');
    assert.equal(recorded.className, 'CNTT01');
    assert.equal(recorded.photoCount, 1);
  });

  test('does not record anything when the session carries no subjectCode', async () => {
    const outboxRepo = new FakeOutboxRepo({ approved: 1, superseded: [], approvedRows: [makeOutboxItem()] }, [makeOutboxItem()]);
    const streamRepo = new FakeStreamRepo([]);
    const studentRepo = new FakeStudentRepo();

    await approveSessionUpload('sess-1', undefined, undefined, outboxRepo, streamRepo, studentRepo);

    assert.equal(studentRepo.recorded.length, 0);
  });

  test('does not record anything when nothing was approved, even if a subjectCode was sent', async () => {
    const outboxRepo = new FakeOutboxRepo({ approved: 0, superseded: [], approvedRows: [] }, []);
    const streamRepo = new FakeStreamRepo([]);
    const studentRepo = new FakeStudentRepo();

    await approveSessionUpload(
      'sess-1',
      undefined,
      { subjectCode: 'SV001' },
      outboxRepo,
      streamRepo,
      studentRepo
    );

    assert.equal(studentRepo.recorded.length, 0);
  });

  test('a studentRepo failure is logged, not thrown — the approval itself must still succeed', async () => {
    const outboxRepo = new FakeOutboxRepo({ approved: 1, superseded: [], approvedRows: [makeOutboxItem()] }, [makeOutboxItem()]);
    const streamRepo = new FakeStreamRepo([]);
    const throwingStudentRepo: ApproveSessionUploadStudentRepo = {
      recordApproval: () => {
        throw new Error('disk full');
      },
    };

    const result = await approveSessionUpload(
      'sess-1',
      undefined,
      { subjectCode: 'SV001' },
      outboxRepo,
      streamRepo,
      throwingStudentRepo
    );

    assert.equal(result.approved, 1);
  });
});

describe('approveSessionUpload — post-save retake supersede (2026-09-08)', () => {
  test('a freshly approved photo attempt is checked against an earlier approval at the same (kind, stepId)', async () => {
    const approvedRow = makeOutboxItem({ id: 'photo-2', kind: 'face', stepId: 'step-front', attempt: 2 });
    const outboxRepo = new FakeOutboxRepo(
      { approved: 1, superseded: [], approvedRows: [approvedRow] },
      [approvedRow]
    );
    const streamRepo = new FakeStreamRepo([]);

    await approveSessionUpload('sess-1', undefined, undefined, outboxRepo, streamRepo, new FakeStudentRepo());

    assert.deepEqual(outboxRepo.supersedeCalls, [
      { sessionId: 'sess-1', kind: 'face', stepId: 'step-front', keepId: 'photo-2' },
    ]);
  });

  test('a stale approved attempt found by supersede is unlinked locally', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'face-post-save-retake-'));
    try {
      const staleLocalPath = join(dir, 'stale.jpg');
      writeFileSync(staleLocalPath, 'old photo bytes');
      const approvedRow = makeOutboxItem({ id: 'photo-2', kind: 'face', stepId: 'step-front', attempt: 2 });
      const outboxRepo = new FakeOutboxRepo(
        { approved: 1, superseded: [], approvedRows: [approvedRow] },
        [approvedRow],
        { 'face:step-front': [{ id: 'photo-1', localPath: staleLocalPath, fsFileId: null }] }
      );
      const streamRepo = new FakeStreamRepo([]);

      await approveSessionUpload('sess-1', undefined, undefined, outboxRepo, streamRepo, new FakeStudentRepo());

      assert.equal(existsSync(staleLocalPath), false, 'the stale attempt\'s local file must be removed');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('no stale attempt found is a harmless no-op — the common case, most attempts are never retaken', async () => {
    const approvedRow = makeOutboxItem({ id: 'photo-1', kind: 'face', stepId: 'step-front', attempt: 1 });
    const outboxRepo = new FakeOutboxRepo(
      { approved: 1, superseded: [], approvedRows: [approvedRow] },
      [approvedRow]
    );
    const streamRepo = new FakeStreamRepo([]);

    const result = await approveSessionUpload('sess-1', undefined, undefined, outboxRepo, streamRepo, new FakeStudentRepo());

    assert.equal(result.approved, 1);
    assert.equal(outboxRepo.supersedeCalls.length, 1, 'still checked — just found nothing stale');
  });

  test('a newly enqueued video is checked for an older finished recording of the same camera, and the old capture_streams row is removed', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'face-post-save-retake-video-'));
    try {
      const newPath = join(dir, 'new.webm');
      writeFileSync(newPath, 'new video bytes');
      const outboxRepo = new FakeOutboxRepo();
      const oldStream = makeStream({ id: 'stream-old', cameraId: 'CENTER', localPath: '/old.webm' });
      const streamRepo = new FakeStreamRepo(
        [makeStream({ id: 'stream-new', cameraId: 'CENTER', localPath: newPath })],
        { 'video-session-1:CENTER': [oldStream] }
      );

      await approveSessionUpload(
        'sess-1',
        undefined,
        { videoSessionId: 'video-session-1' },
        outboxRepo,
        streamRepo,
        new FakeStudentRepo()
      );

      // The old recording's outbox row (if it had one) is superseded via the
      // same mechanism as a photo — keyed on kind='video', stepId=its own
      // capture_streams id, with an impossible keepId since there is nothing
      // else at that exact (kind, stepId) to keep.
      assert.ok(
        outboxRepo.supersedeCalls.some((c) => c.kind === 'video' && c.stepId === 'stream-old'),
        'checked the old recording for a stale outbox row'
      );
      assert.deepEqual(streamRepo.deletedIds, ['stream-old']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a video with no older recording of the same camera deletes nothing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'face-post-save-retake-video-'));
    try {
      const newPath = join(dir, 'new.webm');
      writeFileSync(newPath, 'new video bytes');
      const outboxRepo = new FakeOutboxRepo();
      const streamRepo = new FakeStreamRepo([makeStream({ id: 'stream-new', cameraId: 'CENTER', localPath: newPath })]);

      await approveSessionUpload(
        'sess-1',
        undefined,
        { videoSessionId: 'video-session-1' },
        outboxRepo,
        streamRepo,
        new FakeStudentRepo()
      );

      assert.deepEqual(streamRepo.deletedIds, []);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
