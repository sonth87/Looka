import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Expose } from 'class-transformer';

export class IdentificationMethodDao {
  @ApiProperty()
  @Expose()
  id: string;

  @ApiProperty()
  @Expose()
  code: string;

  @ApiProperty()
  @Expose()
  nameVi: string;

  @ApiPropertyOptional()
  @Expose()
  description?: string | null;

  @ApiProperty()
  @Expose()
  requiresHardware: boolean;

  @ApiProperty()
  @Expose()
  active: boolean;

  @ApiProperty()
  @Expose()
  sortOrder: number;
}
