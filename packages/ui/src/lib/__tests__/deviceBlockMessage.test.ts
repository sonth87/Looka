import test from 'node:test';
import assert from 'node:assert/strict';
import { deviceUnauthorizedMessage, GENERIC_UNAUTHORIZED_MESSAGE } from '../deviceBlockMessage.js';

test('deviceUnauthorizedMessage picks a specific message for each known reason', () => {
  assert.match(deviceUnauthorizedMessage('INVALID_SECRET'), /không còn hợp lệ/);
  assert.match(deviceUnauthorizedMessage('REVOKED'), /đã bị thu hồi/);
  assert.match(deviceUnauthorizedMessage('EXPIRED'), /đã hết hạn/);
  assert.match(deviceUnauthorizedMessage('NOT_FOUND'), /không còn tồn tại/);
});

test('every known-reason message differs from the generic fallback', () => {
  const reasons: Array<'INVALID_SECRET' | 'REVOKED' | 'EXPIRED' | 'NOT_FOUND'> = [
    'INVALID_SECRET',
    'REVOKED',
    'EXPIRED',
    'NOT_FOUND',
  ];
  for (const reason of reasons) {
    assert.notEqual(deviceUnauthorizedMessage(reason), GENERIC_UNAUTHORIZED_MESSAGE);
  }
});

test('deviceUnauthorizedMessage falls back to the generic message for UNKNOWN, null, and undefined', () => {
  assert.equal(deviceUnauthorizedMessage('UNKNOWN'), GENERIC_UNAUTHORIZED_MESSAGE);
  assert.equal(deviceUnauthorizedMessage(null), GENERIC_UNAUTHORIZED_MESSAGE);
  assert.equal(deviceUnauthorizedMessage(undefined), GENERIC_UNAUTHORIZED_MESSAGE);
});
