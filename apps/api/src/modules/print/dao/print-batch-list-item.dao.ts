import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { PrintBatch } from '../entities/print-batch.entity';

export class PrintBatchListItemDao {
  @ApiProperty() id: string;
  @ApiProperty() code: string;
  @ApiProperty() name: string;
  @ApiPropertyOptional() campaignId?: string | null;
  @ApiPropertyOptional() defaultTemplateId?: string | null;
  @ApiPropertyOptional() printerId?: string | null;
  @ApiProperty() mode: string;
  @ApiProperty() status: string;
  @ApiPropertyOptional() createdByUserId?: string | null;
  @ApiProperty() itemCount: number;
  @ApiProperty() printedCount: number;
  @ApiProperty() failedCount: number;
  @ApiPropertyOptional() sentAt?: Date | null;
  @ApiPropertyOptional() doneAt?: Date | null;
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;

  static from(batch: PrintBatch): PrintBatchListItemDao {
    const dao = new PrintBatchListItemDao();
    dao.id = batch.id;
    dao.code = batch.code;
    dao.name = batch.name;
    dao.campaignId = batch.campaignId ?? null;
    dao.defaultTemplateId = batch.defaultTemplateId ?? null;
    dao.printerId = batch.printerId ?? null;
    dao.mode = batch.mode;
    dao.status = batch.status;
    dao.createdByUserId = batch.createdByUserId ?? null;
    dao.itemCount = batch.itemCount;
    dao.printedCount = batch.printedCount;
    dao.failedCount = batch.failedCount;
    dao.sentAt = batch.sentAt ?? null;
    dao.doneAt = batch.doneAt ?? null;
    dao.createdAt = batch.createdAt;
    dao.updatedAt = batch.updatedAt;
    return dao;
  }
}
