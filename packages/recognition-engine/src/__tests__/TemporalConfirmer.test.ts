import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { TemporalConfirmer } from '../TemporalConfirmer.js';
import { RecognitionResult } from '@face/core';

const match = (personId: string, score = 0.9): RecognitionResult => ({
  status: 'MATCH',
  personId,
  score,
  modelVersion: 'MOCK/mock-v0/mock-v0',
  durationMs: 1,
});

const unknown = (): RecognitionResult => ({
  status: 'UNKNOWN',
  modelVersion: 'MOCK/mock-v0/mock-v0',
  durationMs: 1,
});

const noFace = (): RecognitionResult => ({
  status: 'NO_FACE',
  modelVersion: 'MOCK/mock-v0/mock-v0',
  durationMs: 1,
});

const ambiguous = (): RecognitionResult => ({
  status: 'AMBIGUOUS',
  modelVersion: 'MOCK/mock-v0/mock-v0',
  durationMs: 1,
});

describe('TemporalConfirmer — M-of-N', () => {
  test('one matching frame is not enough to confirm an identity', () => {
    // A blink or a bad angle can make a single frame agree with the wrong
    // person, and an attendance record would keep that mistake forever.
    const c = new TemporalConfirmer({ n: 5, m: 3 });
    const d = c.observe(match('alice'), 1000);

    assert.equal(d.state, 'OBSERVING');
    assert.equal(d.personId, undefined);
    assert.equal(d.agreeing, 1);
    assert.equal(d.reason, 'INSUFFICIENT_EVIDENCE');
  });

  test('confirms once m frames in the window agree', () => {
    const c = new TemporalConfirmer({ n: 5, m: 3 });
    assert.equal(c.observe(match('alice'), 1000).state, 'OBSERVING');
    assert.equal(c.observe(match('alice'), 1100).state, 'OBSERVING');

    const third = c.observe(match('alice'), 1200);
    assert.equal(third.state, 'CONFIRMED');
    assert.equal(third.personId, 'alice');
    assert.equal(third.agreeing, 3);
  });

  test('a single stray frame does not derail an otherwise clear identity', () => {
    // 3 of 4 agree — the outlier is exactly what this policy is meant to absorb.
    const c = new TemporalConfirmer({ n: 5, m: 3 });
    c.observe(match('alice'), 1000);
    c.observe(match('bob'), 1050); // outlier
    c.observe(match('alice'), 1100);

    const d = c.observe(match('alice'), 1150);
    assert.equal(d.state, 'CONFIRMED');
    assert.equal(d.personId, 'alice');
  });

  test('two candidates splitting the window confirm nobody', () => {
    const c = new TemporalConfirmer({ n: 5, m: 3 });
    c.observe(match('alice'), 1000);
    c.observe(match('bob'), 1050);
    c.observe(match('alice'), 1100);
    const d = c.observe(match('bob'), 1150);

    assert.equal(d.state, 'OBSERVING');
    assert.equal(d.reason, 'CONFLICTING');
  });

  test('non-match frames never count towards agreement', () => {
    const c = new TemporalConfirmer({ n: 5, m: 3 });
    c.observe(unknown(), 1000);
    c.observe(ambiguous(), 1050);
    const d = c.observe(unknown(), 1100);

    assert.equal(d.state, 'OBSERVING');
    assert.equal(d.agreeing, 0);
    assert.equal(d.reason, 'NOT_A_MATCH');
  });

  test('the reported score is the mean of the agreeing frames', () => {
    const c = new TemporalConfirmer({ n: 5, m: 3 });
    c.observe(match('alice', 0.8), 1000);
    c.observe(match('alice', 0.9), 1100);
    const d = c.observe(match('alice', 1.0), 1200);

    assert.equal(d.state, 'CONFIRMED');
    assert.ok(Math.abs(d.score! - 0.9) < 1e-6, `expected ~0.9, got ${d.score}`);
  });
});

