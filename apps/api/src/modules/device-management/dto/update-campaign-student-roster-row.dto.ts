import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * `PATCH /v1/campaigns/:id/roster/:rowId` — fixing a single bad import row
 * (a mistyped CCCD digit, a misspelled name) in place, per the task's own
 * "no need for a full manual add/edit form beyond what's needed to fix a
 * bad import row" scope call. Every field optional/independent, same
 * partial-update convention `UpdateCampaignDto` etc. already use.
 */
export class UpdateCampaignStudentRosterRowDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  studentCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  studentName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20)
  citizenId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  className?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  major?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20)
  academicYear?: string;
}
