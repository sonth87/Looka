import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsNotEmpty, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreatePhotoKindDto {
  @ApiProperty({ description: 'Mã loại ảnh, ví dụ STUDENT_CARD' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  code: string;

  @ApiProperty({ description: 'Tên hiển thị tiếng Việt' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  labelVi: string;

  @ApiProperty({ description: 'Chuẩn ảnh thẻ mặc định (cỡ, dpi, nền, tỉ lệ đầu/mắt)' })
  @IsObject()
  cardSpec: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Bộ kiểm tra chất lượng riêng cho loại ảnh này' })
  @IsOptional()
  @IsObject()
  qualityProfile?: Record<string, unknown>;

  @ApiPropertyOptional({ type: [String], description: 'Gợi ý prompt AI' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  promptHints?: string[];

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
