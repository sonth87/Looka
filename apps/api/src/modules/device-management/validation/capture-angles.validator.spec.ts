import {
  computeRequiredCameraCount,
  validateCaptureAngles,
} from './capture-angles.validator';

/**
 * Pure-function checks, no database — see this module's own doc comment for
 * the current (2026-09-08, min lowered from 2 the same day) contract:
 * 1-20 steps, exactly one `isCardSource: true`, known types/roles, and no
 * more "distinct camera role when simultaneous" block (that whole concept
 * left the campaign for the kiosk's own Camera Setup — see
 * `computeRequiredCameraCount`'s tests below for its non-blocking
 * replacement).
 */
function step(type: string, extra: Record<string, unknown> = {}) {
  return {
    id: type.toLowerCase(),
    type,
    instruction: '',
    capture: { enabled: true },
    ...extra,
  };
}

describe('validateCaptureAngles', () => {
  test('null/undefined angles (app default) are always accepted', () => {
    expect(validateCaptureAngles(null)).toEqual({ ok: true });
    expect(validateCaptureAngles(undefined)).toEqual({ ok: true });
  });

  test('rejects zero steps', () => {
    const result = validateCaptureAngles([]);
    expect(result).toEqual({ ok: false, reason: 'Cần từ 1 đến 20 khung hình' });
  });

  test('accepts exactly 1 step, as long as it is the card-source step', () => {
    const angles = [step('FRONT', { isCardSource: true })];
    expect(validateCaptureAngles(angles)).toEqual({ ok: true });
  });

  test('rejects more than 20 steps', () => {
    const angles = [
      step('FRONT', { isCardSource: true }),
      ...Array.from({ length: 20 }, (_, i) =>
        step('CUSTOM', { id: `custom-${i}` }),
      ),
    ];
    expect(angles.length).toBe(21);
    const result = validateCaptureAngles(angles);
    expect(result).toEqual({ ok: false, reason: 'Cần từ 1 đến 20 khung hình' });
  });

  test('accepts exactly 2 valid steps with one card-source step', () => {
    const angles = [step('FRONT', { isCardSource: true }), step('LEFT')];
    expect(validateCaptureAngles(angles)).toEqual({ ok: true });
  });

  test('accepts up to 20 steps with one card-source step', () => {
    const angles = [
      step('FRONT', { isCardSource: true }),
      ...Array.from({ length: 19 }, (_, i) =>
        step('CUSTOM', { id: `custom-${i}` }),
      ),
    ];
    expect(angles.length).toBe(20);
    expect(validateCaptureAngles(angles)).toEqual({ ok: true });
  });

  test('a workflow with no FRONT step at all is accepted, as long as one step is the card source', () => {
    // 2026-09-08: FRONT is no longer special-cased — angleCode/type come
    // from the dynamic catalog (§3.1.6), and a workflow's card-source photo
    // can be any step type.
    const angles = [
      step('CUSTOM', { isCardSource: true }),
      step('LEFT'),
      step('UP'),
    ];
    expect(validateCaptureAngles(angles)).toEqual({ ok: true });
  });

  test('rejects a set with no isCardSource step at all', () => {
    const angles = [step('LEFT'), step('RIGHT'), step('UP')];
    const result = validateCaptureAngles(angles);
    expect(result).toEqual({
      ok: false,
      reason:
        'Phải có đúng một khung được đánh dấu ảnh thẻ (isCardSource) — hiện có 0',
    });
  });

  test('rejects two isCardSource steps', () => {
    const angles = [
      step('FRONT', { isCardSource: true }),
      step('CUSTOM', { isCardSource: true }),
      step('LEFT'),
    ];
    const result = validateCaptureAngles(angles);
    expect(result).toEqual({
      ok: false,
      reason:
        'Phải có đúng một khung được đánh dấu ảnh thẻ (isCardSource) — hiện có 2',
    });
  });

  test('rejects an unknown step type', () => {
    const angles = [
      step('FRONT', { isCardSource: true }),
      step('LEFT'),
      step('SIDEWAYS'),
    ];
    const result = validateCaptureAngles(angles);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('SIDEWAYS');
  });

  test('rejects an invalid cameraRole', () => {
    const angles = [
      step('FRONT', { isCardSource: true }),
      step('LEFT'),
      step('RIGHT', { cameraRole: 'BACK' }),
    ];
    const result = validateCaptureAngles(angles);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('BACK');
  });

  test('a duplicated effective camera role across steps is accepted (the old "simultaneous" block is gone)', () => {
    // FRONT and CUSTOM both default to CENTER when no explicit cameraRole is
    // set - this used to be rejected under simultaneousCapture. That whole
    // concept left the campaign for the kiosk's own settings (§3.9), so this
    // must now pass unconditionally.
    const angles = [
      step('FRONT', { isCardSource: true }),
      step('CUSTOM'),
      step('LEFT'),
    ];
    expect(validateCaptureAngles(angles)).toEqual({ ok: true });
  });

  test('explicit duplicate cameraRole values are also accepted', () => {
    const angles = [
      step('FRONT', { isCardSource: true, cameraRole: 'CENTER' }),
      step('LEFT', { cameraRole: 'CENTER' }),
    ];
    expect(validateCaptureAngles(angles)).toEqual({ ok: true });
  });
});

describe('computeRequiredCameraCount', () => {
  test('returns 1 for null/undefined (app default)', () => {
    expect(computeRequiredCameraCount(null)).toBe(1);
    expect(computeRequiredCameraCount(undefined)).toBe(1);
  });

  test('returns 1 when no step sets an explicit cameraRole', () => {
    const angles = [step('FRONT', { isCardSource: true }), step('LEFT')];
    expect(computeRequiredCameraCount(angles)).toBe(1);
  });

  test('counts distinct explicit cameraRole values', () => {
    const angles = [
      step('FRONT', { isCardSource: true, cameraRole: 'CENTER' }),
      step('LEFT', { cameraRole: 'LEFT' }),
      step('LEFT', { id: 'left-45', cameraRole: 'LEFT' }),
      step('RIGHT', { cameraRole: 'RIGHT' }),
    ];
    expect(computeRequiredCameraCount(angles)).toBe(3);
  });

  test('is never a validation error - purely informational', () => {
    // 4 distinct roles requested but the campaign only has 5 max steps -
    // this must never throw or reject, only report the count.
    const angles = [
      step('FRONT', { isCardSource: true, cameraRole: 'CENTER' }),
      step('LEFT', { cameraRole: 'LEFT' }),
      step('RIGHT', { cameraRole: 'RIGHT' }),
      step('UP', { cameraRole: 'UP' }),
    ];
    expect(computeRequiredCameraCount(angles)).toBe(4);
    expect(validateCaptureAngles(angles)).toEqual({ ok: true });
  });
});
