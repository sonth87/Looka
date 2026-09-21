import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';

/**
 * `POST /v1/campaigns/:id/subjects/pulls` (plan §3.1, feature 1). `force`
 * bypasses `CampaignSubjectService.requestPull`'s own "already a pull
 * running/queued within the last 5 minutes" 409 guard — for a CMS admin who
 * genuinely wants to re-trigger (e.g. after fixing the campaign's API
 * config mid-pull).
 */
export class RequestSubjectPullDto {
  @ApiPropertyOptional({
    description: 'Bỏ qua kiểm tra "đã có lần kéo trong 5 phút gần đây"',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  force?: boolean;
}
