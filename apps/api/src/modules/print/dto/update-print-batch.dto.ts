import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID } from 'class-validator';
import { PRINT_BATCH_MODES, type PrintBatchMode } from '../print.constants';

export class UpdatePrintBatchDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  defaultTemplateId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  printerId?: string;

  @ApiPropertyOptional({ enum: PRINT_BATCH_MODES })
  @IsOptional()
  @IsIn(PRINT_BATCH_MODES)
  mode?: PrintBatchMode;
}
