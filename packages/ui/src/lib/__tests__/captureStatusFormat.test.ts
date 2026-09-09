import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatSubjectClassLine,
  formatRoundLabel,
  formatPhotoLabel,
  formatCapturedTime,
  formatDeviceSuffix,
} from '../../components/workflow/captureStatusFormat.js';

test('formatSubjectClassLine joins className/major/academicYear with " · "', () => {
  assert.equal(
    formatSubjectClassLine({ className: 'CNTT-K20', major: 'KTPM', academicYear: '2020' }),
    'CNTT-K20 · KTPM · 2020'
  );
});

test('formatSubjectClassLine skips missing/blank parts without leaving stray separators', () => {
  assert.equal(formatSubjectClassLine({ className: 'CNTT-K20' }), 'CNTT-K20');
  assert.equal(formatSubjectClassLine({ className: 'CNTT-K20', major: '' }), 'CNTT-K20');
  assert.equal(formatSubjectClassLine({}), '');
  assert.equal(formatSubjectClassLine(null), '');
  assert.equal(formatSubjectClassLine(undefined), '');
});

test('formatRoundLabel matches the vocabulary table exactly ("Vòng k/K")', () => {
  assert.equal(formatRoundLabel(2, 6), 'Vòng 2/6');
});

test('formatPhotoLabel matches the vocabulary table exactly ("N/M ảnh")', () => {
  assert.equal(formatPhotoLabel(3, 10), '3/10 ảnh');
});

test('formatCapturedTime renders zero-padded HH:MM', () => {
  const d = new Date(2026, 8, 8, 9, 5, 0);
  assert.equal(formatCapturedTime(d), '09:05');
});

test('formatCapturedTime accepts a Date or an epoch number identically', () => {
  const d = new Date(2026, 8, 8, 14, 30, 0);
  assert.equal(formatCapturedTime(d), '14:30');
  assert.equal(formatCapturedTime(d.getTime()), '14:30');
});

test('formatDeviceSuffix names the other device only when this row is not from this device', () => {
  assert.equal(formatDeviceSuffix('PC-A102', false), ' (PC-A102)');
  assert.equal(formatDeviceSuffix('PC-A102', true), '');
  assert.equal(formatDeviceSuffix(undefined, false), '');
});
