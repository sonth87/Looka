import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { MAX_DEVICE_PHOTOS_PER_REQUEST } from '../capture.constants';
import { AddDevicePhotoDto } from './add-device-photo.dto';

/**
 * The 1-n body of `POST /v1/devices/photos`: `{ photos: [...] }`. The route
 * also still accepts the legacy single `AddDevicePhotoDto` object (kiosk
 * builds already deployed send that) and a bare `[...]` array — see
 * `DevicePhotosBodyPipe`, which normalises all three shapes before this DTO
 * is ever validated.
 *
 * `photoId` must be unique within a batch (results are reported keyed by
 * `photoId`, so two items with one id would be ambiguous). A duplicate
 * `sessionId:stepId:attempt` under DIFFERENT photoIds is deliberately still
 * accepted — the items run sequentially, which is exactly what the same two
 * single calls would have done.
 */
export class AddDevicePhotosDto {
  @ApiProperty({
    type: [AddDevicePhotoDto],
    description: `1-${MAX_DEVICE_PHOTOS_PER_REQUEST} ảnh trong một request; mỗi photoId chỉ xuất hiện một lần`,
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_DEVICE_PHOTOS_PER_REQUEST)
  @ArrayUnique((photo: AddDevicePhotoDto) => photo.photoId, {
    message: (args) => {
      const ids = Array.isArray(args.value)
        ? (args.value as Array<{ photoId?: unknown } | null>).map(
            (p) => p?.photoId,
          )
        : [];
      const duplicate = ids.find((id, i) => ids.indexOf(id) !== i);
      return `Duplicate photoId "${String(duplicate)}" in the same batch`;
    },
  })
  @ValidateNested({ each: true })
  @Type(() => AddDevicePhotoDto)
  photos: AddDevicePhotoDto[];
}
