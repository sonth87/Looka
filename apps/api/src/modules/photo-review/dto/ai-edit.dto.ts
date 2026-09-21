import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

/** Body of `POST /v1/review/sets/:id/ai-edit` — plan §5.3/§7. */
export class AiEditDto {
  @ApiProperty({
    description: 'Yêu cầu sửa ảnh, tiếng Việt tự do (có bộ lọc từ cấm)',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  prompt: string;

  @ApiPropertyOptional({
    description:
      'Vùng được sửa: OUTSIDE_FACE (mặc định) | GLASSES | HAIR | FULL',
  })
  @IsOptional()
  @IsString()
  region?: string;

  @ApiPropertyOptional({
    description: 'Sửa tiếp từ phiên bản này thay vì ảnh thẻ hiện tại',
  })
  @IsOptional()
  @IsUUID()
  fromVariantId?: string;

  /**
   * Giai đoạn 5 (plan §5.1, feature 12) — chọn nguồn sửa: `VARIANT` (mặc
   * định, hành vi cũ — sửa tiếp từ `fromVariantId`/ảnh thẻ hiện tại) hoặc
   * `ORIGINAL_PHOTO` (sửa từ một ảnh camera gốc, dùng `sourcePhotoId`).
   * Không dùng đồng thời với `fromVariantId` — khi là `ORIGINAL_PHOTO`,
   * `sourcePhotoId` là bắt buộc và `fromVariantId` bị bỏ qua.
   */
  @ApiPropertyOptional({
    description: 'VARIANT (mặc định) | ORIGINAL_PHOTO',
    enum: ['VARIANT', 'ORIGINAL_PHOTO'],
  })
  @IsOptional()
  @IsIn(['VARIANT', 'ORIGINAL_PHOTO'])
  sourceKind?: 'VARIANT' | 'ORIGINAL_PHOTO';

  @ApiPropertyOptional({
    description:
      'Ảnh gốc (bảng photos) dùng làm nguồn — bắt buộc nếu sourceKind = ORIGINAL_PHOTO',
  })
  @IsOptional()
  @IsUUID()
  sourcePhotoId?: string;
}
