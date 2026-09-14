import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  PRINTER_PRINT_MODES,
  PRINTER_USAGE_MODES,
  type PrinterConnection,
  type PrinterPrintMode,
  type PrinterUsageMode,
} from '../print.constants';

class PrinterConnectionDto implements PrinterConnection {
  @ApiProperty({ enum: ['USB', 'NETWORK', 'AGENT'] })
  @IsIn(['USB', 'NETWORK', 'AGENT'])
  type: 'USB' | 'NETWORK' | 'AGENT';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  address?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  spoolerName?: string | null;
}

export class CreatePrinterDto {
  @ApiProperty({ description: 'Tên máy in' })
  @IsString()
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  model?: string;

  @ApiPropertyOptional({ enum: PRINTER_PRINT_MODES, default: 'SINGLE_SIDE' })
  @IsOptional()
  @IsIn(PRINTER_PRINT_MODES)
  printMode?: PrinterPrintMode;

  @ApiPropertyOptional({ enum: PRINTER_USAGE_MODES, default: 'CENTRALIZED' })
  @IsOptional()
  @IsIn(PRINTER_USAGE_MODES)
  usageMode?: PrinterUsageMode;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  location?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  deviceId?: string;

  @ApiPropertyOptional({ type: PrinterConnectionDto })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => PrinterConnectionDto)
  connection?: PrinterConnectionDto;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  blankStock?: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  lowStockThreshold?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  defaultTemplateId?: string;
}
