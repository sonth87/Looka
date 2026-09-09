import { computeEffectiveStatus } from './campaign-status.util';

describe('computeEffectiveStatus', () => {
  const now = new Date('2026-09-08T12:00:00.000Z');

  test('manualStatus PAUSED always wins, regardless of dates', () => {
    expect(
      computeEffectiveStatus(
        { manualStatus: 'PAUSED', startsAt: null, expiresAt: null },
        now,
      ),
    ).toBe('PAUSED');
  });

  test('manualStatus CLOSED always wins, regardless of dates', () => {
    expect(
      computeEffectiveStatus(
        {
          manualStatus: 'CLOSED',
          startsAt: new Date('2020-01-01T00:00:00.000Z'),
          expiresAt: new Date('2099-01-01T00:00:00.000Z'),
        },
        now,
      ),
    ).toBe('CLOSED');
  });

  test('null startsAt/expiresAt with no manualStatus is OPEN (no bounds at all)', () => {
    expect(
      computeEffectiveStatus(
        { manualStatus: null, startsAt: null, expiresAt: null },
        now,
      ),
    ).toBe('OPEN');
  });

  test('now before startsAt is UPCOMING', () => {
    expect(
      computeEffectiveStatus(
        {
          manualStatus: null,
          startsAt: new Date('2026-09-09T00:00:00.000Z'),
          expiresAt: null,
        },
        now,
      ),
    ).toBe('UPCOMING');
  });

  test('now exactly at startsAt is OPEN, not UPCOMING (inclusive lower bound)', () => {
    expect(
      computeEffectiveStatus(
        { manualStatus: null, startsAt: now, expiresAt: null },
        now,
      ),
    ).toBe('OPEN');
  });

  test('startsAt in the past, no expiresAt, is OPEN', () => {
    expect(
      computeEffectiveStatus(
        {
          manualStatus: null,
          startsAt: new Date('2020-01-01T00:00:00.000Z'),
          expiresAt: null,
        },
        now,
      ),
    ).toBe('OPEN');
  });

  test('now before expiresAt is OPEN', () => {
    expect(
      computeEffectiveStatus(
        {
          manualStatus: null,
          startsAt: null,
          expiresAt: new Date('2026-09-09T00:00:00.000Z'),
        },
        now,
      ),
    ).toBe('OPEN');
  });

  test('now exactly at expiresAt is EXPIRED (exclusive upper bound)', () => {
    expect(
      computeEffectiveStatus(
        { manualStatus: null, startsAt: null, expiresAt: now },
        now,
      ),
    ).toBe('EXPIRED');
  });

  test('now after expiresAt is EXPIRED', () => {
    expect(
      computeEffectiveStatus(
        {
          manualStatus: null,
          startsAt: null,
          expiresAt: new Date('2020-01-01T00:00:00.000Z'),
        },
        now,
      ),
    ).toBe('EXPIRED');
  });

  test('both bounds set, now inside the window, is OPEN', () => {
    expect(
      computeEffectiveStatus(
        {
          manualStatus: null,
          startsAt: new Date('2026-09-01T00:00:00.000Z'),
          expiresAt: new Date('2026-09-15T00:00:00.000Z'),
        },
        now,
      ),
    ).toBe('OPEN');
  });

  test('defaults `now` to the real current time when omitted', () => {
    // Not asserting a specific value - just that it runs without a `now`
    // argument and returns one of the five valid statuses.
    const result = computeEffectiveStatus({
      manualStatus: null,
      startsAt: null,
      expiresAt: null,
    });
    expect(['PAUSED', 'CLOSED', 'UPCOMING', 'OPEN', 'EXPIRED']).toContain(
      result,
    );
  });
});
