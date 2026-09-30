import test from 'node:test';
import assert from 'node:assert/strict';
import type { CaptureSession, CaptureStep, CaptureStepResult, CaptureWorkflow } from '@face/core';
import {
  MAX_CENTER_SHOTS,
  PENDING_THUMBNAIL_DATA_URL,
  SELECTED_SHOT_NOT_STAGED_MESSAGE,
  buildCenterShotsPublish,
  downscaleImageDataUrl,
  resolveMultiShotStepId,
  selectedAttemptOf,
  selectedShotIndexOf,
  stepShotIndex,
  stripShotsForPersistence,
  thumbnailsForSession,
  withThumbnail,
} from '../centerShots.js';

const step = (id: string, type: CaptureStep['type'], over: Partial<CaptureStep> = {}): CaptureStep => ({
  id,
  type,
  instruction: id,
  capture: { enabled: true },
  ...over,
});

const workflow = (steps: CaptureStep[]): CaptureWorkflow => ({ id: 'wf', name: 'wf', version: 1, steps });

// --- resolveMultiShotStepId -------------------------------------------------

test('resolveMultiShotStepId: the isCardSource step wins among CENTER-role steps', () => {
  const wf = workflow([
    step('front-a', 'FRONT'),
    step('front-b', 'FRONT', { isCardSource: true }),
    step('left', 'LEFT'),
  ]);
  assert.equal(resolveMultiShotStepId(wf, wf), 'front-b');
});

test('resolveMultiShotStepId: an isCardSource step that is NOT a CENTER step is refused', () => {
  // The card photo is a LEFT profile here — multi-shot is about the CENTER
  // camera, so it must fall through to the FRONT step instead.
  const wf = workflow([step('left', 'LEFT', { isCardSource: true }), step('front', 'FRONT')]);
  assert.equal(resolveMultiShotStepId(wf, wf), 'front');
});

test('resolveMultiShotStepId: with no CENTER step at all the feature stays off, even for an isCardSource step', () => {
  const wf = workflow([step('left', 'LEFT', { isCardSource: true }), step('right', 'RIGHT')]);
  assert.equal(resolveMultiShotStepId(wf, wf), null);
});

test('resolveMultiShotStepId: falls back to the first FRONT step, then to the first CENTER-role step', () => {
  const custom = step('custom', 'CUSTOM'); // CUSTOM defaults to CENTER
  const front = step('front', 'FRONT');
  assert.equal(resolveMultiShotStepId(workflow([custom, front]), workflow([custom, front])), 'front');
  assert.equal(resolveMultiShotStepId(workflow([custom, step('left', 'LEFT')]), workflow([custom, step('left', 'LEFT')])), 'custom');
});

test('resolveMultiShotStepId: an explicit cameraRole override decides the logical role', () => {
  // A LEFT-type step explicitly assigned to the CENTER camera is a CENTER step;
  // a FRONT-type step explicitly assigned to LEFT is not.
  const wf1 = workflow([step('left-on-center', 'LEFT', { cameraRole: 'CENTER' })]);
  assert.equal(resolveMultiShotStepId(wf1, wf1), 'left-on-center');
  const wf2 = workflow([step('front-on-left', 'FRONT', { cameraRole: 'LEFT' })]);
  assert.equal(resolveMultiShotStepId(wf2, wf2), null);
});

test('resolveMultiShotStepId: judged on the ORIGINAL workflow, so a one-camera kiosk that baked CENTER into every step still picks the right one', () => {
  const original = workflow([step('front', 'FRONT'), step('left', 'LEFT', { isCardSource: true })]);
  // buildRoundPlan on a single-camera kiosk resolves EVERY step to CENTER.
  const prepared = workflow([
    step('front', 'FRONT', { cameraRole: 'CENTER' }),
    step('left', 'LEFT', { cameraRole: 'CENTER', isCardSource: true }),
  ]);
  // `left` resolves to CENTER in `prepared`, but it is logically LEFT — not a candidate.
  assert.equal(resolveMultiShotStepId(original, prepared), 'front');
});

test('resolveMultiShotStepId: turned off when the round-planned workflow no longer serves that step from CENTER', () => {
  const original = workflow([step('front', 'FRONT'), step('left', 'LEFT')]);
  const preparedElsewhere = workflow([step('front', 'FRONT', { cameraRole: 'LEFT' }), step('left', 'LEFT')]);
  assert.equal(resolveMultiShotStepId(original, preparedElsewhere), null);

  const preparedMissing = workflow([step('left', 'LEFT')]);
  assert.equal(resolveMultiShotStepId(original, preparedMissing), null);

  const preparedStillCenter = workflow([step('front', 'FRONT', { cameraRole: 'CENTER' }), step('left', 'LEFT')]);
  assert.equal(resolveMultiShotStepId(original, preparedStillCenter), 'front');
});

test('resolveMultiShotStepId: an empty workflow has nothing to pick', () => {
  assert.equal(resolveMultiShotStepId(workflow([]), workflow([])), null);
});

// --- stepShotIndex ----------------------------------------------------------

