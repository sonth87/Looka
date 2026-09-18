import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractCitizenIdFromQrPayload,
  extractRepeatingBareCode,
  recoverBareDigitsFromSettledBuffer,
} from '../../components/screens/CccdScanWaitingScreen.js';

test('extractCitizenIdFromQrPayload reads the CCCD from a clean pipe-delimited payload', () => {
  assert.equal(
    extractCitizenIdFromQrPayload('038305010100|123456789|Nguyễn Văn A|01011990|Nam|Hà Nội|01012021'),
    '038305010100',
  );
});

test('extractCitizenIdFromQrPayload rejects a first field that is not exactly 12 digits', () => {
  assert.equal(extractCitizenIdFromQrPayload('1777020640|123456789|'), null);
  assert.equal(extractCitizenIdFromQrPayload('0383050101000|1|'), null);
});

test('extractCitizenIdFromQrPayload requires the pipe — a bare 12-digit run alone is not a CCCD match', () => {
  assert.equal(extractCitizenIdFromQrPayload('038305010100'), null);
});

// 2026-09-18 field report: scanning a student ID card's QR ("1777020640",
// 10 digits, no delimiter) came back as "391777020640" on one attempt and
// "401777020640" on the next — confirmed root cause from this kiosk's own
// [ScanDiag] log: the raw buffer was 20 characters (two back-to-back
// retransmissions of the same 10-digit code), and the OLD `slice(-12)`
// last-resort fallback grabbed an arbitrary window straddling the repeat
// seam. `extractRepeatingBareCode` replaces that guess with a real repeat
// detection — these tests lock in the fix using the exact reported values.
test('extractRepeatingBareCode finds the true code from two back-to-back retransmissions', () => {
  assert.equal(extractRepeatingBareCode('17770206401777020640'), '1777020640');
});

test('extractRepeatingBareCode does not match a single, non-repeated code', () => {
  assert.equal(extractRepeatingBareCode('1777020640'), null);
});

test('extractRepeatingBareCode does not match an empty or short buffer', () => {
  assert.equal(extractRepeatingBareCode(''), null);
  assert.equal(extractRepeatingBareCode('123'), null);
});

// 2026-09-18, later the same day — confirmed product decision (a real
// campaign scan of "006308004439", a genuine 12-digit CCCD *value* with no
// pipe, was wrongly routed to the CCCD-agnostic roster file instead of the
// campaign's own `eligibilityConfig`, which DOES correctly resolve it):
// a bare 12-digit repeat is no longer treated as special-case CCCD
// territory — the {6,11} bound that used to exclude it is gone.
test('extractRepeatingBareCode now DOES match a repeated 12-digit run — no more CCCD exclusion', () => {
  assert.equal(extractRepeatingBareCode('038305010100038305010100'), '038305010100');
});

test('extractRepeatingBareCode is anchored to the start — a corrupted leading run must not produce a false match further in', () => {
  // "9" + the real code twice would only match if unanchored; anchoring to
  // `^` means a buffer with ANY leading noise fails closed instead of
  // silently accepting a shifted, wrong value.
  assert.equal(extractRepeatingBareCode('917770206401777020640'), null);
});

test('extractRepeatingBareCode is not fooled by a partial third repetition still arriving', () => {
  // The instant-match check fires the moment the first two repeats
  // complete — a partial third one trailing behind must not change the
  // extracted value.
  assert.equal(extractRepeatingBareCode('1777020640177702064017770'), '1777020640');
});

// 2026-09-18, later the same day — `recoverBareDigitsFromSettledBuffer`
// replaces the OLD `recoverCitizenIdFromSettledBuffer`'s "slice(-12) with no
// pipe" fallback, which used to be treated as a CCCD (routing to the
// campaign-agnostic roster file). Real report: scanning/entering
// "006308004439" (a genuine CCCD value, confirmed live against the actual
// campaign's EXTERNAL_API config to correctly resolve a real student) never
// reached the campaign's own eligibility check at all, because this exact
// shape — clean, single, un-repeated, no pipe — used to fall through to
// that old CCCD-only fallback.
test('recoverBareDigitsFromSettledBuffer finds a clean single 12-digit buffer — the exact reported "006308004439" case', () => {
  assert.equal(recoverBareDigitsFromSettledBuffer('006308004439'), '006308004439');
});

test('recoverBareDigitsFromSettledBuffer takes the trailing digits when other characters lead the buffer', () => {
  assert.equal(recoverBareDigitsFromSettledBuffer('junk006308004439'), '006308004439');
});

test('recoverBareDigitsFromSettledBuffer rejects a buffer shorter than 6 digits', () => {
  assert.equal(recoverBareDigitsFromSettledBuffer('12345'), null);
});

test('recoverBareDigitsFromSettledBuffer rejects an empty buffer', () => {
  assert.equal(recoverBareDigitsFromSettledBuffer(''), null);
});
