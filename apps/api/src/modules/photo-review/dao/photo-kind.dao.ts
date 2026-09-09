import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Expose } from 'class-transformer';

export class PhotoKindDao {
  @ApiProperty({ description: 'Photo kind id (uuid)' })
  @Expose()
  id: string;

  @ApiProperty()
  @Expose()
  code: string;

  @ApiProperty()
  @Expose()
  labelVi: string;

  @ApiProperty()
  @Expose()
  cardSpec: Record<string, unknown>;

  @ApiPropertyOptional()
  @Expose()
  qualityProfile?: Record<string, unknown> | null;

  @ApiProperty({ type: [String] })
  @Expose()
  promptHints: string[];

  @ApiProperty()
  @Expose()
  active: boolean;

  @ApiProperty()
  @Expose()
  createdAt: Date;

  @ApiProperty()
  @Expose()
  updatedAt: Date;
}
