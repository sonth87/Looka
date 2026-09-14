import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsUUID } from 'class-validator';

/** `GET /v1/print/items/groups?campaignId&groupBy=className|faculty` — plan §2.5's "gom nhóm". */
export class PrintItemGroupsQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  campaignId?: string;

  @ApiProperty({ enum: ['className', 'faculty'] })
  @IsIn(['className', 'faculty'])
  groupBy: 'className' | 'faculty';
}
