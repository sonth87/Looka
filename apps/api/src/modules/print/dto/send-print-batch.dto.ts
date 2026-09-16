import { ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsOptional, IsUUID } from 'class-validator';
import { MAX_BULK_ITEMS } from '../print.constants';

/**
 * `POST /v1/print/batches/:id/send {itemIds?}`. Omitted (or empty) means
 * "every RENDERED item in the batch" — today's whole-batch behavior, kept
 * as the default so existing callers are unaffected. When provided,
 * `PrintBatchService.send()` scopes both the DIRECT-mode QUEUED transition
 * and the CENTRALIZED-mode RENDERED-count check to just these ids (still
 * only the ones that are RENDERED and actually belong to this batch — a
 * foreign or unknown id is a 400, never silently dropped).
 */
export class SendPrintBatchDto {
  @ApiPropertyOptional({
    type: [String],
    description: 'Chỉ gửi in các item này (bỏ trống = cả đợt)',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_BULK_ITEMS)
  @IsUUID('4', { each: true })
  itemIds?: string[];
}