test('stepShotIndex: moves by delta and clamps at both ends without wrapping', () => {
  assert.equal(stepShotIndex(1, 1, 3), 2);
  assert.equal(stepShotIndex(1, -1, 3), 0);
  assert.equal(stepShotIndex(2, 1, 3), 2, 'stays on the last shot');
  assert.equal(stepShotIndex(0, -1, 3), 0, 'stays on the first shot');
  assert.equal(stepShotIndex(1, 0, 3), 1);
});

test('stepShotIndex: a bad current index or an empty set collapses to a valid index', () => {
  assert.equal(stepShotIndex(Number.NaN, 1, 3), 1);
  assert.equal(stepShotIndex(99, -1, 3), 2, 'out-of-range current is pulled back into range');
  assert.equal(stepShotIndex(-5, 1, 3), 0);
  assert.equal(stepShotIndex(2, 1, 0), 0);
  assert.equal(stepShotIndex(0, 1, 1), 0);
});

// --- selectedAttemptOf / buildCenterShotsPublish -----------------------------

const shot = (attempt: number) => ({ attempt, imagePath: `img://${attempt}`, timestamp: 1000 + attempt });

const resultWithShots = (attempts: number[], selectedShotIndex?: number): CaptureStepResult => ({
  stepId: 'step-front',
  stepType: 'FRONT',
  status: 'COMPLETED',
  attempts: attempts.length,
  capturedImagePath: `img://${attempts[selectedShotIndex ?? attempts.length - 1]}`,
  shots: attempts.map(shot),
  ...(selectedShotIndex !== undefined ? { selectedShotIndex } : {}),
});

const sessionOf = (...steps: CaptureStepResult[]): CaptureSession => ({
  id: 'session_1',
  workflowId: 'wf',
  workflowVersion: 1,
  startedAt: 1,
  status: 'COMPLETED',
  steps,
});

test('selectedAttemptOf: returns the selected shot\'s attempt, defaulting to the newest', () => {
  assert.equal(selectedAttemptOf(resultWithShots([1, 3, 4], 0)), 1);
  assert.equal(selectedAttemptOf(resultWithShots([1, 3, 4], 1)), 3);
  assert.equal(selectedAttemptOf(resultWithShots([1, 3, 4])), 4, 'no explicit selection means the newest');
});

test('selectedAttemptOf: undefined for a step without shots, or nothing at all', () => {
  assert.equal(selectedAttemptOf(undefined), undefined);
  assert.equal(selectedAttemptOf(null), undefined);
  const plain: CaptureStepResult = { stepId: 's', stepType: 'LEFT', status: 'COMPLETED', attempts: 1 };
  assert.equal(selectedAttemptOf(plain), undefined);
  assert.equal(selectedAttemptOf({ ...plain, shots: [] }), undefined);
});

test('selectedAttemptOf: an out-of-range selectedShotIndex is clamped, not trusted', () => {
  assert.equal(selectedAttemptOf(resultWithShots([1, 2], 9)), 2);
  assert.equal(selectedAttemptOf(resultWithShots([1, 2], -3)), 1);
});

test('selectedShotIndexOf: the one default (newest) and clamp every reader shares', () => {
  assert.equal(selectedShotIndexOf(resultWithShots([1, 3, 4], 1)), 1);
  assert.equal(selectedShotIndexOf(resultWithShots([1, 3, 4])), 2, 'no explicit selection means the newest');
  assert.equal(selectedShotIndexOf(resultWithShots([1, 2], 9)), 1, 'clamped down');
  assert.equal(selectedShotIndexOf(resultWithShots([1, 2], -3)), 0, 'clamped up');
});

test('selectedShotIndexOf: undefined for a step without shots, or nothing at all', () => {
  assert.equal(selectedShotIndexOf(undefined), undefined);
  assert.equal(selectedShotIndexOf(null), undefined);
  const plain: CaptureStepResult = { stepId: 's', stepType: 'LEFT', status: 'COMPLETED', attempts: 1 };
  assert.equal(selectedShotIndexOf(plain), undefined);
  assert.equal(selectedShotIndexOf({ ...plain, shots: [] }), undefined);
});

test('thumbnail slot: previews are only visible for the session that took them', () => {
  let slot = withThumbnail(null, 'session_a', 1, 'thumb-a1');
  slot = withThumbnail(slot, 'session_a', 3, 'thumb-a3');
  assert.deepEqual(thumbnailsForSession(slot, 'session_a'), { 1: 'thumb-a1', 3: 'thumb-a3' });

  // A different (next student's) session sees nothing of it — and nothing needs pruning.
  assert.deepEqual(thumbnailsForSession(slot, 'session_b'), {});
  assert.deepEqual(thumbnailsForSession(slot, null), {});
  assert.deepEqual(thumbnailsForSession(slot, undefined), {});
  assert.deepEqual(thumbnailsForSession(null, 'session_a'), {});
});

