import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { PrinterStockEvent } from '../entities/printer-stock-event.entity';

export class PrinterStockEventDao {
  @ApiProperty() id: string;
  @ApiProperty() printerId: string;
  @ApiProperty() delta: number;
  @ApiProperty() reason: string;
  @ApiProperty() resultingStock: number;
  @ApiPropertyOptional() actorUserId?: string | null;
  @ApiPropertyOptional() note?: string | null;
  @ApiProperty() at: Date;

  static from(event: PrinterStockEvent): PrinterStockEventDao {
    const dao = new PrinterStockEventDao();
    dao.id = event.id;
    dao.printerId = event.printerId;
    dao.delta = event.delta;
    dao.reason = event.reason;
    dao.resultingStock = event.resultingStock;
    dao.actorUserId = event.actorUserId ?? null;
    dao.note = event.note ?? null;
    dao.at = event.at;
    return dao;
  }
}
