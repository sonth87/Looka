import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString } from 'class-validator';

export type CampaignMemberDecision = 'approve' | 'reject' | 'revoke';

export class DecideCampaignMemberDto {
  @ApiProperty({ enum: ['approve', 'reject', 'revoke'] })
  @IsIn(['approve', 'reject', 'revoke'])
  action: CampaignMemberDecision;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  note?: string;
}
