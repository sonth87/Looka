import test from 'node:test';
import assert from 'node:assert/strict';
import { parseActivationPayload, activationFileSupersedesStored } from '../activationFile.js';

test('parseActivationPayload extracts a well-formed file', () => {
  const raw = JSON.stringify({
    deviceId: 'dev-1',
    deviceSecret: 'secret-1',
    campaignId: 'camp-1',
    authApiEndpoint: 'https://admin.example.com',
  });
  assert.deepEqual(parseActivationPayload(raw), {
    deviceId: 'dev-1',
    deviceSecret: 'secret-1',
    campaignId: 'camp-1',
    apiBaseUrl: 'https://admin.example.com',
  });
});

test('parseActivationPayload defaults apiBaseUrl to null when authApiEndpoint is absent', () => {
  const raw = JSON.stringify({ deviceId: 'dev-1', deviceSecret: 'secret-1', campaignId: 'camp-1' });
  assert.equal(parseActivationPayload(raw).apiBaseUrl, null);
});

test('parseActivationPayload throws on malformed JSON', () => {
  assert.throws(() => parseActivationPayload('not json'));
});

test('parseActivationPayload throws when a required field is missing', () => {
  assert.throws(() => parseActivationPayload(JSON.stringify({ deviceId: 'dev-1', campaignId: 'camp-1' })));
});

test('parseActivationPayload throws when a required field has the wrong type', () => {
  assert.throws(() =>
    parseActivationPayload(JSON.stringify({ deviceId: 1, deviceSecret: 'secret-1', campaignId: 'camp-1' }))
  );
});

test('activationFileSupersedesStored is true when nothing is stored yet', () => {
  assert.equal(
    activationFileSupersedesStored(null, { deviceId: 'dev-1', deviceSecret: 'secret-1' }),
    true
  );
});

test('activationFileSupersedesStored is true when the secret was rotated (the "kiosk 3" case)', () => {
  assert.equal(
    activationFileSupersedesStored(
      { deviceId: 'dev-1', deviceSecret: 'old-secret' },
      { deviceId: 'dev-1', deviceSecret: 'new-secret' }
    ),
    true
  );
});

test('activationFileSupersedesStored is true when the device id differs', () => {
  assert.equal(
    activationFileSupersedesStored(
      { deviceId: 'dev-1', deviceSecret: 'secret-1' },
      { deviceId: 'dev-2', deviceSecret: 'secret-1' }
    ),
    true
  );
});

test('activationFileSupersedesStored is false for the exact same credential (a stale leftover file)', () => {
  assert.equal(
    activationFileSupersedesStored(
      { deviceId: 'dev-1', deviceSecret: 'secret-1' },
      { deviceId: 'dev-1', deviceSecret: 'secret-1' }
    ),
    false
  );
});
