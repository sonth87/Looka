import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRosterFile, findByIdentityNumber } from '../cccdRoster.js';

const SAMPLE_RECORD = {
  student_id: '97861199-3EB0-4EA8-89DA-96D97C67AAA5',
  user_code: 'U2077020020',
  student_code: '2077020020',
  full_name: 'Vũ Phan Quỳnh Anh',
  gender: 'Nữ',
  date_of_birth: '29/09/2008',
  identity_number: '014203003990',
  email: '2077020020@dnu.edu.vn',
  faculty_name: 'Ngôn ngữ và văn hóa Trung Quốc',
  major_name: 'Ngôn ngữ Trung Quốc',
  class_name: 'TT 20 - 18',
  status: 'Đang học',
};

test('parseRosterFile extracts a well-formed array', () => {
  const raw = JSON.stringify([SAMPLE_RECORD]);
  assert.deepEqual(parseRosterFile(raw), [
    {
      identityNumber: '014203003990',
      userCode: 'U2077020020',
      studentCode: '2077020020',
      fullName: 'Vũ Phan Quỳnh Anh',
      className: 'TT 20 - 18',
      majorName: 'Ngôn ngữ Trung Quốc',
      courseYear: null,
    },
  ]);
});

test('parseRosterFile keeps course_year when present', () => {
  const raw = JSON.stringify([{ ...SAMPLE_RECORD, course_year: 2020 }]);
  const parsed = parseRosterFile(raw);
  assert.equal(parsed?.[0]?.courseYear, '2020');
});

test('parseRosterFile skips an element missing identity_number', () => {
  const raw = JSON.stringify([{ ...SAMPLE_RECORD, identity_number: undefined }, SAMPLE_RECORD]);
  const parsed = parseRosterFile(raw);
  assert.equal(parsed?.length, 1);
  assert.equal(parsed?.[0]?.identityNumber, '014203003990');
});

test('parseRosterFile skips an element missing user_code — required, same as identity_number', () => {
  const raw = JSON.stringify([{ ...SAMPLE_RECORD, user_code: undefined }, SAMPLE_RECORD]);
  const parsed = parseRosterFile(raw);
  assert.equal(parsed?.length, 1);
  assert.equal(parsed?.[0]?.userCode, 'U2077020020');
});

test('parseRosterFile skips a non-object element without failing the rest', () => {
  const raw = JSON.stringify(['not an object', SAMPLE_RECORD]);
  const parsed = parseRosterFile(raw);
  assert.equal(parsed?.length, 1);
});

test('parseRosterFile returns an empty array for a valid but empty roster', () => {
  assert.deepEqual(parseRosterFile('[]'), []);
});

test('parseRosterFile returns null for an empty file', () => {
  assert.equal(parseRosterFile(''), null);
  assert.equal(parseRosterFile('   '), null);
});

test('parseRosterFile returns null for malformed JSON (mid-write)', () => {
  assert.equal(parseRosterFile('[{"student_code":'), null);
});

test('parseRosterFile returns null when the JSON is not an array', () => {
  assert.equal(parseRosterFile(JSON.stringify(SAMPLE_RECORD)), null);
});

test('findByIdentityNumber matches by exact identity_number, ignoring campaign scope entirely', () => {
  const records = parseRosterFile(JSON.stringify([SAMPLE_RECORD]))!;
  const match = findByIdentityNumber(records, '014203003990');
  assert.equal(match?.studentCode, '2077020020');
});

test('findByIdentityNumber returns null for no match', () => {
  const records = parseRosterFile(JSON.stringify([SAMPLE_RECORD]))!;
  assert.equal(findByIdentityNumber(records, '000000000000'), null);
});

test('findByIdentityNumber returns null for a blank query', () => {
  const records = parseRosterFile(JSON.stringify([SAMPLE_RECORD]))!;
  assert.equal(findByIdentityNumber(records, '   '), null);
});
