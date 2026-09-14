import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID } from 'class-validator';
import { PRINT_BATCH_MODES, type PrintBatchMode } from '../print.constants';

export class CreatePrintBatchDto {
  @ApiProperty({ description: 'Tên đợt in' })
  @IsString()
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  campaignId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  defaultTemplateId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  printerId?: string;

  @ApiPropertyOptional({ enum: PRINT_BATCH_MODES, default: 'CENTRALIZED' })
  @IsOptional()
  @IsIn(PRINT_BATCH_MODES)
  mode?: PrintBatchMode;
}
