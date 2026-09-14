import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString } from 'class-validator';

/** `POST /v1/printers/:id/heartbeat {status, error}` — agent-authenticated (`PrinterAgentGuard`). */
export class PrinterHeartbeatDto {
  @ApiProperty({ enum: ['ONLINE', 'OFFLINE', 'ERROR'] })
  @IsIn(['ONLINE', 'OFFLINE', 'ERROR'])
  status: 'ONLINE' | 'OFFLINE' | 'ERROR';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  error?: string;
}
