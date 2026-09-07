import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsUrl, MaxLength } from 'class-validator';

/**
 * Body for `POST /v1/devices/:id/reissue`. Both fields are optional because
 * reissuing only needs to rotate the device's secret — `name`/`campaignId`
 * stay whatever they already are, there is nothing to resupply for those.
 * `authApiEndpoint`/`os` exist purely so an admin can correct either while
 * they're at it, same two fields `CreateDeviceDto` accepts at registration.
 * An omitted `authApiEndpoint` keeps the device's current stored value; `os`
 * has no stored per-device column at all (it only ever selects which
 * installer `ActivationPackageService.buildActivationZip` embeds in a given
 * zip), so an omitted `os` falls back to that method's own default, exactly
 * as it does at registration time.
 */
export class ReissueDeviceDto {
  @ApiPropertyOptional({
    description: 'API endpoint lấy thông tin xác thực cho thiết bị này (bỏ trống = giữ nguyên giá trị hiện tại)',
  })
  @IsOptional()
  @IsUrl({ require_tld: false })
  @MaxLength(500)
  authApiEndpoint?: string;

  @ApiPropertyOptional({ enum: ['mac', 'win'], description: 'Hệ điều hành của installer đóng gói kèm' })
  @IsOptional()
  @IsEnum(['mac', 'win'])
  os?: 'mac' | 'win';
}
