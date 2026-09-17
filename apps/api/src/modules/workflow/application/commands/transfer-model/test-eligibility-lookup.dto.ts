import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

const AUTH_TYPES = [
  'NONE',
  'API_KEY_HEADER',
  'BEARER_TOKEN',
  'QUERY_PARAM',
] as const;
const REQUEST_METHODS = ['GET', 'POST'] as const;

/**
 * Ad-hoc test call (2026-09-17 redo of plan item 7) — takes the FULL API
 * config directly, the same shape `config.eligibility.api` in a workflow
 * stores, rather than a `clientCode` looked up from a shared catalog. Lets
 * a workflow author test-call an endpoint while still editing a
 * not-yet-saved draft — no need to save anything first. `credential` is
 * plaintext here (used once for this one live call, never persisted by
 * this endpoint) — see `TestEligibilityLookupHandler`'s own doc comment.
 */
export class TestEligibilityLookupDto {
  @ApiProperty()
  @IsString()
  @MaxLength(500)
  baseUrl: string;

  @ApiPropertyOptional({ enum: REQUEST_METHODS, default: 'POST' })
  @IsOptional()
  @IsIn(REQUEST_METHODS)
  requestMethod?: (typeof REQUEST_METHODS)[number];

  @ApiProperty()
  @IsString()
  @MaxLength(500)
  requestPath: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  requestBodyTemplate?: Record<string, unknown>;

  @ApiPropertyOptional({ enum: AUTH_TYPES, default: 'API_KEY_HEADER' })
  @IsOptional()
  @IsIn(AUTH_TYPES)
  authType?: (typeof AUTH_TYPES)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  authParamName?: string;

  @ApiPropertyOptional({
    description:
      'Credential dùng thử — chỉ dùng 1 lần cho lệnh gọi này, không được lưu lại',
  })
  @IsOptional()
  @IsString()
  credential?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  keyResponsePath?: string;

  @ApiProperty({ description: 'Mã dùng để tra cứu thử, ví dụ mã sinh viên' })
  @IsString()
  @MaxLength(100)
  key: string;
}
