import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import { extractCitizenId, extractFullName, recognizeCccdFrame } from '../src/renderer/ocr.js';
import { renderDigitsFixture } from './fixtures/renderDigitsFixture.js';

// --- extractCitizenId: pure regex-gate logic, no OCR/image involved -------

test('extractCitizenId pulls a clean 12-digit run out of noisy OCR text', () => {
  const noisy = 'CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM\nSố / No.: 036123456789\nHọ và tên / Full name';
  assert.equal(extractCitizenId(noisy), '036123456789');
});

test('extractCitizenId returns null when there is no digit run at all', () => {
  assert.equal(extractCitizenId('garbled text, no id here'), null);
});

test('extractCitizenId returns null for an 11-digit run (too short)', () => {
  assert.equal(extractCitizenId('Số: 03612345678'), null);
});

test('extractCitizenId returns null for a 13-digit run (too long, not a clean 12-digit token)', () => {
  assert.equal(extractCitizenId('Số: 0361234567890'), null);
});

test('extractCitizenId returns null when digits are split by whitespace (not one contiguous token)', () => {
  assert.equal(extractCitizenId('0361 2345 6789'), null);
});

test('extractCitizenId picks the first clean 12-digit token when multiple numbers are present', () => {
  assert.equal(extractCitizenId('Mã khác: 999999999999999\nSố: 036123456789\nkhác 1'), '036123456789');
});

// --- extractFullName: bonus field, best-effort -----------------------------

test('extractFullName reads the line after a "Họ và tên" label', () => {
  const text = 'Họ và tên / Full name:\nNGUYEN VAN A\nNgày sinh / Date of birth: 01/01/2000';
  assert.equal(extractFullName(text), 'NGUYEN VAN A');
});

test('extractFullName recognizes the English-only label too', () => {
  assert.equal(extractFullName('Full name: NGUYEN THI B'), 'NGUYEN THI B');
});

test('extractFullName returns null when no name label is present', () => {
  assert.equal(extractFullName('random ocr text without any recognizable label'), null);
});

// --- recognizeCccdFrame: the real Tesseract.js pipeline against a synthetic
// rendered image (no camera, no physical card) ------------------------------
//
// Slow: spins up a real Tesseract worker and runs two OCR passes, and on a
// cold cache downloads the 'eng' core/trained-data files over the network
// (~a few MB, confirmed reachable from this environment). Generous timeout
// to comfortably cover a cold-cache first run.

test(
  'recognizeCccdFrame extracts the exact 12-digit citizen id from a synthetic rendered card image',
  { timeout: 120_000 },
  async () => {
    const expectedId = '036123456789';
    const image = renderDigitsFixture(expectedId);

    const result = await recognizeCccdFrame(image, {
      langs: 'eng', // fixture has no Vietnamese text — skip the larger 'vie' download
      workerOptions: { cachePath: os.tmpdir() }, // don't leave trained-data files behind in the repo
    });

    assert.equal(result.citizenId, expectedId);
  }
);
