import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdatePhotoKindDto {
  @ApiPropertyOptional({ description: 'Tên hiển thị tiếng Việt' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  labelVi?: string;

  @ApiPropertyOptional({ description: 'Chuẩn ảnh thẻ mặc định (cỡ, dpi, nền, tỉ lệ đầu/mắt)' })
  @IsOptional()
  @IsObject()
  cardSpec?: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Bộ kiểm tra chất lượng riêng cho loại ảnh này' })
  @IsOptional()
  @IsObject()
  qualityProfile?: Record<string, unknown>;

  @ApiPropertyOptional({ type: [String], description: 'Gợi ý prompt AI' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  promptHints?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
