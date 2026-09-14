import { ApiProperty } from '@nestjs/swagger';
import type { Printer } from '../entities/printer.entity';
import { PrinterListItemDao } from './printer-list-item.dao';
import { PrinterStockEventDao } from './printer-stock-event.dao';
import type { PrinterStockEvent } from '../entities/printer-stock-event.entity';

/** `GET /v1/printers/:id` — list row + queue depth (items QUEUED/PRINTING for this printer) + last 20 stock events (plan §2.7). */
export class PrinterDetailDao extends PrinterListItemDao {
  @ApiProperty({ description: 'Số item đang chờ/đang in trên máy này' })
  queueDepth: number;

  @ApiProperty({ type: [PrinterStockEventDao] })
  recentStockEvents: PrinterStockEventDao[];

  static fromDetail(
    printer: Printer,
    queueDepth: number,
    recentStockEvents: PrinterStockEvent[],
    hasToken: boolean,
  ): PrinterDetailDao {
    const base = PrinterListItemDao.from(printer);
    const dao = new PrinterDetailDao();
    Object.assign(dao, base);
    dao.hasToken = hasToken;
    dao.queueDepth = queueDepth;
    dao.recentStockEvents = recentStockEvents.map((e) =>
      PrinterStockEventDao.from(e),
    );
    return dao;
  }
}
