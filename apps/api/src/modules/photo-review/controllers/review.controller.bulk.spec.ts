import { SsoAuthGuard } from '@app/shared/auth/index';
import { AllExceptionsFilter } from '@app/shared/errors/all-exceptions.filter';
import { ResponseTransformInterceptor } from '@app/shared/http/response.transform.interceptor';
import { validationPipes } from '@app/shared/http/validation.pipes';
import { StatsQueryService } from '@app/modules/stats/services/stats-query.service';
import {
  ExecutionContext,
  HttpStatus,
  INestApplication,
  VersioningType,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types';
import { ReviewerRoleGuard } from '../guards/reviewer-role.guard';
import { MAX_REVIEW_BULK_SETS } from '../photo-review.constants';
import { PhotoReviewService } from '../services/photo-review.service';
import { ReviewAssignmentService } from '../services/review-assignment.service';
import { ReviewController } from './review.controller';

/** supertest's `res.body` is `any`; the app's response envelope is not. */
interface Envelope {
  statusCode: number;
  message: string;
  data: Record<string, unknown> & { results: Array<Record<string, unknown>> };
}
const envelopeOf = (res: { body: unknown }) => res.body as Envelope;

/**
 * `POST /v1/review/sets/approve|reject` (1-n) over real HTTP, wired like
 * `main.ts` (URI versioning, the global whitelisting `ValidationPipe`, the
 * response envelope, the global filter); only the service and the two
 * guards are stubbed. Proves the routing the unit specs cannot: the new
 * collection routes do not shadow (or get shadowed by) the existing
 * `sets/:id/approve|reject` routes, and the DTO limits are really enforced.
 */
describe('POST /v1/review/sets/approve|reject (1-n, over HTTP)', () => {
  let app: INestApplication<App>;
  const ACTOR_ID = 'user-1';
  const reviewService = {
    approveMany: jest.fn(),
    rejectMany: jest.fn(),
    approve: jest.fn(),
    reject: jest.fn(),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ReviewController],
      providers: [
        { provide: PhotoReviewService, useValue: reviewService },
        { provide: StatsQueryService, useValue: {} },
        { provide: ReviewAssignmentService, useValue: {} },
      ],
    })
      .overrideGuard(SsoAuthGuard)
      .useValue({
        canActivate: (ctx: ExecutionContext) => {
          ctx.switchToHttp().getRequest<{ user?: unknown }>().user = {
            id: ACTOR_ID,
          };
          return true;
        },
      })
      .overrideGuard(ReviewerRoleGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication();
    app.enableVersioning({
      type: VersioningType.URI,
      defaultVersion: '1',
      prefix: 'v',
    });
    app.useGlobalFilters(
      new AllExceptionsFilter({ translate: jest.fn() } as never),
    );
    app.useGlobalPipes(validationPipes);
    app.useGlobalInterceptors(new ResponseTransformInterceptor());
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  const result = (ids: string[]) => ({
    requested: ids.length,
    succeeded: ids.length,
    failed: 0,
    results: ids.map((setId) => ({
      setId,
      ok: true,
      status: 'APPROVED',
      changed: true,
    })),
  });

  beforeEach(() => {
    for (const fn of Object.values(reviewService)) fn.mockReset();
    reviewService.approveMany.mockImplementation((dto: { setIds: string[] }) =>
      Promise.resolve(result(dto.setIds)),
    );
    reviewService.rejectMany.mockImplementation((dto: { setIds: string[] }) =>
      Promise.resolve(result(dto.setIds)),
    );
    reviewService.approve.mockResolvedValue({ id: 'detail' });
    reviewService.reject.mockResolvedValue({ id: 'detail' });
  });

  const post = (path: string, body: unknown) =>
    request(app.getHttpServer())
      .post(`/v1/review${path}`)
      .send(body as object);

  it('sets/approve takes an array of ids: 201, enveloped per-set results, the actor passed through', async () => {
    const ids = [randomUUID(), randomUUID()];

    const res = await post('/sets/approve', {
      setIds: ids,
      note: 'ok',
    }).expect(HttpStatus.CREATED);

    expect(envelopeOf(res).data).toEqual(result(ids));
    expect(reviewService.approveMany).toHaveBeenCalledWith(
      { setIds: ids, note: 'ok' },
      ACTOR_ID,
    );
    expect(reviewService.approve).not.toHaveBeenCalled();
  });

  it('sets/reject takes an array of ids too, and goes to rejectMany only', async () => {
    const ids = [randomUUID()];

    await post('/sets/reject', { setIds: ids, note: 'blurry' }).expect(
      HttpStatus.CREATED,
    );

    expect(reviewService.rejectMany).toHaveBeenCalledWith(
      { setIds: ids, note: 'blurry' },
      ACTOR_ID,
    );
    expect(reviewService.approveMany).not.toHaveBeenCalled();
  });

  it('one id is just an array of one', async () => {
    const id = randomUUID();

    const res = await post('/sets/approve', { setIds: [id] }).expect(
      HttpStatus.CREATED,
    );

    expect(envelopeOf(res).data.requested).toBe(1);
  });

  it('the single-set routes are untouched: sets/:id/approve still reaches approve(), never approveMany()', async () => {
    const id = randomUUID();

    await post(`/sets/${id}/approve`, { note: 'n' }).expect(HttpStatus.CREATED);
    await post(`/sets/${id}/reject`, { note: 'n' }).expect(HttpStatus.CREATED);

    expect(reviewService.approve).toHaveBeenCalledTimes(1);
    expect((reviewService.approve.mock.calls[0] as unknown[])[0]).toBe(id);
    expect(reviewService.reject).toHaveBeenCalledTimes(1);
    expect(reviewService.approveMany).not.toHaveBeenCalled();
    expect(reviewService.rejectMany).not.toHaveBeenCalled();
  });

  it('strips unknown keys (global whitelist)', async () => {
    await post('/sets/approve', {
      setIds: [randomUUID()],
      isAdmin: true,
    }).expect(HttpStatus.CREATED);

    const dto = (
      reviewService.approveMany.mock.calls[0] as unknown[]
    )[0] as object;
    expect(dto).not.toHaveProperty('isAdmin');
  });

  it.each([
    ['a missing setIds', {}],
    ['an empty setIds', { setIds: [] }],
    ['a non-array setIds', { setIds: randomUUID() }],
    ['a non-uuid id', { setIds: [randomUUID(), 'not-a-uuid'] }],
    [
      'a note over 2000 chars',
      { setIds: [randomUUID()], note: 'x'.repeat(2001) },
    ],
  ])('%s is a 400', async (_name, body) => {
    await post('/sets/approve', body).expect(HttpStatus.BAD_REQUEST);
    expect(reviewService.approveMany).not.toHaveBeenCalled();
  });

  it(`more than ${MAX_REVIEW_BULK_SETS} ids is a 400; exactly ${MAX_REVIEW_BULK_SETS} is accepted`, async () => {
    const make = (n: number) => Array.from({ length: n }, () => randomUUID());

    await post('/sets/reject', {
      setIds: make(MAX_REVIEW_BULK_SETS + 1),
    }).expect(HttpStatus.BAD_REQUEST);
    expect(reviewService.rejectMany).not.toHaveBeenCalled();

    await post('/sets/reject', { setIds: make(MAX_REVIEW_BULK_SETS) }).expect(
      HttpStatus.CREATED,
    );
    expect(reviewService.rejectMany).toHaveBeenCalledTimes(1);
  });
});
