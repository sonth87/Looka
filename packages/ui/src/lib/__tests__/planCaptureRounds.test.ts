import test from 'node:test';
import assert from 'node:assert/strict';
import { CameraRole, CaptureStep } from '@face/core';
import {
  planCaptureRounds,
  DEFAULT_PHYSICAL_ANGLES,
  RoundStepPlan,
} from '../multiFrame.js';

/**
 * Coverage for `planCaptureRounds` — the round-planning replacement for
 * "block the session when a camera is missing" (discussion doc §3.1.5).
 *
 * The 10-step fixture below is chosen to reproduce the doc's own worked
 * example (§3.1.5, "Ví dụ 10 ảnh, 2 camera (CENTER + LEFT)") exactly: small
 * (15°) turns are configured to prefer CENTER directly (a CMS operator's
 * realistic choice — a subtle turn is fine to just ask the subject to hold
 * in front of the main camera), while the larger 30°/45° turns and the two
 * CUSTOM diagonal shots prefer their own side camera. Round-by-round, this
 * produces exactly the doc's table when only CENTER+LEFT are mapped — see
 * the "matches the discussion doc's worked 2-camera example" test below.
 */
function tenStepCampaign(): CaptureStep[] {
  const step = (partial: Partial<CaptureStep> & Pick<CaptureStep, 'id' | 'type'>): CaptureStep => ({
    instruction: partial.id,
    capture: { enabled: true },
    ...partial,
  });

  return [
    step({
      id: 'front',
      type: 'FRONT',
      cameraRole: 'CENTER',
      isCardSource: true,
      pose: { yaw: { target: 0, tolerance: 10 }, pitch: { target: 0, tolerance: 10 } },
    }),
    step({ id: 'left-30', type: 'LEFT', angleCode: 'LEFT_30', cameraRole: 'LEFT', pose: { yaw: { target: -30, tolerance: 7 } } }),
    step({ id: 'right-30', type: 'RIGHT', angleCode: 'RIGHT_30', cameraRole: 'RIGHT', pose: { yaw: { target: 30, tolerance: 7 } } }),
    // Small turns are configured to prefer CENTER directly (see this
    // fixture's own doc comment) — NOT a fallback when CENTER is mapped.
    step({ id: 'left-15', type: 'LEFT', angleCode: 'LEFT_15', cameraRole: 'CENTER', pose: { yaw: { target: -15, tolerance: 7 } } }),
    step({ id: 'left-45', type: 'LEFT', angleCode: 'LEFT_45', cameraRole: 'LEFT', pose: { yaw: { target: -45, tolerance: 7 } } }),
    step({ id: 'up', type: 'UP', cameraRole: 'CENTER', pose: { pitch: { target: 25, tolerance: 10 } } }),
    step({
      id: 'up-left',
      type: 'CUSTOM',
      angleCode: 'UP_LEFT',
      cameraRole: 'LEFT',
      pose: { yaw: { target: -30, tolerance: 10 }, pitch: { target: 25, tolerance: 10 } },
    }),
    step({ id: 'down', type: 'DOWN', cameraRole: 'CENTER', pose: { pitch: { target: -25, tolerance: 10 } } }),
    step({
      id: 'down-left',
      type: 'CUSTOM',
      angleCode: 'DOWN_LEFT',
      cameraRole: 'LEFT',
      pose: { yaw: { target: -30, tolerance: 10 }, pitch: { target: -25, tolerance: 10 } },
    }),
    step({ id: 'right-15', type: 'RIGHT', angleCode: 'RIGHT_15', cameraRole: 'CENTER', pose: { yaw: { target: 15, tolerance: 7 } } }),
  ];
}

/** Independent (non-grouping) reference for what one step's resolution should be, mirroring §3.1.5 step 1's rule. */
function expectedResolution(
  step: CaptureStep,
  mappedRoles: Set<CameraRole>
): { cameraRole: CameraRole; isFallback: boolean } {
  const CAMERA_ROLES: CameraRole[] = ['CENTER', 'LEFT', 'RIGHT', 'UP', 'DOWN'];
  const preferred = step.cameraRole ?? (step.type === 'CUSTOM' ? 'CENTER' : (step.type as CameraRole));
  if (mappedRoles.has(preferred)) return { cameraRole: preferred, isFallback: false };
  if (mappedRoles.has('CENTER')) return { cameraRole: 'CENTER', isFallback: true };
  if (mappedRoles.size === 1) {
    const [sole] = mappedRoles;
    return { cameraRole: sole, isFallback: true };
  }
  const fallback = CAMERA_ROLES.find((r) => mappedRoles.has(r))!;
  return { cameraRole: fallback, isFallback: true };
}

