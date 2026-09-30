import { CustomException } from '@app/shared/errors/legacy';
import { AllExceptionsFilter } from '@app/shared/errors/all-exceptions.filter';
import { ResponseTransformInterceptor } from '@app/shared/http/response.transform.interceptor';
import { validationPipes } from '@app/shared/http/validation.pipes';
import { PhotoService } from '@app/modules/capture/services/photo.service';
import { SessionService } from '@app/modules/capture/services/session.service';
import { SessionVideoService } from '@app/modules/capture/services/session-video.service';
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
import { DeviceCredentialsGuard } from '../guards/device-credentials.guard';
import { CampaignService } from '../services/campaign.service';
import { DeviceEventService } from '../services/device-event.service';
import { DeviceSelfController } from './device-self.controller';

/** supertest's `res.body` is `any`; the app's response envelope is not. */
interface Envelope {
  statusCode: number;
  message: string;
  data: Record<string, unknown> & { results: Array<Record<string, unknown>> };
}
const envelopeOf = (res: { body: unknown }) => res.body as Envelope;

/**
 * `POST /v1/devices/photos` over real HTTP, wired the way `main.ts` wires the
 * app (URI versioning, the GLOBAL whitelisting `ValidationPipe`, the response
 * envelope, the global exception filter) — only the services and the device
 * guard are stubbed. What this proves that the pipe's own unit spec cannot:
 * the controller's `DevicePhotosBody` parameter really does pass through the
 * global pipe untouched, so an already-deployed kiosk's legacy single-object
 * body still gets the exact same 201 `{ photoId }` it always did.
 */
const DEVICE = { id: 'device-1', campaignId: 'campaign-1' };

let counter = 0;
function photo(over: Record<string, unknown> = {}) {
  counter += 1;
  return {
    photoId: randomUUID(),
    sessionId: randomUUID(),
    stepId: `step-${counter}`,
    attempt: 1,
    dataUrl: 'data:image/jpeg;base64,AAAA',
    ...over,
  };
}

