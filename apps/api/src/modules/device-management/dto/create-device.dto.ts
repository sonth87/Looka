import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';

export class CreateDeviceDto {
  @ApiProperty({ description: 'Tên thiết bị' })
  @IsString()
  @MaxLength(255)
  name: string;

  @ApiPropertyOptional({ description: 'API endpoint lấy thông tin xác thực cho thiết bị này' })
  @IsOptional()
  @IsUrl({ require_tld: false })
  @MaxLength(500)
  authApiEndpoint?: string;
}
