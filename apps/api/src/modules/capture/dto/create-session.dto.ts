import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateSessionDto {
  @ApiPropertyOptional({ description: 'Mã định danh người được chụp, nếu có' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  subjectCode?: string;

  @ApiPropertyOptional({ description: 'Tên người được chụp, nếu có' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  subjectName?: string;

  @ApiPropertyOptional({ description: 'Dữ liệu bổ sung tuỳ ý' })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
