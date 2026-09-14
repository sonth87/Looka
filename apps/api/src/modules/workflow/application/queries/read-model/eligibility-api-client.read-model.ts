import { ApiProperty } from '@nestjs/swagger';

export class EligibilityApiClientReadModel {
  @ApiProperty() code: string;
  @ApiProperty() name: string;
  @ApiProperty({
    type: [String],
    description: 'Các field có thể dùng làm requiredFields/keyField',
  })
  fields: string[];
}