test('thumbnail slot: the next session\'s first preview replaces the slot instead of piling onto it', () => {
  const first = withThumbnail(null, 'session_a', 1, 'thumb-a1');
  const second = withThumbnail(first, 'session_b', 1, 'thumb-b1');

  assert.notEqual(second, first);
  assert.deepEqual(thumbnailsForSession(second, 'session_b'), { 1: 'thumb-b1' });
  assert.deepEqual(thumbnailsForSession(second, 'session_a'), {}, 'the old session\'s previews are gone');
  // The old slot object itself was left untouched.
  assert.deepEqual(first.byAttempt, { 1: 'thumb-a1' });
});

test('buildCenterShotsPublish: null when there is nothing to show', () => {
  assert.equal(buildCenterShotsPublish(null, 'step-front', {}), null);
  assert.equal(buildCenterShotsPublish(undefined, 'step-front', {}), null);
  assert.equal(buildCenterShotsPublish(sessionOf(resultWithShots([1])), 'step-other', {}), null);
  const noShots = sessionOf({ stepId: 'step-front', stepType: 'FRONT', status: 'PENDING', attempts: 0 });
  assert.equal(buildCenterShotsPublish(noShots, 'step-front', {}), null);
});

test('buildCenterShotsPublish: count, selection and one thumbnail per shot, in shot order', () => {
  const session = sessionOf(resultWithShots([1, 3, 4], 1));
  const published = buildCenterShotsPublish(session, 'step-front', {
    1: 'data:image/jpeg;base64,one',
    3: 'data:image/jpeg;base64,three',
    4: 'data:image/jpeg;base64,four',
  });
  assert.deepEqual(published, {
    stepId: 'step-front',
    count: 3,
    selectedIndex: 1,
    thumbnails: ['data:image/jpeg;base64,one', 'data:image/jpeg;base64,three', 'data:image/jpeg;base64,four'],
  });
});

test('buildCenterShotsPublish: a shot whose thumbnail is still being made gets a placeholder so indexes stay aligned', () => {
  const session = sessionOf(resultWithShots([1, 2, 3]));
  const published = buildCenterShotsPublish(session, 'step-front', { 1: 'data:image/jpeg;base64,one' })!;
  assert.equal(published.thumbnails.length, 3);
  assert.equal(published.thumbnails[0], 'data:image/jpeg;base64,one');
  assert.equal(published.thumbnails[1], PENDING_THUMBNAIL_DATA_URL);
  assert.equal(published.thumbnails[2], PENDING_THUMBNAIL_DATA_URL);
  // The placeholder must itself survive the main process's `data:image/` filter.
  assert.ok(PENDING_THUMBNAIL_DATA_URL.startsWith('data:image/'));
  assert.equal(published.selectedIndex, 2, 'defaults to the newest shot');
});

test('buildCenterShotsPublish: null thumbs (extended display closed) sends the counts alone', () => {
  const session = sessionOf(resultWithShots([1, 2]));
  assert.deepEqual(buildCenterShotsPublish(session, 'step-front', null), {
    stepId: 'step-front',
    count: 2,
    selectedIndex: 1,
    thumbnails: [],
  });
});

// --- stripShotsForPersistence -----------------------------------------------

test('stripShotsForPersistence: drops shots/selectedShotIndex from a copy and keeps the selected photo', () => {
  const session = sessionOf(resultWithShots([1, 2, 3], 1), {
    stepId: 'step-left',
    stepType: 'LEFT',
    status: 'COMPLETED',
    attempts: 1,
    capturedImagePath: 'img://left',
  });

  const stripped = stripShotsForPersistence(session);

  assert.notEqual(stripped, session);
  const front = stripped.steps[0];
  assert.equal('shots' in front, false);
  assert.equal('selectedShotIndex' in front, false);
  assert.equal(front.capturedImagePath, 'img://2', 'the selected photo is still carried');
  assert.equal(stripped.steps[1].capturedImagePath, 'img://left');
  // The live session is untouched — the review screen and the save still need the shots.
  assert.equal(session.steps[0].shots!.length, 3);
  assert.equal(session.steps[0].selectedShotIndex, 1);
});

test('stripShotsForPersistence: a session with no shots is returned as-is', () => {
  const session = sessionOf({ stepId: 'step-left', stepType: 'LEFT', status: 'COMPLETED', attempts: 1 });
  assert.equal(stripShotsForPersistence(session), session);
});

// --- downscaleImageDataUrl / constants ---------------------------------------

test('downscaleImageDataUrl: resolves null (never rejects) where there is no DOM', async () => {
  // This suite runs under plain Node: no `Image`, no `document`. Importing the
  // module above already proved nothing DOM-related runs at import time.
  assert.equal(await downscaleImageDataUrl('data:image/jpeg;base64,aaaa'), null);
});

test('constants: a hard ceiling on shots and a Vietnamese refusal message', () => {
  assert.equal(MAX_CENTER_SHOTS, 10);
  assert.ok(SELECTED_SHOT_NOT_STAGED_MESSAGE.length > 0);
  assert.match(SELECTED_SHOT_NOT_STAGED_MESSAGE, /ảnh/);
});
