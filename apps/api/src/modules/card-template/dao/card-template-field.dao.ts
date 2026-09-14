import { ApiProperty } from '@nestjs/swagger';

export class CardTemplateFieldDao {
  @ApiProperty() field: string;
  @ApiProperty() label: string;
  @ApiProperty() type: string;
}
