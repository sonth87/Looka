import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRejectReason } from '../deviceAuth.js';

test('parseRejectReason maps every known errorCode to its reason', () => {
  assert.equal(parseRejectReason(5005), 'INVALID_SECRET');
  assert.equal(parseRejectReason(5001), 'NOT_FOUND');
  assert.equal(parseRejectReason(5003), 'EXPIRED');
  assert.equal(parseRejectReason(5008), 'REVOKED');
});

test('parseRejectReason falls back to UNKNOWN for an old API (errorCode: 401)', () => {
  assert.equal(parseRejectReason(401), 'UNKNOWN');
});

test('parseRejectReason falls back to UNKNOWN for a missing or non-JSON body', () => {
  assert.equal(parseRejectReason(undefined), 'UNKNOWN');
  assert.equal(parseRejectReason(null), 'UNKNOWN');
});

test('parseRejectReason falls back to UNKNOWN for an unrecognized numeric code', () => {
  assert.equal(parseRejectReason(9999), 'UNKNOWN');
});

test('parseRejectReason falls back to UNKNOWN for a non-numeric errorCode', () => {
  assert.equal(parseRejectReason('5005'), 'UNKNOWN');
  assert.equal(parseRejectReason({ code: 5005 }), 'UNKNOWN');
});
