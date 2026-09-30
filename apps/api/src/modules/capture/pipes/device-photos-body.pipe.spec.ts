import { CustomException } from '@app/shared/errors/legacy';
import { ArgumentMetadata } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { MAX_DEVICE_PHOTOS_PER_REQUEST } from '../capture.constants';
import { AddDevicePhotosDto } from '../dto/add-device-photos.dto';
import { DevicePhotosBodyPipe } from './device-photos-body.pipe';

const METADATA: ArgumentMetadata = { type: 'body', metatype: Object };

let counter = 0;
/** A valid `AddDevicePhotoDto` body, unique photoId/step unless overridden. */
function photo(over: Record<string, unknown> = {}) {
  counter += 1;
  const n = String(counter).padStart(12, '0');
  return {
    photoId: `00000000-0000-4000-8000-${n}`,
    sessionId: '11111111-1111-4111-8111-111111111111',
    stepId: `step-${counter}`,
    attempt: 1,
    dataUrl: 'data:image/jpeg;base64,AAAA',
    ...over,
  };
}

describe('DevicePhotosBodyPipe', () => {
  const pipe = new DevicePhotosBodyPipe();

  it('a legacy single object stays single (what already-deployed kiosks send)', async () => {
    const body = photo();
    const out = await pipe.transform(body, METADATA);

    expect(out.mode).toBe('single');
    expect(out.photos).toHaveLength(1);
    expect(out.photos[0]).toMatchObject({
      photoId: body.photoId,
      stepId: body.stepId,
      attempt: 1,
    });
  });

  it('a legacy single object is still whitelisted: unknown keys are stripped, as the global pipe did', async () => {
    const out = await pipe.transform(
      photo({ hackerField: 'x', isAdmin: true }),
      METADATA,
    );
    expect(out.mode).toBe('single');
    expect(out.photos[0]).not.toHaveProperty('hackerField');
    expect(out.photos[0]).not.toHaveProperty('isAdmin');
  });

  it('a legacy single object that is invalid is a 400 with the same validator message', async () => {
    await expect(
      pipe.transform(photo({ stepId: '../etc/passwd' }), METADATA),
    ).rejects.toMatchObject({
      payload: {
        error: 'stepId must contain only letters, digits, "-" and "_"',
      },
    });
    expect((await pipe.transform(photo(), METADATA)).mode).toBe('single');
  });

  it('a value that would overflow its column is a 400 at validation, not a DB error at insert time', async () => {
    // photos.step_id varchar(50), step_type varchar(20), camera_role
    // varchar(255), attempt integer, embedding_jobs.user_code varchar(100).
    const tooLong: Array<[string, unknown]> = [
      ['stepId', 'a'.repeat(51)],
      ['stepType', 'x'.repeat(21)],
      ['cameraRole', 'x'.repeat(256)],
      ['userCode', 'x'.repeat(101)],
      ['attempt', 2_147_483_648],
    ];
    for (const [field, value] of tooLong) {
      await expect(
        pipe.transform(photo({ [field]: value }), METADATA),
      ).rejects.toMatchObject({ payload: { code: 400 } });
    }

    // The boundary values themselves are accepted, on both body shapes.
    const edge = {
      stepId: 'a'.repeat(50),
      stepType: 'x'.repeat(20),
      cameraRole: 'x'.repeat(255),
      userCode: 'x'.repeat(100),
      attempt: 2_147_483_647,
    };
    expect((await pipe.transform(photo(edge), METADATA)).mode).toBe('single');
    expect(
      (await pipe.transform({ photos: [photo(edge)] }, METADATA)).mode,
    ).toBe('batch');
  });

  it('{ photos: [...] } is a batch, and coerces items to real numbers/DTOs', async () => {
    const a = photo();
    const b = photo({ attempt: 2 });
    const out = await pipe.transform({ photos: [a, b] }, METADATA);

    expect(out.mode).toBe('batch');
    expect(out.photos.map((p) => p.photoId)).toEqual([a.photoId, b.photoId]);
    expect(out.photos[1].attempt).toBe(2);
  });

  it('a bare array is a batch too', async () => {
    const out = await pipe.transform([photo(), photo()], METADATA);
    expect(out.mode).toBe('batch');
    expect(out.photos).toHaveLength(2);
  });

  it('a one-element batch is still a batch (only the legacy object is "single")', async () => {
    const out = await pipe.transform({ photos: [photo()] }, METADATA);
    expect(out.mode).toBe('batch');
    expect(out.photos).toHaveLength(1);
  });

  it('an empty batch is a 400', async () => {
    await expect(
      pipe.transform({ photos: [] }, METADATA),
    ).rejects.toMatchObject({ payload: { code: 400 } });
    await expect(pipe.transform([], METADATA)).rejects.toMatchObject({
      payload: { code: 400 },
    });
  });

  it(`more than ${MAX_DEVICE_PHOTOS_PER_REQUEST} photos is a 400`, async () => {
    const tooMany = Array.from(
      { length: MAX_DEVICE_PHOTOS_PER_REQUEST + 1 },
      () => photo(),
    );
    await expect(
      pipe.transform({ photos: tooMany }, METADATA),
    ).rejects.toMatchObject({ payload: { code: 400 } });

    const exactlyMax = Array.from(
      { length: MAX_DEVICE_PHOTOS_PER_REQUEST },
      () => photo(),
    );
    const out = await pipe.transform({ photos: exactlyMax }, METADATA);
    expect(out.photos).toHaveLength(MAX_DEVICE_PHOTOS_PER_REQUEST);
  });

  it('one invalid item fails the whole batch body with a 400', async () => {
    await expect(
      pipe.transform(
        { photos: [photo(), photo({ photoId: 'not-a-uuid' })] },
        METADATA,
      ),
    ).rejects.toMatchObject({ payload: { code: 400 } });
  });

  it('an item in a batch is whitelisted too (nested validation strips unknown keys)', async () => {
    const out = await pipe.transform(
      { photos: [photo({ sneaky: 1 })] },
      METADATA,
    );
    expect(out.photos[0]).not.toHaveProperty('sneaky');
  });

  it('a duplicate photoId inside a batch is a 400 (results are keyed by photoId)', async () => {
    const a = photo();
    const err = await pipe
      .transform({ photos: [a, photo({ photoId: a.photoId })] }, METADATA)
      .then(
        () => null,
        (e: CustomException) => e,
      );

    expect(err).toBeInstanceOf(CustomException);
    expect(err?.payload.code).toBe(400);
    expect(err?.payload.error).toContain(a.photoId);
  });

  it('the duplicate-photoId rule lives on AddDevicePhotosDto itself, not only in this pipe', async () => {
    const a = photo();
    const dto = plainToInstance(AddDevicePhotosDto, {
      photos: [a, photo({ photoId: a.photoId })],
    });

    const errors = await validate(dto);

    expect(errors.map((e) => e.property)).toEqual(['photos']);
    expect(Object.keys(errors[0].constraints ?? {})).toContain('arrayUnique');
  });

  it('the same session/step/attempt under DIFFERENT photoIds is accepted (sequential processing == two single calls)', async () => {
    const a = photo({ stepId: 'FRONT', attempt: 1 });
    const b = photo({ stepId: 'FRONT', attempt: 1 });
    expect(a.photoId).not.toBe(b.photoId);

    const out = await pipe.transform({ photos: [a, b] }, METADATA);

    expect(out.mode).toBe('batch');
    expect(out.photos).toHaveLength(2);
  });

  it('non-object bodies fall through to the single-photo validator and are rejected as before', async () => {
    for (const bad of [null, undefined, 'a string', 42]) {
      await expect(pipe.transform(bad, METADATA)).rejects.toBeDefined();
    }
  });
});
