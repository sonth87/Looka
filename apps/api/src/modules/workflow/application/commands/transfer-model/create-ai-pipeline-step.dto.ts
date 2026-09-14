import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

const SIDECAR_ENDPOINTS = [
  '/card-photo',
  '/background',
  '/retouch',
  '/edit',
] as const;

export class CreateAiPipelineStepDto {
  @ApiProperty({ description: 'Mã bước, ví dụ CARD_CROP' })
  @IsString()
  @MaxLength(50)
  code: string;

  @ApiProperty({ description: 'Tên hiển thị' })
  @IsString()
  @MaxLength(255)
  nameVi: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ enum: SIDECAR_ENDPOINTS })
  @IsIn(SIDECAR_ENDPOINTS)
  sidecarEndpoint: (typeof SIDECAR_ENDPOINTS)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  paramsSchema?: Record<string, unknown>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  defaultParams?: Record<string, unknown>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  sortOrder?: number;
}
