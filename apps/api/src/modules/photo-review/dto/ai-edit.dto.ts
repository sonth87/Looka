import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
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

  @ApiPropertyOptional({
    description:
      'Mức bám prompt (1.0–8.0) gửi cho service AI edit. Bỏ trống → mặc định của app (2.0), không phải mặc định của service (3.0).',
  })
  @IsOptional()
  @IsNumber()
  cfg?: number;

  @ApiPropertyOptional({
    description:
      'Số bước khử nhiễu (10–50) gửi cho service AI edit. Bỏ trống → mặc định của app (20), không phải mặc định của service (30).',
  })
  @IsOptional()
  @IsInt()
  steps?: number;

  @ApiPropertyOptional({
    description:
      'Số ngẫu nhiên khởi tạo — truyền lại giá trị đã nhận trước đó (xem AiImageEditResult.seed) để tái tạo đúng kết quả cũ. Bỏ trống → service tự bốc ngẫu nhiên.',
  })
  @IsOptional()
  @IsInt()
  seed?: number;
}
