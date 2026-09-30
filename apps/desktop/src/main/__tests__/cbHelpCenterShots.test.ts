import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeCbHelpState, sanitizeCenterShots } from '../cbHelpWindow.js';

/**
 * The renderer is untrusted input to the CB Help window's IPC snapshot, and
 * `sanitizeCbHelpState` rebuilds the payload field by field — so a new field
 * that is not handled there is silently dropped before it ever reaches the
 * extended display. `centerShots` (multi-shot CENTER camera) must survive, and
 * a malformed one must degrade to `null` rather than wedge the window.
 */
describe('sanitizeCenterShots', () => {
  const IMG = 'data:image/jpeg;base64,AAAA';

  test('passes a well-formed value through', () => {
    assert.deepEqual(
      sanitizeCenterShots({ stepId: 'step-front', count: 3, selectedIndex: 1, thumbnails: [IMG, IMG, IMG] }),
      { stepId: 'step-front', count: 3, selectedIndex: 1, thumbnails: [IMG, IMG, IMG] }
    );
  });

  test('null / non-objects / a missing stepId become null', () => {
    assert.equal(sanitizeCenterShots(null), null);
    assert.equal(sanitizeCenterShots(undefined), null);
    assert.equal(sanitizeCenterShots('shots'), null);
    assert.equal(sanitizeCenterShots({ count: 2, selectedIndex: 0, thumbnails: [] }), null);
    assert.equal(sanitizeCenterShots({ stepId: 42, count: 2, selectedIndex: 0, thumbnails: [] }), null);
  });

  test('count must be a whole number >= 1', () => {
    for (const count of [0, -1, 1.5, Number.NaN, '2', null, undefined]) {
      assert.equal(
        sanitizeCenterShots({ stepId: 's', count, selectedIndex: 0, thumbnails: [] }),
        null,
        `count ${String(count)} is rejected`
      );
    }
    assert.notEqual(sanitizeCenterShots({ stepId: 's', count: 1, selectedIndex: 0, thumbnails: [] }), null);
  });

  test('selectedIndex is clamped into [0, count)', () => {
    const at = (selectedIndex: unknown) =>
      sanitizeCenterShots({ stepId: 's', count: 3, selectedIndex, thumbnails: [] })!.selectedIndex;
    assert.equal(at(-4), 0);
    assert.equal(at(99), 2);
    assert.equal(at(1.9), 1, 'truncated to a whole index');
    assert.equal(at('1'), 0, 'not a number falls back to the first shot');
    assert.equal(at(Number.NaN), 0);
    assert.equal(at(undefined), 0);
  });

  test('count is capped: a huge value would make the renderer build that many strip tiles', () => {
    for (const count of [21, 1000, 1e7, 2 ** 32, Number.MAX_SAFE_INTEGER]) {
      assert.equal(
        sanitizeCenterShots({ stepId: 's', count, selectedIndex: 0, thumbnails: [] }),
        null,
        `count ${String(count)} is rejected`
      );
    }
    assert.notEqual(sanitizeCenterShots({ stepId: 's', count: 20, selectedIndex: 0, thumbnails: [] }), null);
  });

  test('thumbnails keep only image data URLs, in place, and at most 20 of them', () => {
    const many = Array.from({ length: 30 }, () => IMG);
    const out = sanitizeCenterShots({
      stepId: 's',
      count: 6,
      selectedIndex: 0,
      thumbnails: [IMG, 'http://evil.example/x.png', 42, null, 'data:text/html;base64,PGh0bWw+', IMG],
    })!;
    // Invalid entries are blanked, NOT dropped: `thumbnails[i]` is shot `i`'s, so
    // dropping one would shift every later thumbnail onto the wrong shot.
    assert.deepEqual(out.thumbnails, [IMG, '', '', '', '', IMG]);

    assert.equal(sanitizeCenterShots({ stepId: 's', count: 5, selectedIndex: 0, thumbnails: many })!.thumbnails.length, 20);
  });

  test('an oversized thumbnail is blanked, not passed on', () => {
    const huge = `data:image/jpeg;base64,${'A'.repeat(600 * 1024)}`;
    const out = sanitizeCenterShots({ stepId: 's', count: 2, selectedIndex: 0, thumbnails: [huge, IMG] })!;
    assert.deepEqual(out.thumbnails, ['', IMG]);
  });

  test('a missing / non-array thumbnails list becomes an empty one', () => {
    assert.deepEqual(sanitizeCenterShots({ stepId: 's', count: 2, selectedIndex: 0 })!.thumbnails, []);
    assert.deepEqual(sanitizeCenterShots({ stepId: 's', count: 2, selectedIndex: 0, thumbnails: 'x' })!.thumbnails, []);
  });
});

describe('sanitizeCbHelpState — centerShots', () => {
  test('carries a valid centerShots field through the field-by-field rebuild', () => {
    const state = sanitizeCbHelpState({
      running: true,
      phase: 'review',
      centerShots: { stepId: 'step-front', count: 2, selectedIndex: 1, thumbnails: ['data:image/jpeg;base64,AAAA'] },
    });
    assert.deepEqual(state.centerShots, {
      stepId: 'step-front',
      count: 2,
      selectedIndex: 1,
      thumbnails: ['data:image/jpeg;base64,AAAA'],
    });
  });

  test('is null when absent or malformed', () => {
    assert.equal(sanitizeCbHelpState({ running: false, phase: 'idle' }).centerShots, null);
    assert.equal(sanitizeCbHelpState({ centerShots: { stepId: 's', count: 0, selectedIndex: 0, thumbnails: [] } }).centerShots, null);
    assert.equal(sanitizeCbHelpState(null).centerShots, null);
  });
});
