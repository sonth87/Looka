import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { PrintItem } from '../entities/print-item.entity';
import {
  PrintItemListItemDao,
  computeMissingFields,
} from './print-item-list-item.dao';
import { PrintItemEventDao } from './print-item-event.dao';
import type { PrintItemEvent } from '../entities/print-item-event.entity';

/** `GET /v1/print/items/:id` — list row plus `extra` + recent events (plan §2.5: "incl. card photo, render preview" — the preview itself is the separate `GET /v1/print/items/:id/preview` PNG route, not embedded here as base64). */
export class PrintItemDetailDao extends PrintItemListItemDao {
  @ApiPropertyOptional() extra?: Record<string, unknown> | null;
  @ApiPropertyOptional() renderedFrontFsFileId?: string | null;
  @ApiPropertyOptional() renderedBackFsFileId?: string | null;
  @ApiProperty({ type: [PrintItemEventDao] }) events: PrintItemEventDao[];

  static fromDetail(
    item: PrintItem,
    events: PrintItemEvent[],
  ): PrintItemDetailDao {
    const base = PrintItemListItemDao.from(item);
    const dao = new PrintItemDetailDao();
    Object.assign(dao, base);
    dao.missingFields = computeMissingFields(item);
    dao.extra = item.extra ?? null;
    dao.renderedFrontFsFileId = item.renderedFrontFsFileId ?? null;
    dao.renderedBackFsFileId = item.renderedBackFsFileId ?? null;
    dao.events = events.map((e) => PrintItemEventDao.from(e));
    return dao;
  }
}
