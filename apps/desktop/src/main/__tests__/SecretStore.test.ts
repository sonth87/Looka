import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SecretStore, CryptoProvider } from '../SecretStore.js';

/** Reversible stand-in for the OS keychain; availability is switchable. */
class FakeCrypto implements CryptoProvider {
  public available = true;
  public decryptShouldFail = false;

  isAvailable(): boolean {
    return this.available;
  }
  encrypt(plaintext: string): Buffer {
    return Buffer.from(`enc:${plaintext}`, 'utf8');
  }
  decrypt(ciphertext: Buffer): string {
    if (this.decryptShouldFail) throw new Error('wrong key for this profile');
    const text = ciphertext.toString('utf8');
    if (!text.startsWith('enc:')) throw new Error('not our ciphertext');
    return text.slice(4);
  }
}

function makeStore() {
  const dir = mkdtempSync(join(tmpdir(), 'face-secrets-'));
  const file = join(dir, 'secrets.dat');
  const crypto = new FakeCrypto();
  return { dir, file, crypto, store: new SecretStore(file, crypto) };
}

describe('SecretStore — round trip', () => {
  test('a stored value can be read back', () => {
    const { dir, store } = makeStore();
    try {
      store.set('fs.apiKey', 'fsk_secret_value');
      assert.equal(store.get('fs.apiKey'), 'fsk_secret_value');
      assert.equal(store.has('fs.apiKey'), true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('values survive a new store over the same file', () => {
    const { dir, file, crypto, store } = makeStore();
    try {
      store.set('fs.baseUrl', 'http://fs-core:8080');
      const reopened = new SecretStore(file, crypto);
      assert.equal(reopened.get('fs.baseUrl'), 'http://fs-core:8080');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('an absent key reads as null rather than throwing', () => {
    const { dir, store } = makeStore();
    try {
      assert.equal(store.get('nothing.here'), null);
      assert.equal(store.has('nothing.here'), false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('delete removes only the named key', () => {
    const { dir, store } = makeStore();
    try {
      store.set('fs.apiKey', 'k');
      store.set('fs.baseUrl', 'u');
      store.delete('fs.apiKey');

      assert.equal(store.get('fs.apiKey'), null);
      assert.equal(store.get('fs.baseUrl'), 'u');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('SecretStore — never writes plaintext', () => {
  test('storing fails when the OS cannot encrypt, and writes nothing', () => {
    // An API key sitting readable on disk is worse than one that failed to save,
    // because nothing tells anyone it happened.
    const { dir, file, crypto, store } = makeStore();
    try {
      crypto.available = false;

      assert.throws(() => store.set('fs.apiKey', 'fsk_secret_value'), /unavailable/i);
      assert.equal(existsSync(file), false, 'no file should have been created');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('the value never appears in the file in readable form', () => {
    const { dir, file, store } = makeStore();
    try {
      store.set('fs.apiKey', 'fsk_super_secret');
      const onDisk = readFileSync(file, 'utf8');

      assert.ok(!onDisk.includes('fsk_super_secret'), 'plaintext must not reach disk');
      assert.ok(onDisk.includes('fs.apiKey'), 'the key name itself is not a secret');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a value encrypted under another profile reads as null, not garbage', () => {
    const { dir, store, crypto } = makeStore();
    try {
      store.set('fs.apiKey', 'k');
      crypto.decryptShouldFail = true;

      assert.equal(store.get('fs.apiKey'), null);
      assert.equal(store.has('fs.apiKey'), false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('SecretStore — resilience', () => {
  test('a corrupt file does not prevent the app from starting', () => {
    const { dir, file, crypto } = makeStore();
    try {
      writeFileSync(file, 'this is not json');
      const store = new SecretStore(file, crypto);

      assert.equal(store.get('fs.apiKey'), null);
      // And it recovers: writing works again from a clean slate.
      store.set('fs.apiKey', 'k');
      assert.equal(store.get('fs.apiKey'), 'k');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a file from a future version is ignored rather than misread', () => {
    const { dir, file, crypto } = makeStore();
    try {
      writeFileSync(file, JSON.stringify({ version: 99, values: { 'fs.apiKey': 'x' } }));
      const store = new SecretStore(file, crypto);
      assert.equal(store.get('fs.apiKey'), null);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('writes leave no temporary file behind', () => {
    const { dir, file, store } = makeStore();
    try {
      store.set('a', '1');
      store.set('b', '2');
      assert.equal(existsSync(`${file}.tmp`), false);
      assert.deepEqual(store.keys().sort(), ['a', 'b']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
