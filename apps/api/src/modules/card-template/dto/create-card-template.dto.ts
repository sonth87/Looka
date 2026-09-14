import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsObject,
  IsOptional,
  IsPositive,
  IsString,
  ValidateNested,
} from 'class-validator';

class CardSizeDto {
  @ApiProperty()
  @IsPositive()
  widthMm: number;

  @ApiProperty()
  @IsPositive()
  heightMm: number;
}

/** `POST /v1/card-templates` — `front`/`back` are optional here (default to a blank layout) and validated by `card-template-layout.schema.ts` in the service, not by class-validator (they are free-form jsonb from the CMS's layout editor). */
export class CreateCardTemplateDto {
  @ApiProperty({ description: 'Mã phôi (duy nhất)' })
  @IsString()
  code: string;

  @ApiProperty({ description: 'Tên phôi' })
  @IsString()
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    type: CardSizeDto,
    description: 'Mặc định CR80 85.6x54mm',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => CardSizeDto)
  cardSize?: CardSizeDto;

  @ApiPropertyOptional({ enum: [300, 600], default: 300 })
  @IsOptional()
  @IsIn([300, 600])
  dpi?: number;

  @ApiPropertyOptional({
    description: 'Bố cục mặt trước — xem card-template-layout.schema.ts',
  })
  @IsOptional()
  @IsObject()
  front?: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Bố cục mặt sau' })
  @IsOptional()
  @IsObject()
  back?: Record<string, unknown>;
}