describe('POST /v1/devices/photos (1-n, over HTTP)', () => {
  let app: INestApplication<App>;
  let device: { id: string; campaignId: string | null };
  const photoService = {
    addDevicePhoto: jest.fn(),
    addDevicePhotos: jest.fn(),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [DeviceSelfController],
      providers: [
        { provide: PhotoService, useValue: photoService },
        { provide: CampaignService, useValue: {} },
        { provide: DeviceEventService, useValue: {} },
        { provide: SessionVideoService, useValue: {} },
        { provide: SessionService, useValue: {} },
      ],
    })
      .overrideGuard(DeviceCredentialsGuard)
      .useValue({
        canActivate: (ctx: ExecutionContext) => {
          ctx.switchToHttp().getRequest<{ device?: unknown }>().device = device;
          return true;
        },
      })
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

  beforeEach(() => {
    device = { ...DEVICE };
    photoService.addDevicePhoto.mockReset();
    photoService.addDevicePhotos.mockReset();
    photoService.addDevicePhoto.mockImplementation(
      (_d: string, _c: string, dto: { photoId: string }) =>
        Promise.resolve({ photoId: dto.photoId }),
    );
    photoService.addDevicePhotos.mockImplementation(
      (_d: string, _c: string, dtos: Array<{ photoId: string }>) =>
        Promise.resolve({
          requested: dtos.length,
          succeeded: dtos.length,
          failed: 0,
          results: dtos.map((d) => ({ photoId: d.photoId, ok: true })),
        }),
    );
  });

  const post = (body: unknown) =>
    request(app.getHttpServer())
      .post('/v1/devices/photos')
      .send(body as object);

  describe('legacy single-object body (already-deployed kiosks)', () => {
    it('is 201 with { photoId } — unchanged status and response shape — and goes to addDevicePhoto only', async () => {
      const body = photo();

      const res = await post(body).expect(HttpStatus.CREATED);

      expect(res.body).toMatchObject({
        statusCode: 201,
        data: { photoId: body.photoId },
      });
      expect(photoService.addDevicePhoto).toHaveBeenCalledTimes(1);
      expect(photoService.addDevicePhoto).toHaveBeenCalledWith(
        DEVICE.id,
        DEVICE.campaignId,
        expect.objectContaining({
          photoId: body.photoId,
          sessionId: body.sessionId,
          stepId: body.stepId,
          attempt: 1,
        }),
      );
      expect(photoService.addDevicePhotos).not.toHaveBeenCalled();
    });

    it('still whitelists: an unknown key never reaches the service', async () => {
      await post({ ...photo(), sneaky: 'x' }).expect(HttpStatus.CREATED);

      const dto = (
        photoService.addDevicePhoto.mock.calls[0] as unknown[]
      )[2] as object;
      expect(dto).not.toHaveProperty('sneaky');
    });

    it('an invalid body is still a 400 with the validator message', async () => {
      const res = await post({ ...photo(), stepId: 'a/b' }).expect(
        HttpStatus.BAD_REQUEST,
      );

      expect(envelopeOf(res).message).toMatch(/stepId must contain only/);
      expect(photoService.addDevicePhoto).not.toHaveBeenCalled();
    });

    it('a service failure keeps its own HTTP status, exactly as today (403 stays a 403, not a 201 with an error inside)', async () => {
      photoService.addDevicePhoto.mockRejectedValue(
        new CustomException('nope', 4030, HttpStatus.FORBIDDEN),
      );

      const res = await post(photo()).expect(HttpStatus.FORBIDDEN);

      expect(res.body).toMatchObject({ statusCode: 403, message: 'nope' });
    });

    it('a self-enrolled device (no campaign) is a 409, as before', async () => {
      device = { id: 'device-1', campaignId: null };

      await post(photo()).expect(HttpStatus.CONFLICT);

      expect(photoService.addDevicePhoto).not.toHaveBeenCalled();
    });
  });

  describe('1-n body', () => {
    it('{ photos: [...] } is 201 with the per-photo result envelope, via addDevicePhotos only', async () => {
      const a = photo();
      const b = photo();

      const res = await post({ photos: [a, b] }).expect(HttpStatus.CREATED);

      expect(envelopeOf(res).data).toEqual({
        requested: 2,
        succeeded: 2,
        failed: 0,
        results: [
          { photoId: a.photoId, ok: true },
          { photoId: b.photoId, ok: true },
        ],
      });
      expect(photoService.addDevicePhotos).toHaveBeenCalledTimes(1);
      expect(photoService.addDevicePhotos).toHaveBeenCalledWith(
        DEVICE.id,
        DEVICE.campaignId,
        [
          expect.objectContaining({ photoId: a.photoId }),
          expect.objectContaining({ photoId: b.photoId }),
        ],
      );
      expect(photoService.addDevicePhoto).not.toHaveBeenCalled();
    });

    it('a bare array is accepted too', async () => {
      const res = await post([photo(), photo()]).expect(HttpStatus.CREATED);

      expect(envelopeOf(res).data).toMatchObject({
        requested: 2,
        succeeded: 2,
      });
    });

    it('per-photo failures come back inside a 201, not as an HTTP error', async () => {
      const a = photo();
      const b = photo();
      photoService.addDevicePhotos.mockResolvedValue({
        requested: 2,
        succeeded: 1,
        failed: 1,
        results: [
          { photoId: a.photoId, ok: true },
          {
            photoId: b.photoId,
            ok: false,
            statusCode: 403,
            errorCode: 4030,
            message: 'Session belongs to a different device/campaign',
          },
        ],
      });

      const res = await post({ photos: [a, b] }).expect(HttpStatus.CREATED);

      expect(envelopeOf(res).data.failed).toBe(1);
      expect(envelopeOf(res).data.results[1]).toMatchObject({
        ok: false,
        statusCode: 403,
      });
    });

    it('an empty batch is a 400', async () => {
      await post({ photos: [] }).expect(HttpStatus.BAD_REQUEST);
      await post([]).expect(HttpStatus.BAD_REQUEST);
      expect(photoService.addDevicePhotos).not.toHaveBeenCalled();
    });

    it('a duplicate photoId is a 400', async () => {
      const a = photo();

      await post({ photos: [a, { ...photo(), photoId: a.photoId }] }).expect(
        HttpStatus.BAD_REQUEST,
      );

      expect(photoService.addDevicePhotos).not.toHaveBeenCalled();
    });

    it('one invalid item fails the whole body with a 400', async () => {
      await post({ photos: [photo(), { ...photo(), photoId: 'nope' }] }).expect(
        HttpStatus.BAD_REQUEST,
      );
    });

    it('a self-enrolled device (no campaign) is a 409 for a batch too', async () => {
      device = { id: 'device-1', campaignId: null };

      await post({ photos: [photo()] }).expect(HttpStatus.CONFLICT);

      expect(photoService.addDevicePhotos).not.toHaveBeenCalled();
    });
  });
});
