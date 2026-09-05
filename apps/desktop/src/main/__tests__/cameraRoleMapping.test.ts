import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeCameraRoleMapping } from '../secrets.js';

describe('sanitizeCameraRoleMapping', () => {
  test('accepts every known role (CENTER/LEFT/RIGHT/UP/DOWN)', () => {
    const input = {
      CENTER: 'cam-center',
      LEFT: 'cam-left',
      RIGHT: 'cam-right',
      UP: 'cam-up',
      DOWN: 'cam-down',
    };
    assert.deepEqual(sanitizeCameraRoleMapping(input), input);
  });

  test('drops a role that is not one of CAMERA_ROLES', () => {
    const result = sanitizeCameraRoleMapping({
      CENTER: 'cam-center',
      DIAGONAL: 'cam-diagonal',
    });
    assert.deepEqual(result, { CENTER: 'cam-center' });
  });

  test('drops a non-string device id for an otherwise valid role', () => {
    const result = sanitizeCameraRoleMapping({ CENTER: 42, LEFT: 'cam-left' });
    assert.deepEqual(result, { LEFT: 'cam-left' });
  });

  test('returns an empty mapping for null, undefined, or non-object input', () => {
    assert.deepEqual(sanitizeCameraRoleMapping(null), {});
    assert.deepEqual(sanitizeCameraRoleMapping(undefined), {});
    assert.deepEqual(sanitizeCameraRoleMapping('not an object'), {});
    assert.deepEqual(sanitizeCameraRoleMapping(42), {});
  });

  test('an empty object maps to an empty mapping', () => {
    assert.deepEqual(sanitizeCameraRoleMapping({}), {});
  });
});
