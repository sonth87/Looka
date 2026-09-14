import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class PermissionReadModel {
  @ApiProperty() id: string;
  @ApiProperty() code: string;
  @ApiProperty() group: string;
  @ApiPropertyOptional({ nullable: true }) method: string | null;
  @ApiPropertyOptional({ nullable: true }) path: string | null;
  @ApiPropertyOptional({ nullable: true }) description: string | null;
}
