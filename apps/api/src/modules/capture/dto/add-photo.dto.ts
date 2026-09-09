import type { CaptureTriggerMode, CaptureTriggerSource } from '@face/core';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

/** `@face/core`'s `CaptureTriggerSource` - see that type's own doc comment and §3.7.1 of the discussion doc. */
const TRIGGER_SOURCES: CaptureTriggerSource[] = [
  'AUTO',
  'GESTURE',
  'SHUTTER',
  'EXTERNAL',
];

/** `@face/core`'s `CaptureTriggerMode`. */
const CAPTURE_MODES: CaptureTriggerMode[] = ['AUTO', 'MANUAL', 'OFF'];

export class AddPhotoDto {
  @ApiProperty({ description: 'Bước trong quy trình chụp, ví dụ FRONT/LEFT' })
  @IsString()
  @IsNotEmpty()
  stepId: string;

  @ApiProperty({
    description: 'Số lần thử của bước này, bắt đầu từ 1',
    default: 1,
  })
  @IsInt()
  @Min(1)
  attempt: number;

  @ApiProperty({
    description: 'Ảnh dạng data URL base64, ví dụ "data:image/jpeg;base64,..."',
  })
  @IsString()
  @IsNotEmpty()
  dataUrl: string;

  @ApiPropertyOptional({
    description: 'Nguồn kích hoạt chụp, nếu có',
    enum: TRIGGER_SOURCES,
  })
  @IsOptional()
  @IsIn(TRIGGER_SOURCES)
  triggerSource?: CaptureTriggerSource;

  @ApiPropertyOptional({
    description: 'Chế độ chụp đang bật khi ảnh này được chụp, nếu có',
    enum: CAPTURE_MODES,
  })
  @IsOptional()
  @IsIn(CAPTURE_MODES)
  captureMode?: CaptureTriggerMode;
}
