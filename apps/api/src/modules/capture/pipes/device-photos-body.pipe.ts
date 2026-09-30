import { validationPipes } from '@app/shared/http/validation.pipes';
import { ArgumentMetadata, Injectable, PipeTransform } from '@nestjs/common';
import { AddDevicePhotoDto } from '../dto/add-device-photo.dto';
import { AddDevicePhotosDto } from '../dto/add-device-photos.dto';

/**
 * The normalised body of `POST /v1/devices/photos`.
 *
 * MUST stay a `type`/`interface`, never a class: the controller's
 * `@Body(DevicePhotosBodyPipe) body: DevicePhotosBody` then has design type
 * `Object`, which the GLOBAL `ValidationPipe` (registered in `main.ts`,
 * `whitelist: true`) passes through untouched. A class here would make that
 * global pipe whitelist/strip the raw body against the class BEFORE this
 * pipe runs, turning the still-supported legacy single-object body into a
 * 400 (and, on a deployed kiosk, a permanently dropped photo).
 */
export type DevicePhotosBody = {
  /** `single` = the legacy one-object body (response stays `{ photoId }`); `batch` = `{ photos }` or a bare array. */
  mode: 'single' | 'batch';
  photos: AddDevicePhotoDto[];
};

/**
 * Accepts every body shape `POST /v1/devices/photos` supports and hands the
 * controller one normalised `DevicePhotosBody`:
 *
 *  - legacy single `AddDevicePhotoDto` object — what kiosk builds already
 *    deployed send; validated exactly as before (same class, same
 *    whitelist, same 400 messages), `mode: 'single'`;
 *  - `{ photos: [...] }` — the 1-n form, `mode: 'batch'`;
 *  - a bare `[...]` — shorthand for the same, `mode: 'batch'`.
 *
 * Validation is delegated to the shared `validationPipes` instance rather
 * than re-implemented, so whitelisting and the error format are identical to
 * every other route. Batch-level rules (size, and `photoId` uniqueness) are
 * declared on `AddDevicePhotosDto` itself, so they hold for any consumer of
 * that DTO, not just this pipe.
 */
@Injectable()
export class DevicePhotosBodyPipe implements PipeTransform<
  unknown,
  Promise<DevicePhotosBody>
> {
  async transform(
    value: unknown,
    metadata: ArgumentMetadata,
  ): Promise<DevicePhotosBody> {
    const normalised = Array.isArray(value) ? { photos: value } : value;
    const isBatch =
      typeof normalised === 'object' &&
      normalised !== null &&
      Array.isArray((normalised as { photos?: unknown }).photos);

    if (!isBatch) {
      const dto = (await validationPipes.transform(normalised, {
        ...metadata,
        metatype: AddDevicePhotoDto,
      })) as AddDevicePhotoDto;
      return { mode: 'single', photos: [dto] };
    }

    const dto = (await validationPipes.transform(normalised, {
      ...metadata,
      metatype: AddDevicePhotosDto,
    })) as AddDevicePhotosDto;
    return { mode: 'batch', photos: dto.photos };
  }
}
