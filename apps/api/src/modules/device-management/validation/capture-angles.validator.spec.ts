import { validateCaptureAngles } from './capture-angles.validator';

/**
 * Pure-function checks, no database - see
 * docs/plans/multi-camera-device-management-discussion.md for the contract:
 * 3-5 steps, exactly one FRONT, known types/roles, and (when
 * simultaneousCapture) every step resolving to a distinct camera role.
 */
function step(type: string, extra: Record<string, unknown> = {}) {
  return { id: type.toLowerCase(), type, instruction: '', capture: { enabled: true }, ...extra };
}

describe('validateCaptureAngles', () => {
  test('null angles (app default) are always accepted', () => {
    expect(validateCaptureAngles(null, false)).toEqual({ ok: true });
    expect(validateCaptureAngles(undefined, true)).toEqual({ ok: true });
  });

  test('rejects fewer than 3 steps', () => {
    const angles = [step('FRONT'), step('LEFT')];
    const result = validateCaptureAngles(angles, false);
    expect(result).toEqual({ ok: false, reason: 'Cần từ 3 đến 5 khung hình' });
  });

  test('rejects more than 5 steps', () => {
    const angles = [
      step('FRONT'),
      step('LEFT'),
      step('RIGHT'),
      step('UP'),
      step('DOWN'),
      step('CUSTOM'),
    ];
    const result = validateCaptureAngles(angles, false);
    expect(result).toEqual({ ok: false, reason: 'Cần từ 3 đến 5 khung hình' });
  });

  test('accepts exactly 3 valid steps with one FRONT', () => {
    const angles = [step('FRONT'), step('LEFT'), step('RIGHT')];
    expect(validateCaptureAngles(angles, false)).toEqual({ ok: true });
  });

  test('rejects a set missing the FRONT step', () => {
    const angles = [step('LEFT'), step('RIGHT'), step('UP')];
    const result = validateCaptureAngles(angles, false);
    expect(result).toEqual({ ok: false, reason: 'Phải có đúng một khung FRONT' });
  });

  test('rejects two FRONT steps', () => {
    const angles = [step('FRONT'), step('FRONT'), step('LEFT')];
    const result = validateCaptureAngles(angles, false);
    expect(result).toEqual({ ok: false, reason: 'Phải có đúng một khung FRONT' });
  });

  test('rejects an unknown step type', () => {
    const angles = [step('FRONT'), step('LEFT'), step('SIDEWAYS')];
    const result = validateCaptureAngles(angles, false);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('SIDEWAYS');
  });

  test('rejects an invalid cameraRole', () => {
    const angles = [step('FRONT'), step('LEFT'), step('RIGHT', { cameraRole: 'BACK' })];
    const result = validateCaptureAngles(angles, false);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('BACK');
  });

  test('simultaneous capture accepts FRONT+LEFT+RIGHT (distinct default roles)', () => {
    const angles = [step('FRONT'), step('LEFT'), step('RIGHT')];
    expect(validateCaptureAngles(angles, true)).toEqual({ ok: true });
  });

  test('simultaneous capture rejects two steps that both default to CENTER', () => {
    // FRONT defaults to CENTER, and so does CUSTOM (the "other" case) unless
    // it sets its own cameraRole — this is the collision the flag exists to
    // catch.
    const angles = [step('FRONT'), step('CUSTOM'), step('LEFT')];
    const result = validateCaptureAngles(angles, true);
    expect(result).toEqual({
      ok: false,
      reason: 'Chụp đồng thời cần mỗi khung một camera riêng: trùng vai trò CENTER',
    });
  });

  test('non-simultaneous capture accepts duplicate effective roles', () => {
    const angles = [step('FRONT'), step('CUSTOM'), step('LEFT')];
    expect(validateCaptureAngles(angles, false)).toEqual({ ok: true });
  });
});
