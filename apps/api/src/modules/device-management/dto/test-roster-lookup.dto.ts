import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

/** One `eligibilityConfig.rules[]` entry — same shape `evaluateEligibilityRules` expects (`../util/eligibility-rule.evaluator.ts`), sent ad-hoc from the campaign-editing screen (not yet saved). */
export class TestRosterLookupRuleInput {
  @ApiProperty()
  @IsString()
  @MaxLength(100)
  key: string;

  @ApiProperty()
  @IsString()
  @MaxLength(500)
  expr: string;

  @ApiProperty()
  @IsString()
  @MaxLength(500)
  message: string;
}

/**
 * `POST /v1/campaigns/:id/subjects/test-roster-lookup` body (plan §E.3) —
 * mirrors `TestEligibilityLookupDto`'s "test before you save" pattern, but
 * for the ROSTER/ROSTER_AND_API branch: no roster row exists to test
 * against until the campaign already has an import, so this only ever
 * takes `key` + the not-yet-saved `rules` from the campaign-editor form,
 * never a full API config.
 */
export class TestRosterLookupDto {
  @ApiProperty({ description: 'Mã SV hoặc CCCD để tra thử' })
  @IsString()
  @MaxLength(100)
  key: string;

  @ApiPropertyOptional({ type: [TestRosterLookupRuleInput] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TestRosterLookupRuleInput)
  rules?: TestRosterLookupRuleInput[];
}
