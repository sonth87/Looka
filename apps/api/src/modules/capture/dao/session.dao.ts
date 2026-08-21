import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Expose } from 'class-transformer';
import { SessionStatus } from '../capture.constants';

export class SessionDao {
  @ApiProperty({ description: 'Session id (uuid)' })
  @Expose()
  id: string;

  @ApiPropertyOptional()
  @Expose()
  subjectCode?: string;

  @ApiPropertyOptional()
  @Expose()
  subjectName?: string;

  @ApiProperty({ enum: SessionStatus })
  @Expose()
  status: SessionStatus;

  @ApiPropertyOptional()
  @Expose()
  completedAt?: Date;

  @ApiProperty()
  @Expose()
  createdAt: Date;

  @ApiProperty()
  @Expose()
  updatedAt: Date;
}
