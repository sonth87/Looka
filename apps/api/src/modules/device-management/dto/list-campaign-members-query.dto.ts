import { QueryPaginateDto } from '@app/common/dto';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import type { CampaignMemberStatus } from '../entities/campaign-member.entity';

const STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'REVOKED'] as const;

export class ListCampaignMembersQueryDto extends QueryPaginateDto {
  @ApiPropertyOptional({ enum: STATUSES })
  @IsOptional()
  @IsIn(STATUSES)
  status?: CampaignMemberStatus;
}
