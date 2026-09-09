import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';

export class ListCaptureAnglePresetsQueryDto {
  @ApiPropertyOptional({
    description:
      'true = trả cả preset đã active=false, mặc định chỉ trả preset đang active',
    default: false,
  })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  includeInactive?: boolean;
}