function expectedGate(step: CaptureStep, cameraRole: CameraRole): { yaw?: number; pitch?: number } {
  const physical = DEFAULT_PHYSICAL_ANGLES[cameraRole];
  return {
    yaw: step.pose?.yaw !== undefined ? step.pose.yaw.target - physical.yaw : undefined,
    pitch: step.pose?.pitch !== undefined ? step.pose.pitch.target - physical.pitch : undefined,
  };
}

function assertEveryStepResolvedCorrectly(allPlanned: RoundStepPlan[], steps: CaptureStep[], mappedRoles: Set<CameraRole>) {
  // Every input step shows up exactly once across the whole plan.
  assert.equal(allPlanned.length, steps.length);
  const seenIds = new Set(allPlanned.map((p) => p.step.id));
  assert.equal(seenIds.size, steps.length, 'no duplicate/missing steps');

  for (const plan of allPlanned) {
    const original = steps.find((s) => s.id === plan.step.id)!;
    const expected = expectedResolution(original, mappedRoles);
    assert.equal(plan.cameraRole, expected.cameraRole, `${plan.step.id} cameraRole`);
    assert.equal(plan.isFallback, expected.isFallback, `${plan.step.id} isFallback`);

    const gate = expectedGate(original, expected.cameraRole);
    assert.equal(plan.effectiveYaw, gate.yaw, `${plan.step.id} effectiveYaw`);
    assert.equal(plan.effectivePitch, gate.pitch, `${plan.step.id} effectivePitch`);
  }
}

test('blocks only when zero cameras are mapped at all', () => {
  const plan = planCaptureRounds(tenStepCampaign(), {});
  assert.equal(plan.blocked, true);
  assert.ok(plan.reason && plan.reason.length > 0);
  assert.deepEqual(plan.rounds, []);
});

test('1 camera (CENTER only): never blocks, every step falls back to CENTER, 10 sequential-shaped rounds', () => {
  const steps = tenStepCampaign();
  const plan = planCaptureRounds(steps, { CENTER: 'dev-center' });

  assert.equal(plan.blocked, false);
  // Only one physical camera exists, so no round can ever hold 2 steps
  // (the "distinct camera per round" rule alone forces this) — same
  // headline result as sequential mode: 10 rounds of 1 step each.
  assert.equal(plan.rounds.length, 10);
  for (const round of plan.rounds) assert.equal(round.steps.length, 1);

  const allPlanned = plan.rounds.flatMap((r) => r.steps);
  assertEveryStepResolvedCorrectly(allPlanned, steps, new Set(['CENTER']));
  assert.ok(allPlanned.every((p) => p.cameraRole === 'CENTER'));
});

test('2 cameras (CENTER + LEFT): matches the discussion doc\'s worked 2-camera example exactly', () => {
  const steps = tenStepCampaign();
  const plan = planCaptureRounds(steps, { CENTER: 'dev-center', LEFT: 'dev-left' });

  assert.equal(plan.blocked, false);
  assertEveryStepResolvedCorrectly(plan.rounds.flatMap((r) => r.steps), steps, new Set(['CENTER', 'LEFT']));

  const roundIds = plan.rounds.map((r) => r.steps.map((s) => s.step.id).sort());
  assert.deepEqual(roundIds, [
    ['front', 'left-30'],
    ['right-30'],
    ['left-15', 'left-45'],
    ['up', 'up-left'],
    ['down', 'down-left'],
    ['right-15'],
  ]);
  assert.equal(plan.rounds.length, 6, 'matches "2–3 vòng" territory the doc describes for a well-mapped multi-camera kiosk');

  // Round 1's gate is "nhìn thẳng" (0°) on both axes.
  const round1 = plan.rounds[0].steps;
  const front = round1.find((s) => s.step.id === 'front')!;
  const left30 = round1.find((s) => s.step.id === 'left-30')!;
  assert.equal(front.effectiveYaw, 0);
  assert.equal(left30.effectiveYaw, 0, 'LEFT camera at -30° naturally sees "LEFT 30°" while the subject looks straight ahead');
  assert.equal(front.isFallback, false);
  assert.equal(left30.isFallback, false);

  // Round 3 is the fallback case the doc calls out: CENTER captures "LEFT 15°" for real (subject turns 15°), LEFT captures "LEFT 45°" directly.
  const round3 = plan.rounds[2].steps;
  const left15 = round3.find((s) => s.step.id === 'left-15')!;
  const left45 = round3.find((s) => s.step.id === 'left-45')!;
  assert.equal(left15.cameraRole, 'CENTER');
  assert.equal(left15.effectiveYaw, -15);
  assert.equal(left45.cameraRole, 'LEFT');
  assert.equal(left45.effectiveYaw, -15);
});

