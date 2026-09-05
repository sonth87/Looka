import test from 'node:test';
import assert from 'node:assert/strict';
import { CaptureWorkflow } from '@face/core';
import {
  checkFramesReadiness,
  framesForWorkflow,
  isFrameLikelyBlank,
  allSideFramesReady,
  firstNotReadyFrameRole,
} from '../multiFrame.js';

function workflow(steps: CaptureWorkflow['steps']): CaptureWorkflow {
  return {
    id: 'wf_test',
    name: 'Test workflow',
    version: 1,
    steps,
  };
}

test('framesForWorkflow uses defaultCameraRoleForStepType when a step sets no explicit role', () => {
  const wf = workflow([
    { id: 's-front', type: 'FRONT', instruction: 'Nhìn thẳng', capture: { enabled: true } },
    { id: 's-left', type: 'LEFT', instruction: 'Quay trái', capture: { enabled: true } },
  ]);

  const frames = framesForWorkflow(wf);

  assert.equal(frames.length, 2);
  assert.equal(frames[0].role, 'CENTER');
  assert.equal(frames[1].role, 'LEFT');
  assert.equal(frames[0].label, 'FRONT');
  assert.equal(frames[0].stepId, 's-front');
});

test('framesForWorkflow honours an explicit cameraRole over the type default', () => {
  const wf = workflow([
    { id: 's-left-covered', type: 'LEFT', instruction: 'Quay trái', capture: { enabled: true }, cameraRole: 'CENTER' },
  ]);

  const frames = framesForWorkflow(wf);

  assert.equal(frames[0].role, 'CENTER');
});

test('framesForWorkflow defaults a CUSTOM step to CENTER', () => {
  const wf = workflow([
    { id: 's-custom', type: 'CUSTOM', instruction: 'Tuỳ chỉnh', capture: { enabled: true } },
  ]);

  const frames = framesForWorkflow(wf);

  assert.equal(frames[0].role, 'CENTER');
});

test('checkFramesReadiness is ok with 3 distinct, connected cameras', () => {
  const frames = framesForWorkflow(
    workflow([
      { id: 's-front', type: 'FRONT', instruction: 'a', capture: { enabled: true } },
      { id: 's-left', type: 'LEFT', instruction: 'b', capture: { enabled: true } },
      { id: 's-right', type: 'RIGHT', instruction: 'c', capture: { enabled: true } },
    ])
  );
  const devices = [
    { id: 'dev-center', label: 'Center cam' },
    { id: 'dev-left', label: 'Left cam' },
    { id: 'dev-right', label: 'Right cam' },
  ];
  const mapping = { CENTER: 'dev-center', LEFT: 'dev-left', RIGHT: 'dev-right' };

  const preflight = checkFramesReadiness(frames, mapping, devices);

  assert.equal(preflight.ok, true);
  assert.equal(preflight.missing.length, 0);
  assert.equal(preflight.duplicates.length, 0);
  assert.equal(preflight.frames.length, 3);
  assert.equal(preflight.frames.every((f) => f.connected), true);
});

test('checkFramesReadiness reports missing when a role has no mapping at all', () => {
  const frames = framesForWorkflow(
    workflow([
      { id: 's-front', type: 'FRONT', instruction: 'a', capture: { enabled: true } },
      { id: 's-left', type: 'LEFT', instruction: 'b', capture: { enabled: true } },
    ])
  );
  const devices = [{ id: 'dev-center', label: 'Center cam' }];
  const mapping = { CENTER: 'dev-center' }; // LEFT never mapped

  const preflight = checkFramesReadiness(frames, mapping, devices);

  assert.equal(preflight.ok, false);
  assert.equal(preflight.missing.length, 1);
  assert.equal(preflight.missing[0].stepId, 's-left');
  assert.equal(preflight.missing[0].deviceId, null);
});

test('checkFramesReadiness reports missing when the mapped device is not connected', () => {
  const frames = framesForWorkflow(
    workflow([{ id: 's-left', type: 'LEFT', instruction: 'b', capture: { enabled: true } }])
  );
  const devices: Array<{ id: string; label: string }> = []; // nothing plugged in
  const mapping = { LEFT: 'dev-left' }; // mapped, but not among devices

  const preflight = checkFramesReadiness(frames, mapping, devices);

  assert.equal(preflight.ok, false);
  assert.equal(preflight.missing.length, 1);
  assert.equal(preflight.missing[0].deviceId, 'dev-left');
  assert.equal(preflight.missing[0].connected, false);
});

