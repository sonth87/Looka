import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString } from 'class-validator';

/**
 * `POST /v1/print/items/:id/status {status, message}` — the print-agent
 * callback (`PrinterAgentGuard`, not `SsoAuthGuard`). Deliberately a
 * narrower status set than `UpdatePrintItemDto`'s — an agent may only ever
 * report PRINTING/PRINTED/FAILED (BA #14 lets PRINTED come from here since
 * this route IS the "confirmed physical print" source, alongside the
 * manual action), never RENDERED/QUEUED/CANCELLED/REPRINT_REQUESTED, which
 * are CMS/system-only transitions.
 */
export class PrintItemStatusCallbackDto {
  @ApiProperty({ enum: ['PRINTING', 'PRINTED', 'FAILED'] })
  @IsIn(['PRINTING', 'PRINTED', 'FAILED'])
  status: 'PRINTING' | 'PRINTED' | 'FAILED';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  message?: string;
}
