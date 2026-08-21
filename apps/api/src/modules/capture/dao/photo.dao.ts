import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Expose } from 'class-transformer';

export class PhotoDao {
  @ApiProperty({ description: 'Photo id (uuid)' })
  @Expose()
  id: string;

  @ApiProperty()
  @Expose()
  stepId: string;

  @ApiProperty()
  @Expose()
  attempt: number;

  @ApiProperty()
  @Expose()
  bytes: number;

  @ApiProperty()
  @Expose()
  mimeType: string;

  @ApiProperty()
  @Expose()
  capturedAt: Date;

  @ApiPropertyOptional({ description: 'file_id trên file-service' })
  @Expose()
  fsFileId?: string;

  @ApiPropertyOptional({ description: 'Trạng thái file trên file-service' })
  @Expose()
  fsStatus?: string;

  @ApiProperty({
    description:
      'PENDING/SENDING/UPLOADED/FAILED trên hàng đợi nội bộ, hoặc UPLOADED nếu đã xong',
  })
  @Expose()
  uploadStatus: string;
}
