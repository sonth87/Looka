import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractCitizenId, extractFullName } from '../cccdOcr.js';

test('extractCitizenId pulls a clean 12-digit run out of noisy OCR text', () => {
  assert.equal(extractCitizenId('CĂN CƯỚC CÔNG DÂN\nSố / No.: 001099001234\nHọ và tên'), '001099001234');
});

test('extractCitizenId returns null when there is no digit run at all', () => {
  assert.equal(extractCitizenId('CĂN CƯỚC CÔNG DÂN\nHọ và tên'), null);
});

test('extractCitizenId returns null for an 11-digit run (too short)', () => {
  assert.equal(extractCitizenId('Số: 12345678901'), null);
});

test('extractCitizenId returns null for a 13-digit run (too long, not a clean 12-digit token)', () => {
  assert.equal(extractCitizenId('Số: 1234567890123'), null);
});

test('extractCitizenId returns null when digits are split by whitespace (not one contiguous token)', () => {
  assert.equal(extractCitizenId('Số: 0010 9900 1234'), null);
});

test('extractFullName reads the line after a "Họ và tên" label', () => {
  assert.equal(extractFullName('Số: 001099001234\nHọ và tên / Full name:\nNGUYEN VAN A\nNgày sinh'), 'NGUYEN VAN A');
});

test('extractFullName recognizes the English-only label too', () => {
  assert.equal(extractFullName('ID: 001099001234\nFull name:\nNGUYEN VAN A'), 'NGUYEN VAN A');
});

test('extractFullName returns null when no name label is present', () => {
  assert.equal(extractFullName('Số: 001099001234\nNgày sinh: 01/01/2000'), null);
});
