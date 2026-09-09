import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeCccdResponseFile } from '../src/main/responseWriter.js';
// The real parser, imported directly per the product brief ("don't
// reimplement/guess its behavior") — NOT a copy. This is the actual
// integration contract: apps/desktop/src/main/cccdWatcher.ts reads whatever
// this package writes through exactly this function.
import { parseCccdScanFile } from '../../desktop/src/main/cccdScanFile.js';

function tmpFilePath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cccd-scanner-test-'));
  return path.join(dir, 'response.json');
}

test('writeCccdResponseFile round-trips through the real cccdWatcher parser', () => {
  const filePath = tmpFilePath();

  writeCccdResponseFile({ citizenId: '036123456789', fullName: 'Nguyen Van A' }, filePath);

  const raw = fs.readFileSync(filePath, 'utf8');
  const parsed = parseCccdScanFile(raw);

  assert.deepEqual(parsed, {
    citizenId: '036123456789',
    fullName: 'Nguyen Van A',
    dateOfBirth: null,
  });

  fs.rmSync(path.dirname(filePath), { recursive: true, force: true });
});

test('writeCccdResponseFile round-trips an empty fullName (bonus field is optional)', () => {
  const filePath = tmpFilePath();

  writeCccdResponseFile({ citizenId: '001199012345', fullName: '' }, filePath);

  const parsed = parseCccdScanFile(fs.readFileSync(filePath, 'utf8'));
  assert.deepEqual(parsed, {
    citizenId: '001199012345',
    fullName: '',
    dateOfBirth: null,
  });

  fs.rmSync(path.dirname(filePath), { recursive: true, force: true });
});

test('writeCccdResponseFile writes the exact soCCCD/hoTen shape on disk', () => {
  const filePath = tmpFilePath();

  writeCccdResponseFile({ citizenId: '079201001234', fullName: 'Tran Thi C' }, filePath);

  const onDisk = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  assert.deepEqual(onDisk, { soCCCD: '079201001234', hoTen: 'Tran Thi C' });

  fs.rmSync(path.dirname(filePath), { recursive: true, force: true });
});

test('writeCccdResponseFile creates missing parent directories', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cccd-scanner-test-'));
  const filePath = path.join(dir, 'nested', 'deeper', 'response.json');

  writeCccdResponseFile({ citizenId: '036123456789', fullName: '' }, filePath);

  assert.equal(fs.existsSync(filePath), true);
  fs.rmSync(dir, { recursive: true, force: true });
});
