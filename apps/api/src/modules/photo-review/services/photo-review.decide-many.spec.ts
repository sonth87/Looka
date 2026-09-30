import { In } from 'typeorm';
import { CustomException } from '@app/shared/errors/legacy';
import { HttpStatus } from '@nestjs/common';
import {
  PHOTO_REVIEW_ERROR_CODE,
  PhotoReviewAction,
  PhotoReviewSetStatus,
} from '../photo-review.constants';
import { PhotoReviewService } from './photo-review.service';

/**
 * `approveMany`/`rejectMany` -> `decideMany` are orchestration over
 * `applySetDecision` (the real per-set transaction, covered by the DB-backed
 * photo-review-persistence.spec.ts). This suite stubs that write and checks
 * everything around it: dedupe, scope, lock, missing, partial success,
 * sequencing. `Object.create(prototype)` instead of the full constructor —
 * the service has 14 injected dependencies and this path touches four.
 */
interface FakeSet {
  id: string;
  campaignId: string;
  status: PhotoReviewSetStatus;
  currentCardVariantId: string | null;
}

function set(id: string, over: Partial<FakeSet> = {}): FakeSet {
  return {
    id,
    campaignId: 'camp-1',
    status: PhotoReviewSetStatus.READY,
    currentCardVariantId: `variant-${id}`,
    ...over,
  };
}

/** `PhotoReviewService.applySetDecision`'s parameters — typed so `mock.calls` reads are not `any`. */
type ApplyArgs = [
  FakeSet,
  PhotoReviewSetStatus,
  PhotoReviewAction,
  { note?: string },
  string | null,
  ((target: unknown) => boolean) | undefined,
];

function makeService(opts: {
  sets: FakeSet[];
  inScope?: (t: unknown) => boolean;
}) {
  const svc = Object.create(PhotoReviewService.prototype) as PhotoReviewService;
  const find = jest.fn().mockResolvedValue(opts.sets);
  const buildScopePredicate = jest
    .fn()
    .mockResolvedValue(opts.inScope ?? (() => true));
  const logger = { error: jest.fn<void, [string]>() };
  const applySetDecision = jest
    .fn<Promise<{ changed: boolean }>, ApplyArgs>()
    .mockImplementation(() => Promise.resolve({ changed: true }));
  Object.assign(svc, {
    setRepository: { find },
    reviewAssignments: { buildScopePredicate },
    logger,
    applySetDecision,
  });
  return { svc, find, buildScopePredicate, logger, applySetDecision };
}

const ACTOR = 'user-1';

