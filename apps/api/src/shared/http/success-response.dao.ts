import { Expose } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

/**
 * Response shape for an endpoint with no resource to return - a DELETE, or an
 * action whose only interesting outcome is "it happened" (e.g. completing a
 * session, where the caller already has the session it just completed).
 */
export class SuccessResponseDao {
  @ApiProperty()
  @Expose()
  status: boolean;

  @ApiProperty()
  @Expose()
  message: string;
}
