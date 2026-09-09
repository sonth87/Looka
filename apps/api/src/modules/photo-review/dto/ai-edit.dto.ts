import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

/** Body of `POST /v1/review/sets/:id/ai-edit` — plan §5.3/§7. */
export class AiEditDto {
  @ApiProperty({ description: 'Yêu cầu sửa ảnh, tiếng Việt tự do (có bộ lọc từ cấm)' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  prompt: string;

  @ApiPropertyOptional({
    description: 'Vùng được sửa: OUTSIDE_FACE (mặc định) | GLASSES | HAIR | FULL',
  })
  @IsOptional()
  @IsString()
  region?: string;

  @ApiPropertyOptional({ description: 'Sửa tiếp từ phiên bản này thay vì ảnh thẻ hiện tại' })
  @IsOptional()
  @IsUUID()
  fromVariantId?: string;
}