describe('PhotoReviewService.approveMany / rejectMany (1-n)', () => {
  it('approves several sets sequentially and reports each as ok/changed', async () => {
    const { svc, applySetDecision } = makeService({
      sets: [set('a'), set('b'), set('c')],
    });
    const order: string[] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    applySetDecision.mockImplementation(async (s) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      order.push(s.id);
      await new Promise((r) => setImmediate(r));
      inFlight -= 1;
      return { changed: true };
    });

    const res = await svc.approveMany({ setIds: ['a', 'b', 'c'] }, ACTOR);

    expect(maxInFlight).toBe(1);
    expect(order).toEqual(['a', 'b', 'c']);
    expect(res).toMatchObject({ requested: 3, succeeded: 3, failed: 0 });
    expect(res.results).toEqual([
      {
        setId: 'a',
        ok: true,
        status: PhotoReviewSetStatus.APPROVED,
        changed: true,
      },
      {
        setId: 'b',
        ok: true,
        status: PhotoReviewSetStatus.APPROVED,
        changed: true,
      },
      {
        setId: 'c',
        ok: true,
        status: PhotoReviewSetStatus.APPROVED,
        changed: true,
      },
    ]);
  });

  it('passes status, action, the shared note and the actor down to every set write', async () => {
    const { svc, applySetDecision } = makeService({
      sets: [set('a'), set('b')],
    });

    await svc.rejectMany({ setIds: ['a', 'b'], note: 'blurry' }, ACTOR);

    expect(applySetDecision).toHaveBeenCalledTimes(2);
    for (const call of applySetDecision.mock.calls) {
      expect(call[1]).toBe(PhotoReviewSetStatus.REJECTED);
      expect(call[2]).toBe(PhotoReviewAction.REJECTED);
      expect(call[3].note).toBe('blurry');
      expect(call[4]).toBe(ACTOR);
    }
  });

  it('hands the scope predicate down to every set write so scope is re-checked under the row lock', async () => {
    const inScope = jest.fn(() => true);
    const { svc, applySetDecision } = makeService({
      sets: [set('a'), set('b')],
      inScope,
    });

    await svc.approveMany({ setIds: ['a', 'b'] }, ACTOR);

    expect(applySetDecision).toHaveBeenCalledTimes(2);
    for (const call of applySetDecision.mock.calls) {
      expect(call[5]).toBe(inScope);
    }
  });

  it('dedupes ids (first occurrence keeps its position), loads them with ONE query, and counts distinct sets', async () => {
    const { svc, find, applySetDecision } = makeService({
      sets: [set('a'), set('b')],
    });

    const res = await svc.approveMany({ setIds: ['b', 'a', 'b', 'a'] }, ACTOR);

    expect(find).toHaveBeenCalledTimes(1);
    expect(find).toHaveBeenCalledWith({ where: { id: In(['b', 'a']) } });
    expect(applySetDecision).toHaveBeenCalledTimes(2);
    expect(res.requested).toBe(2);
    expect(res.results.map((r) => r.setId)).toEqual(['b', 'a']);
  });

  it('matches ids case-insensitively: an upper-case uuid finds its (lower-case) row instead of a spurious 404, and ABC/abc collapse to one set', async () => {
    // Postgres returns a uuid lower-case whatever case the caller sent.
    const lower = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
    const upper = lower.toUpperCase();
    const { svc, find, applySetDecision } = makeService({
      sets: [set(lower)],
    });

    const res = await svc.approveMany({ setIds: [upper, lower, upper] }, ACTOR);

    // One query, keyed by the canonical form.
    expect(find).toHaveBeenCalledWith({ where: { id: In([lower]) } });
    expect(applySetDecision).toHaveBeenCalledTimes(1);
    expect(res).toMatchObject({ requested: 1, succeeded: 1, failed: 0 });
    // The result echoes the caller's spelling of the FIRST occurrence.
    expect(res.results[0]).toMatchObject({ setId: upper, ok: true });
  });

  it('resolves scope ONCE for the whole batch, not once per set', async () => {
    const { svc, buildScopePredicate } = makeService({
      sets: [set('a'), set('b'), set('c')],
    });

    await svc.approveMany({ setIds: ['a', 'b', 'c'] }, ACTOR);

    expect(buildScopePredicate).toHaveBeenCalledTimes(1);
    expect(buildScopePredicate).toHaveBeenCalledWith(ACTOR);
  });

  it('a missing set is a per-item 404 SET_NOT_FOUND and its write is never attempted', async () => {
    const { svc, applySetDecision } = makeService({ sets: [set('a')] });

    const res = await svc.approveMany({ setIds: ['a', 'ghost'] }, ACTOR);

    expect(res).toMatchObject({ requested: 2, succeeded: 1, failed: 1 });
    expect(res.results[1]).toMatchObject({
      setId: 'ghost',
      ok: false,
      statusCode: 404,
      errorCode: PHOTO_REVIEW_ERROR_CODE.SET_NOT_FOUND,
    });
    expect(applySetDecision).toHaveBeenCalledTimes(1);
  });

  it('an out-of-scope set is a per-item 403 OUT_OF_SCOPE and its write is never attempted', async () => {
    const { svc, applySetDecision } = makeService({
      sets: [set('mine'), set('theirs', { campaignId: 'other-camp' })],
      inScope: (t) => (t as FakeSet).campaignId === 'camp-1',
    });

    const res = await svc.approveMany({ setIds: ['theirs', 'mine'] }, ACTOR);

    expect(res.results[0]).toMatchObject({
      setId: 'theirs',
      ok: false,
      statusCode: 403,
      errorCode: PHOTO_REVIEW_ERROR_CODE.OUT_OF_SCOPE,
      message: 'Bạn không được phân công duyệt đợt/nhóm của hồ sơ này',
    });
    expect(res.results[1]).toMatchObject({ setId: 'mine', ok: true });
    expect(applySetDecision).toHaveBeenCalledTimes(1);
    expect(applySetDecision.mock.calls[0][0].id).toBe('mine');
  });

  it('the lock state is decided by applySetDecision under the row lock, NOT pre-checked against the up-front snapshot', async () => {
    // Sets 1-2 are locked in the snapshot, but set 2 unlocks while the loop
    // is busy with set 1 (its CARD_AUTO finished). A stale pre-read check
    // would refuse it with a spurious 409; the authoritative check lives in
    // applySetDecision, which sees fresh data — modelled here by the mock
    // deciding from a `live` view that changes mid-call.
    const live = new Map<string, boolean>([
      ['pending', true],
      ['unlocking', true],
      ['ok', false],
    ]);
    const { svc, applySetDecision } = makeService({
      sets: [
        set('pending', { status: PhotoReviewSetStatus.PENDING_AUTO }),
        set('unlocking', { status: PhotoReviewSetStatus.PENDING_AUTO }),
        set('ok'),
      ],
    });
    applySetDecision.mockImplementation((s) => {
      if (s.id === 'pending') live.set('unlocking', false); // finishes meanwhile
      if (live.get(s.id)) {
        return Promise.reject(
          new CustomException(
            'Set is locked',
            PHOTO_REVIEW_ERROR_CODE.SET_LOCKED,
            HttpStatus.CONFLICT,
          ),
        );
      }
      return Promise.resolve({ changed: true });
    });

    const res = await svc.approveMany(
      { setIds: ['pending', 'unlocking', 'ok'] },
      ACTOR,
    );

    // Every set reached the write (no pre-read gate)...
    expect(applySetDecision).toHaveBeenCalledTimes(3);
    // ...a genuinely locked one is a per-item 409 from the write...
    expect(res.results[0]).toMatchObject({
      setId: 'pending',
      ok: false,
      statusCode: 409,
      errorCode: PHOTO_REVIEW_ERROR_CODE.SET_LOCKED,
    });
    // ...and the one that unlocked mid-call is approved, not refused stale.
    expect(res.results[1]).toMatchObject({ setId: 'unlocking', ok: true });
    expect(res.results[2]).toMatchObject({ setId: 'ok', ok: true });
    expect(res).toMatchObject({ requested: 3, succeeded: 2, failed: 1 });
  });

  it('an already-in-status set passes changed:false straight through (still ok)', async () => {
    const { svc, applySetDecision } = makeService({
      sets: [
        set('done', { status: PhotoReviewSetStatus.APPROVED }),
        set('new'),
      ],
    });
    applySetDecision.mockImplementation((s) =>
      Promise.resolve({ changed: s.id !== 'done' }),
    );

    const res = await svc.approveMany({ setIds: ['done', 'new'] }, ACTOR);

    expect(res.succeeded).toBe(2);
    expect(res.results[0]).toMatchObject({
      setId: 'done',
      ok: true,
      changed: false,
    });
    expect(res.results[1]).toMatchObject({
      setId: 'new',
      ok: true,
      changed: true,
    });
  });

  it('a write that throws (e.g. print item already exported) fails only that set; the rest still run', async () => {
    const { svc, applySetDecision, logger } = makeService({
      sets: [set('a'), set('printed'), set('c')],
    });
    applySetDecision.mockImplementation((s) => {
      if (s.id === 'printed') {
        return Promise.reject(
          new CustomException(
            'Ảnh đã được đưa vào đợt in',
            PHOTO_REVIEW_ERROR_CODE.PRINT_ITEM_ALREADY_EXPORTED,
            HttpStatus.CONFLICT,
          ),
        );
      }
      return Promise.resolve({ changed: true });
    });

    const res = await svc.rejectMany({ setIds: ['a', 'printed', 'c'] }, ACTOR);

    expect(applySetDecision).toHaveBeenCalledTimes(3);
    expect(res).toMatchObject({ succeeded: 2, failed: 1 });
    expect(res.results[1]).toMatchObject({
      setId: 'printed',
      ok: false,
      statusCode: 409,
      errorCode: PHOTO_REVIEW_ERROR_CODE.PRINT_ITEM_ALREADY_EXPORTED,
    });
    expect(logger.error).not.toHaveBeenCalled(); // 4xx: expected
  });

  it('an unexpected (non-HTTP) failure is a generic per-item 500 and is logged with the real error', async () => {
    const { svc, applySetDecision, logger } = makeService({
      sets: [set('a'), set('b')],
    });
    applySetDecision.mockImplementation((s) =>
      s.id === 'a'
        ? Promise.reject(new Error('connection terminated 10.0.0.5:5432'))
        : Promise.resolve({ changed: true }),
    );

    const res = await svc.approveMany({ setIds: ['a', 'b'] }, ACTOR);

    expect(res.results[0]).toMatchObject({
      setId: 'a',
      ok: false,
      statusCode: 500,
      message: 'Lỗi hệ thống, vui lòng thử lại',
    });
    expect(res.results[1]).toMatchObject({ setId: 'b', ok: true });
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(String(logger.error.mock.calls[0][0])).toContain(
      'connection terminated',
    );
  });

  it('every set failing still resolves (never throws)', async () => {
    const { svc } = makeService({ sets: [] });

    const res = await svc.approveMany({ setIds: ['x', 'y'] }, ACTOR);

    expect(res).toMatchObject({ requested: 2, succeeded: 0, failed: 2 });
  });
});
