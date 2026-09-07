import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import type { OutboxItem } from '@face/database';
import { buildSessionReportPayload, type SessionApprovalStepInfo } from '../uploads.js';

/**
 * buildSessionReportPayload() is the pure half of approveSessionUpload() —
 * see that function's own doc comment in uploads.ts for why the report
 * builder is split out as a standalone, exported function. This suite
 * exercises it directly with fake OutboxItem rows, the same "no Electron
 * needed" reasoning streams.test.ts documents for endVideoStream()'s
 * injectable repo: the real approveSessionUpload() needs getDatabase(),
 * which needs Electron's `app`, neither of which exists under plain
 * `node --test`.
 */
function makeRow(over: Partial<OutboxItem> = {}): OutboxItem {
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

describe('buildSessionReportPayload', () => {
  test('builds the contract payload from outbox rows alone when no steps are supplied', () => {
    const rows = [makeRow()];
    const payload = buildSessionReportPayload(rows, undefined, {
      sessionId: 'sess-1',
      approvedAt: '2026-09-06T10:00:00.000Z',
    });

    assert.equal(payload.sessionId, 'sess-1');
    assert.equal(payload.approvedAt, '2026-09-06T10:00:00.000Z');
    assert.equal(payload.workflowId, undefined);
    // §5 of phase-11's plan fixes these two field names as part of the
    // contract even though the kiosk has nothing to put in them today.
    assert.equal(payload.subjectCode, null);
    assert.equal(payload.subjectName, null);
    // No explicit startedAt and no steps — falls back to the earliest row's created_at.
    assert.equal(payload.startedAt, new Date(1_700_000_000_000).toISOString());
    assert.equal(payload.photos.length, 1);
    assert.deepEqual(payload.photos[0], {
      photoId: 'photo-1',
      stepId: 'step-front',
      stepType: undefined,
      cameraRole: undefined,
      attempt: 1,
      mimeType: 'image/jpeg',
      sizeBytes: 12345,
      sha256: 'a'.repeat(64),
      virtualPath: 'face/2026/sess-1/step-front-1.jpg',
      capturedAt: new Date(1_700_000_000_000).toISOString(),
      localStatus: 'PENDING',
      fsFileId: null,
      fsStatus: null,
    });
  });

  test('merges renderer-provided step context (stepType, cameraRole, capturedAt) by stepId', () => {
    const rows = [
      makeRow({ id: 'p-front', stepId: 'step-front', attempt: 2, createdAt: 1_700_000_010_000 }),
      makeRow({
        id: 'p-left',
        stepId: 'step-left',
        attempt: 1,
        createdAt: 1_700_000_005_000,
        idemKey: 'sess-1:step-left:1:face',
      }),
    ];
    const steps: SessionApprovalStepInfo[] = [
      { stepId: 'step-front', stepType: 'FRONT', cameraRole: 'CENTER', attempt: 2, capturedAt: '2026-09-06T09:59:00.000Z' },
      { stepId: 'step-left', stepType: 'LEFT', cameraRole: 'LEFT', attempt: 1 },
    ];

    const payload = buildSessionReportPayload(rows, steps, {
      sessionId: 'sess-1',
      workflowId: 'workflow_standard_5step',
      startedAt: '2026-09-06T09:58:00.000Z',
      approvedAt: '2026-09-06T10:00:00.000Z',
    });

    assert.equal(payload.workflowId, 'workflow_standard_5step');
    // An explicit startedAt always wins over any row-derived fallback.
    assert.equal(payload.startedAt, '2026-09-06T09:58:00.000Z');

    const front = payload.photos.find((p) => p.photoId === 'p-front')!;
    assert.equal(front.stepType, 'FRONT');
    assert.equal(front.cameraRole, 'CENTER');
    // The renderer's own capturedAt wins over the row's created_at when supplied.
    assert.equal(front.capturedAt, '2026-09-06T09:59:00.000Z');

    const left = payload.photos.find((p) => p.photoId === 'p-left')!;
    assert.equal(left.stepType, 'LEFT');
    assert.equal(left.cameraRole, 'LEFT');
    // No capturedAt on this step's info — falls back to the row's own created_at.
    assert.equal(left.capturedAt, new Date(1_700_000_005_000).toISOString());
  });

  test('an empty survivor list produces an empty photos array without throwing', () => {
    const payload = buildSessionReportPayload([], undefined, {
      sessionId: 'sess-1',
      approvedAt: '2026-09-06T10:00:00.000Z',
    });
    assert.deepEqual(payload.photos, []);
    // No rows and no explicit startedAt — falls back to approvedAt.
    assert.equal(payload.startedAt, '2026-09-06T10:00:00.000Z');
  });

  test('a row with no recoverable stepId reports an empty stepId and a zero attempt rather than throwing', () => {
    // Only reachable in practice for a row whose idem_key does not match the
    // expected shape at all — see UploadOutboxRepository.toItem()'s own doc
    // comment — but the report builder must degrade rather than crash.
    const rows = [makeRow({ stepId: null, attempt: null })];
    const payload = buildSessionReportPayload(rows, undefined, {
      sessionId: 'sess-1',
      approvedAt: '2026-09-06T10:00:00.000Z',
    });
    assert.equal(payload.photos[0].stepId, '');
    assert.equal(payload.photos[0].attempt, 0);
  });
});
