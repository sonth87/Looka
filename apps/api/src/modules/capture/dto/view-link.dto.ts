import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class ViewLinkDto {
  @ApiPropertyOptional({
    description:
      'Danh tính người xem, đối chiếu quyền lúc link được MỞ (không phải lúc sinh)',
    default: 'web-viewer',
  })
  @IsOptional()
  @IsString()
  viewerId?: string;
}