describe('TemporalConfirmer — identity lock', () => {
  test('after confirming, later frames report LOCKED rather than confirming again', () => {
    // Lets a caller act exactly once without tracking that itself.
    const c = new TemporalConfirmer({ n: 5, m: 3, identityLockMs: 3000 });
    c.observe(match('alice'), 1000);
    c.observe(match('alice'), 1100);
    assert.equal(c.observe(match('alice'), 1200).state, 'CONFIRMED');

    const next = c.observe(match('alice'), 1300);
    assert.equal(next.state, 'LOCKED');
    assert.equal(next.personId, 'alice');
  });

  test('the lock expires and a fresh confirmation is required', () => {
    const c = new TemporalConfirmer({ n: 5, m: 3, identityLockMs: 1000, frameTtlMs: 60_000 });
    c.observe(match('alice'), 1000);
    c.observe(match('alice'), 1100);
    c.observe(match('alice'), 1200);

    assert.equal(c.current(1500), 'alice');
    assert.equal(c.current(2500), null, 'lock is gone once it expires');
  });

  test('a face leaving drops the identity immediately', () => {
    // Otherwise the next person to step in inherits the identity still held.
    const c = new TemporalConfirmer({ n: 5, m: 3, identityLockMs: 10_000 });
    c.observe(match('alice'), 1000);
    c.observe(match('alice'), 1100);
    assert.equal(c.observe(match('alice'), 1200).state, 'CONFIRMED');

    const gone = c.observe(noFace(), 1300);
    assert.equal(gone.state, 'IDLE');
    assert.equal(gone.reason, 'NO_FACE');
    assert.equal(c.current(1400), null, 'lock released even though it had not expired');
  });

  test('the next person must earn their own confirmation', () => {
    const c = new TemporalConfirmer({ n: 5, m: 3, identityLockMs: 10_000 });
    c.observe(match('alice'), 1000);
    c.observe(match('alice'), 1100);
    c.observe(match('alice'), 1200);
    c.observe(noFace(), 1300);

    assert.equal(c.observe(match('bob'), 1400).state, 'OBSERVING');
    assert.equal(c.observe(match('bob'), 1500).state, 'OBSERVING');
    const d = c.observe(match('bob'), 1600);
    assert.equal(d.state, 'CONFIRMED');
    assert.equal(d.personId, 'bob');
  });

  test('multiple faces are treated the same as no face', () => {
    const c = new TemporalConfirmer({ n: 5, m: 3 });
    c.observe(match('alice'), 1000);
    const d = c.observe(
      { status: 'MULTIPLE_FACES', modelVersion: 'm', durationMs: 1 },
      1100
    );
    assert.equal(d.state, 'IDLE');
  });
});

describe('TemporalConfirmer — window bounds', () => {
  test('evidence older than the TTL stops counting', () => {
    // Frames from a minute ago must not decide who is standing there now.
    const c = new TemporalConfirmer({ n: 5, m: 3, frameTtlMs: 2000 });
    c.observe(match('alice'), 1000);
    c.observe(match('alice'), 1500);

    const d = c.observe(match('alice'), 9000); // long gap
    assert.equal(d.state, 'OBSERVING', 'the two old frames expired');
    assert.equal(d.windowSize, 1);
  });

  test('the window never grows past n', () => {
    const c = new TemporalConfirmer({ n: 3, m: 3, frameTtlMs: 60_000 });
    for (let i = 0; i < 10; i++) c.observe(match('alice'), 1000 + i * 10);
    const d = c.observe(match('alice'), 2000);
    assert.ok(d.windowSize <= 3);
  });

  test('m greater than n is rejected at construction', () => {
    assert.throws(() => new TemporalConfirmer({ n: 3, m: 5 }), /m \(5\) <= n \(3\)/);
  });

  test('reset clears everything', () => {
    const c = new TemporalConfirmer({ n: 5, m: 3, identityLockMs: 10_000 });
    c.observe(match('alice'), 1000);
    c.observe(match('alice'), 1100);
    c.observe(match('alice'), 1200);

    c.reset();
    assert.equal(c.current(1250), null);
    assert.equal(c.observe(match('alice'), 1300).state, 'OBSERVING');
  });
});

describe('TemporalConfirmer — N consecutive mode', () => {
  test('requires an unbroken run, so one outlier restarts it', () => {
    const c = new TemporalConfirmer({ mode: 'N_CONSECUTIVE', n: 5, m: 3, frameTtlMs: 60_000 });
    c.observe(match('alice'), 1000);
    c.observe(match('alice'), 1100);
    c.observe(match('bob'), 1200); // breaks the run
    assert.equal(c.observe(match('alice'), 1300).state, 'OBSERVING');
    assert.equal(c.observe(match('alice'), 1400).state, 'OBSERVING');

    const d = c.observe(match('alice'), 1500);
    assert.equal(d.state, 'CONFIRMED', 'three in a row at last');
    assert.equal(d.personId, 'alice');
  });

  test('an unbroken run confirms', () => {
    const c = new TemporalConfirmer({ mode: 'N_CONSECUTIVE', n: 5, m: 3 });
    c.observe(match('alice'), 1000);
    c.observe(match('alice'), 1100);
    assert.equal(c.observe(match('alice'), 1200).state, 'CONFIRMED');
  });
});
