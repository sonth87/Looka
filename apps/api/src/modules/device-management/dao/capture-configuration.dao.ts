import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { CaptureStep } from '@face/core';
import { Expose } from 'class-transformer';
import type { CardSpec } from '../entities/campaign.entity';

/** `GET /v1/capture-configurations` (list + detail) — see `CaptureConfiguration`'s own doc comment for what this preset is and is not (a template, never a live link a campaign reads from at runtime). */
export class CaptureConfigurationDao {
  @ApiProperty({ description: 'Capture configuration id (uuid)' })
  @Expose()
  id: string;

  @ApiProperty()
  @Expose()
  name: string;

  @ApiPropertyOptional()
  @Expose()
  description?: string | null;

  @ApiProperty({ description: 'Danh sách bước chụp (mẫu)' })
  @Expose()
  captureAngles: CaptureStep[];

  @ApiPropertyOptional({ description: 'Chuẩn ảnh thẻ (mẫu)' })
  @Expose()
  cardSpec?: CardSpec | null;

  @ApiProperty({
    description:
      'Số camera vật lý phân biệt mà captureAngles ưu tiên dùng — cùng công thức computeRequiredCameraCount campaign dùng, gợi ý không chặn',
  })
  @Expose()
  requiredCameraCount: number;

  @ApiProperty()
  @Expose()
  createdAt: Date;

  @ApiProperty()
  @Expose()
  updatedAt: Date;
}
