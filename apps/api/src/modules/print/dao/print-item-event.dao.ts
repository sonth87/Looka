import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { PrintItemEvent } from '../entities/print-item-event.entity';

export class PrintItemEventDao {
  @ApiProperty() id: string;
  @ApiPropertyOptional() fromStatus?: string | null;
  @ApiProperty() toStatus: string;
  @ApiProperty() source: string;
  @ApiPropertyOptional() actorUserId?: string | null;
  @ApiPropertyOptional() message?: string | null;
  @ApiProperty() at: Date;

  static from(event: PrintItemEvent): PrintItemEventDao {
    const dao = new PrintItemEventDao();
    dao.id = event.id;
    dao.fromStatus = event.fromStatus ?? null;
    dao.toStatus = event.toStatus;
    dao.source = event.source;
    dao.actorUserId = event.actorUserId ?? null;
    dao.message = event.message ?? null;
    dao.at = event.at;
    return dao;
  }
}