test('3 cameras (CENTER + LEFT + RIGHT): still fully resolved, no round reuses a camera, no fallback needed', () => {
  const steps = tenStepCampaign();
  const mapping = { CENTER: 'dev-center', LEFT: 'dev-left', RIGHT: 'dev-right' };
  const plan = planCaptureRounds(steps, mapping);

  assert.equal(plan.blocked, false);
  const allPlanned = plan.rounds.flatMap((r) => r.steps);
  assertEveryStepResolvedCorrectly(allPlanned, steps, new Set(['CENTER', 'LEFT', 'RIGHT']));
  // Every step's preferred role is one of CENTER/LEFT/RIGHT in this fixture, all mapped -> no fallback anywhere.
  assert.ok(allPlanned.every((p) => p.isFallback === false));

  for (const round of plan.rounds) {
    const roles = round.steps.map((s) => s.cameraRole);
    assert.equal(new Set(roles).size, roles.length, 'no round uses the same physical camera twice');
  }
  // More cameras can only reduce or hold steady the number of rounds needed versus the 2-camera case.
  assert.ok(plan.rounds.length <= 6);
});

test('5 cameras (every role mapped): no step is ever a fallback', () => {
  const steps = tenStepCampaign();
  const mapping = {
    CENTER: 'dev-center',
    LEFT: 'dev-left',
    RIGHT: 'dev-right',
    UP: 'dev-up',
    DOWN: 'dev-down',
  };
  const plan = planCaptureRounds(steps, mapping);

  assert.equal(plan.blocked, false);
  const allPlanned = plan.rounds.flatMap((r) => r.steps);
  assertEveryStepResolvedCorrectly(allPlanned, steps, new Set(['CENTER', 'LEFT', 'RIGHT', 'UP', 'DOWN']));
  assert.ok(allPlanned.every((p) => p.isFallback === false));

  for (const round of plan.rounds) {
    const roles = round.steps.map((s) => s.cameraRole);
    assert.equal(new Set(roles).size, roles.length);
  }
});

for (const cameraCount of [1, 2, 3, 5] as const) {
  test(`sequential mode with ${cameraCount} camera(s): always exactly one step per round, in input order`, () => {
    const steps = tenStepCampaign();
    const mappingByCount: Record<number, Record<string, string>> = {
      1: { CENTER: 'dev-center' },
      2: { CENTER: 'dev-center', LEFT: 'dev-left' },
      3: { CENTER: 'dev-center', LEFT: 'dev-left', RIGHT: 'dev-right' },
      5: { CENTER: 'dev-center', LEFT: 'dev-left', RIGHT: 'dev-right', UP: 'dev-up', DOWN: 'dev-down' },
    };
    const mapping = mappingByCount[cameraCount];
    const plan = planCaptureRounds(steps, mapping, { sequencing: 'sequential' });

    assert.equal(plan.blocked, false);
    assert.equal(plan.rounds.length, steps.length);
    plan.rounds.forEach((round, idx) => {
      assert.equal(round.steps.length, 1);
      assert.equal(round.steps[0].step.id, steps[idx].id, 'sequential mode preserves input order 1:1');
    });

    assertEveryStepResolvedCorrectly(
      plan.rounds.flatMap((r) => r.steps),
      steps,
      new Set(Object.keys(mapping) as CameraRole[])
    );
  });
}

test('resolveStepCamera fallback: sole non-CENTER camera is used when CENTER is not mapped', () => {
  const steps: CaptureStep[] = [
    { id: 'front', type: 'FRONT', instruction: 'a', capture: { enabled: true }, pose: { yaw: { target: 0, tolerance: 10 } } },
  ];
  const plan = planCaptureRounds(steps, { LEFT: 'dev-left' });

  assert.equal(plan.blocked, false);
  const [only] = plan.rounds.flatMap((r) => r.steps);
  assert.equal(only.cameraRole, 'LEFT');
  assert.equal(only.isFallback, true);
  // yaw target 0, LEFT physically mounted at -30 -> subject must turn +30 for CENTER's own step to land on LEFT's lens.
  assert.equal(only.effectiveYaw, 30);
});