test('checkFramesReadiness reports a duplicate when two roles share one physical camera', () => {
  const frames = framesForWorkflow(
    workflow([
      { id: 's-front', type: 'FRONT', instruction: 'a', capture: { enabled: true } },
      { id: 's-left', type: 'LEFT', instruction: 'b', capture: { enabled: true } },
    ])
  );
  const devices = [{ id: 'dev-shared', label: 'Only cam' }];
  const mapping = { CENTER: 'dev-shared', LEFT: 'dev-shared' };

  const preflight = checkFramesReadiness(frames, mapping, devices);

  assert.equal(preflight.ok, false);
  assert.equal(preflight.missing.length, 0);
  assert.equal(preflight.duplicates.length, 1);
  assert.equal(preflight.duplicates[0].length, 2);
  const stepIds = preflight.duplicates[0].map((f) => f.stepId).sort();
  assert.deepEqual(stepIds, ['s-front', 's-left']);
});

// --- isFrameLikelyBlank (2026-09-05 black-frame field bug) --------------

/** Builds a flat-color Uint8ClampedArray the size of `width * height` RGBA pixels. */
function solidPixels(width: number, height: number, r: number, g: number, b: number): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = r;
    pixels[i + 1] = g;
    pixels[i + 2] = b;
    pixels[i + 3] = 255;
  }
  return pixels;
}

/** Builds a high-contrast checkerboard so mean AND variance both land far from every rejection threshold — a stand-in for a real, varied captured frame. */
function checkerboardPixels(size: number): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const on = (x + y) % 2 === 0;
      const v = on ? 235 : 20;
      pixels[i] = v;
      pixels[i + 1] = v;
      pixels[i + 2] = v;
      pixels[i + 3] = 255;
    }
  }
  return pixels;
}

test('isFrameLikelyBlank rejects a fully black frame — the exact field bug (face-step-right-2.jpg)', () => {
  const pixels = solidPixels(32, 32, 0, 0, 0);
  assert.equal(isFrameLikelyBlank(pixels, 32, 32), true);
});

test('isFrameLikelyBlank rejects a solid mid-gray frame (zero variance) even though its mean is not near-black', () => {
  const pixels = solidPixels(32, 32, 128, 128, 128);
  assert.equal(isFrameLikelyBlank(pixels, 32, 32), true);
});

test('isFrameLikelyBlank rejects a solid white frame (zero variance) — a stuck driver output is just as unusable as black', () => {
  const pixels = solidPixels(32, 32, 255, 255, 255);
  assert.equal(isFrameLikelyBlank(pixels, 32, 32), true);
});

test('isFrameLikelyBlank accepts a real, varied frame', () => {
  const pixels = checkerboardPixels(32);
  assert.equal(isFrameLikelyBlank(pixels, 32, 32), false);
});

test('isFrameLikelyBlank treats empty/zero-size input as blank rather than throwing', () => {
  assert.equal(isFrameLikelyBlank(new Uint8ClampedArray(0), 0, 0), true);
});

// --- allSideFramesReady / firstNotReadyFrameRole (shutter-enable gate) --

function sideFrames(): ReturnType<typeof framesForWorkflow> {
  return framesForWorkflow(
    workflow([
      { id: 's-front', type: 'FRONT', instruction: 'a', capture: { enabled: true } },
      { id: 's-left', type: 'LEFT', instruction: 'b', capture: { enabled: true } },
      { id: 's-right', type: 'RIGHT', instruction: 'c', capture: { enabled: true } },
    ])
  );
}

test('allSideFramesReady ignores CENTER and requires every side frame ready', () => {
  const frames = sideFrames();
  assert.equal(allSideFramesReady(frames, {}), false);
  assert.equal(allSideFramesReady(frames, { 's-left': true }), false);
  assert.equal(allSideFramesReady(frames, { 's-left': true, 's-right': true }), true);
  // CENTER's own readiness (if ever present in the map) must not matter.
  assert.equal(
    allSideFramesReady(frames, { 's-front': false, 's-left': true, 's-right': true }),
    true
  );
});

test('firstNotReadyFrameRole reports the first not-ready side frame in step order, null once all are ready', () => {
  const frames = sideFrames();
  assert.equal(firstNotReadyFrameRole(frames, {}), 'LEFT');
  assert.equal(firstNotReadyFrameRole(frames, { 's-left': true }), 'RIGHT');
  assert.equal(firstNotReadyFrameRole(frames, { 's-left': true, 's-right': true }), null);
});

test('firstNotReadyFrameRole is null when the workflow has no side frames at all', () => {
  const frames = framesForWorkflow(
    workflow([{ id: 's-front', type: 'FRONT', instruction: 'a', capture: { enabled: true } }])
  );
  assert.equal(firstNotReadyFrameRole(frames, {}), null);
});
