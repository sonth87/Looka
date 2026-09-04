import test from 'node:test';
import assert from 'node:assert/strict';
import { CaptureWorkflow } from '@face/core';
import { checkFramesReadiness, framesForWorkflow } from '../multiFrame.js';

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