test('resolveStepCamera fallback: no CENTER and 2+ mapped roles picks the first in CAMERA_ROLES order, deterministically', () => {
  const steps: CaptureStep[] = [
    { id: 'front', type: 'FRONT', instruction: 'a', capture: { enabled: true } },
  ];
  const plan1 = planCaptureRounds(steps, { RIGHT: 'dev-right', LEFT: 'dev-left' });
  const plan2 = planCaptureRounds(steps, { LEFT: 'dev-left', RIGHT: 'dev-right' });

  // Same mapping regardless of key insertion order -> same deterministic pick (LEFT precedes RIGHT in CAMERA_ROLES).
  assert.equal(plan1.rounds[0].steps[0].cameraRole, 'LEFT');
  assert.equal(plan2.rounds[0].steps[0].cameraRole, 'LEFT');
});

test('connectedDeviceIds: a role mapped to a device not currently connected falls back exactly like an unmapped role', () => {
  const steps = tenStepCampaign();
  // RIGHT is "mapped" in roleMapping (e.g. a stale/persisted value, or a
  // device this build's own enumerateDevices() now excludes for an
  // unrelated reason — see planCaptureRounds' own doc comment), but its
  // device id is absent from connectedDeviceIds, i.e. not actually usable.
  const mapping = { CENTER: 'dev-center', LEFT: 'dev-left', RIGHT: 'dev-right' };
  const plan = planCaptureRounds(steps, mapping, {
    connectedDeviceIds: ['dev-center', 'dev-left'],
  });

  assert.equal(plan.blocked, false);
  const allPlanned = plan.rounds.flatMap((r) => r.steps);
  // Resolved exactly as if RIGHT had never been mapped at all.
  assertEveryStepResolvedCorrectly(allPlanned, steps, new Set(['CENTER', 'LEFT']));
  // No step is ever routed to RIGHT's (unreachable) camera.
  assert.ok(allPlanned.every((p) => p.cameraRole !== 'RIGHT'));
});

test('connectedDeviceIds: every mapped device disconnected blocks with a distinct reason from "never mapped"', () => {
  const steps = tenStepCampaign();
  const plan = planCaptureRounds(steps, { CENTER: 'dev-center' }, { connectedDeviceIds: [] });

  assert.equal(plan.blocked, true);
  assert.deepEqual(plan.rounds, []);
  assert.notEqual(plan.reason, planCaptureRounds(steps, {}).reason);
});

test('connectedDeviceIds omitted (default): unchanged from previous behaviour — roleMapping string presence alone is trusted', () => {
  const steps = tenStepCampaign();
  const withoutOption = planCaptureRounds(steps, { CENTER: 'dev-center', LEFT: 'dev-left' });
  const withUndefined = planCaptureRounds(steps, { CENTER: 'dev-center', LEFT: 'dev-left' }, {});

  assert.deepEqual(withoutOption, withUndefined);
  assert.equal(withoutOption.blocked, false);
});

test('physicalAngles override changes the computed gate', () => {
  const steps: CaptureStep[] = [
    { id: 'left-30', type: 'LEFT', instruction: 'a', capture: { enabled: true }, cameraRole: 'LEFT', pose: { yaw: { target: -30, tolerance: 7 } } },
  ];
  const withDefault = planCaptureRounds(steps, { LEFT: 'dev-left' });
  assert.equal(withDefault.rounds[0].steps[0].effectiveYaw, 0); // -30 - (-30)

  const withOverride = planCaptureRounds(steps, { LEFT: 'dev-left' }, { physicalAngles: { LEFT: { yaw: -45 } } });
  assert.equal(withOverride.rounds[0].steps[0].effectiveYaw, 15); // -30 - (-45)
});

test('gate matching tolerates only steps sharing an axis; unconstrained axes never block grouping', () => {
  const steps: CaptureStep[] = [
    // Pitch-only step (no yaw opinion at all).
    { id: 'up', type: 'UP', instruction: 'a', capture: { enabled: true }, cameraRole: 'CENTER', pose: { pitch: { target: 25, tolerance: 10 } } },
    // Yaw-only step with the SAME resolved camera (CENTER) -> must NOT
    // share a round with 'up' even though the axes don't conflict, because
    // both resolve to CENTER and a round can't reuse one camera twice.
    { id: 'right-15', type: 'RIGHT', instruction: 'b', capture: { enabled: true }, cameraRole: 'CENTER', pose: { yaw: { target: 15, tolerance: 7 } } },
  ];
  const plan = planCaptureRounds(steps, { CENTER: 'dev-center' });
  assert.equal(plan.rounds.length, 2, 'same physical camera cannot fire twice in one round even with compatible axes');
});
