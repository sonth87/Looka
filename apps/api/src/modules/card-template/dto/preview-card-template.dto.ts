import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsObject, IsOptional, IsUUID } from 'class-validator';

/** `POST /v1/card-templates/:id/preview {setId | sampleData, side}` — exactly one of `setId`/`sampleData` is expected; the service treats `setId` as authoritative if both are somehow sent. */
export class PreviewCardTemplateDto {
  @ApiPropertyOptional({
    description: 'Render bằng dữ liệu thật của 1 hồ sơ duyệt ảnh',
  })
  @IsOptional()
  @IsUUID()
  setId?: string;

  @ApiPropertyOptional({
    description:
      'Render bằng dữ liệu mẫu tự nhập — thiếu field nào dùng dữ liệu mẫu mặc định',
  })
  @IsOptional()
  @IsObject()
  sampleData?: Record<string, string>;

  @ApiPropertyOptional({ enum: ['front', 'back'], default: 'front' })
  @IsOptional()
  @IsIn(['front', 'back'])
  side?: 'front' | 'back';
}
