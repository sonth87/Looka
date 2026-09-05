import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';

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

  /**
   * Which installer to embed in the activation zip — see
   * `ActivationPackageService`'s own doc comment. Optional: a campaign
   * registering only one OS's kiosks can leave this unset and always get
   * that OS's build, same as before this field existed.
   */
  @ApiPropertyOptional({ enum: ['mac', 'win'], description: 'Hệ điều hành của installer đóng gói kèm' })
  @IsOptional()
  @IsEnum(['mac', 'win'])
  os?: 'mac' | 'win';
}
