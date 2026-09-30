import { HttpStatus } from '@nestjs/common';
import { CustomException } from '@app/shared/errors/legacy';
import { QueryFailedError } from 'typeorm';
import { AddDevicePhotoDto } from '../dto';
import { PhotoService } from './photo.service';

/**
 * `addDevicePhotos` is only a sequential loop over the UNCHANGED
 * `addDevicePhoto` (which has its own DB-backed spec), so this suite spies on
 * that method and needs no database: what matters here is ordering, per-item
 * error mapping, and the counts.
 */
function makeService() {
  // Constructor: repository, dataSource, sessionService, configService.
  return new PhotoService({} as never, {} as never, {} as never, {} as never);
}

function dto(n: number): AddDevicePhotoDto {
  return {
    photoId: `photo-${n}`,
    sessionId: 'sess-1',
    stepId: `step-${n}`,
    attempt: 1,
    dataUrl: 'data:image/jpeg;base64,AAAA',
  };
}

describe('PhotoService.addDevicePhotos (1-n)', () => {
  it('runs the photos strictly sequentially, in order, and reports all ok', async () => {
    const svc = makeService();
    const order: string[] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    jest.spyOn(svc, 'addDevicePhoto').mockImplementation(async (_d, _c, p) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      order.push(`start:${p.photoId}`);
      await new Promise((r) => setImmediate(r));
      order.push(`end:${p.photoId}`);
      inFlight -= 1;
      return { photoId: p.photoId };
    });

    const res = await svc.addDevicePhotos('dev-1', 'camp-1', [
      dto(1),
      dto(2),
      dto(3),
    ]);

    expect(maxInFlight).toBe(1);
    expect(order).toEqual([
      'start:photo-1',
      'end:photo-1',
      'start:photo-2',
      'end:photo-2',
      'start:photo-3',
      'end:photo-3',
    ]);
    expect(res.requested).toBe(3);
    expect(res.succeeded).toBe(3);
    expect(res.failed).toBe(0);
    expect(res.results.map((r) => [r.photoId, r.ok])).toEqual([
      ['photo-1', true],
      ['photo-2', true],
      ['photo-3', true],
    ]);
  });

  it('passes the calling device and campaign through to every addDevicePhoto call', async () => {
    const svc = makeService();
    const spy = jest
      .spyOn(svc, 'addDevicePhoto')
      .mockImplementation((_d, _c, p) =>
        Promise.resolve({ photoId: p.photoId }),
      );

    await svc.addDevicePhotos('dev-9', 'camp-9', [dto(1), dto(2)]);

    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenNthCalledWith(1, 'dev-9', 'camp-9', dto(1));
    expect(spy).toHaveBeenNthCalledWith(2, 'dev-9', 'camp-9', dto(2));
  });

  it('a middle photo failing with 403 gives a per-item 403 while the others still succeed', async () => {
    const svc = makeService();
    jest.spyOn(svc, 'addDevicePhoto').mockImplementation((_d, _c, p) => {
      if (p.photoId === 'photo-2') {
        return Promise.reject(
          new CustomException(
            'Session belongs to a different device/campaign',
            4030,
            HttpStatus.FORBIDDEN,
          ),
        );
      }
      return Promise.resolve({ photoId: p.photoId });
    });

    const res = await svc.addDevicePhotos('dev-1', 'camp-1', [
      dto(1),
      dto(2),
      dto(3),
    ]);

    expect(res).toMatchObject({ requested: 3, succeeded: 2, failed: 1 });
    expect(res.results[0]).toMatchObject({ photoId: 'photo-1', ok: true });
    expect(res.results[1]).toMatchObject({
      photoId: 'photo-2',
      ok: false,
      statusCode: 403,
      errorCode: 4030,
      message: 'Session belongs to a different device/campaign',
    });
    expect(res.results[2]).toMatchObject({ photoId: 'photo-3', ok: true });
  });

  it('a 400 (bad data URL) is per-item and does not stop later photos', async () => {
    const svc = makeService();
    const spy = jest
      .spyOn(svc, 'addDevicePhoto')
      .mockImplementation((_d, _c, p) => {
        if (p.photoId === 'photo-1') {
          return Promise.reject(
            new CustomException(
              'Expected dataUrl to be a base64 image data URL',
              400,
              HttpStatus.BAD_REQUEST,
            ),
          );
        }
        return Promise.resolve({ photoId: p.photoId });
      });

    const res = await svc.addDevicePhotos('dev-1', 'camp-1', [dto(1), dto(2)]);

    expect(spy).toHaveBeenCalledTimes(2);
    expect(res.results[0]).toMatchObject({ ok: false, statusCode: 400 });
    expect(res.results[1]).toMatchObject({ ok: true });
  });

  it('an unknown/infra error becomes a generic per-item 500 (retryable for the kiosk) and its raw text is not echoed', async () => {
    const svc = makeService();
    const logSpy = jest
      .spyOn(svc['logger'], 'error')
      .mockImplementation(() => undefined);
    jest.spyOn(svc, 'addDevicePhoto').mockImplementation((_d, _c, p) => {
      if (p.photoId === 'photo-2') {
        return Promise.reject(
          new QueryFailedError(
            'INSERT INTO photos ...',
            [],
            new Error('deadlock detected on relation photos'),
          ),
        );
      }
      return Promise.resolve({ photoId: p.photoId });
    });

    const res = await svc.addDevicePhotos('dev-1', 'camp-1', [
      dto(1),
      dto(2),
      dto(3),
    ]);

    expect(res).toMatchObject({ succeeded: 2, failed: 1 });
    expect(res.results[1]).toMatchObject({
      photoId: 'photo-2',
      ok: false,
      statusCode: 500,
      message: 'Lỗi hệ thống, vui lòng thử lại',
    });
    expect(res.results[1].message).not.toMatch(/deadlock|INSERT/);
    // 5xx must be logged with the ORIGINAL error since the response is generic.
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(String(logSpy.mock.calls[0][0])).toContain('photo-2');
    expect(res.results[2]).toMatchObject({ ok: true });
  });

  it('4xx failures are NOT logged as errors (caller-attributable, expected)', async () => {
    const svc = makeService();
    const logSpy = jest
      .spyOn(svc['logger'], 'error')
      .mockImplementation(() => undefined);
    jest
      .spyOn(svc, 'addDevicePhoto')
      .mockRejectedValue(
        new CustomException('nope', 403, HttpStatus.FORBIDDEN),
      );

    await svc.addDevicePhotos('dev-1', 'camp-1', [dto(1)]);

    expect(logSpy).not.toHaveBeenCalled();
  });

  it('every photo failing still resolves (never throws) with failed === requested', async () => {
    const svc = makeService();
    jest
      .spyOn(svc, 'addDevicePhoto')
      .mockRejectedValue(
        new CustomException('nope', 403, HttpStatus.FORBIDDEN),
      );

    const res = await svc.addDevicePhotos('dev-1', 'camp-1', [dto(1), dto(2)]);

    expect(res).toMatchObject({ requested: 2, succeeded: 0, failed: 2 });
  });
});
