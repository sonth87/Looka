import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { Printer } from '../entities/printer.entity';
import type { PrinterConnection } from '../print.constants';

export class PrinterListItemDao {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiPropertyOptional() model?: string | null;
  @ApiProperty() printMode: string;
  @ApiProperty() usageMode: string;
  @ApiPropertyOptional() location?: string | null;
  @ApiPropertyOptional() deviceId?: string | null;
  @ApiPropertyOptional() connection?: PrinterConnection | null;
  @ApiProperty() status: string;
  @ApiPropertyOptional() lastSeenAt?: Date | null;
  @ApiPropertyOptional() lastError?: string | null;
  @ApiProperty() blankStock: number;
  @ApiPropertyOptional() blankStockUpdatedAt?: Date | null;
  @ApiProperty() lowStockThreshold: number;
  @ApiProperty({ description: 'true nếu blankStock <= lowStockThreshold' })
  lowStock: boolean;
  @ApiPropertyOptional() defaultTemplateId?: string | null;
  @ApiProperty({ description: 'true nếu đã cấp token cho agent' })
  hasToken: boolean;
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;

  static from(printer: Printer): PrinterListItemDao {
    const dao = new PrinterListItemDao();
    dao.id = printer.id;
    dao.name = printer.name;
    dao.model = printer.model ?? null;
    dao.printMode = printer.printMode;
    dao.usageMode = printer.usageMode;
    dao.location = printer.location ?? null;
    dao.deviceId = printer.deviceId ?? null;
    dao.connection = printer.connection ?? null;
    dao.status = printer.status;
    dao.lastSeenAt = printer.lastSeenAt ?? null;
    dao.lastError = printer.lastError ?? null;
    dao.blankStock = printer.blankStock;
    dao.blankStockUpdatedAt = printer.blankStockUpdatedAt ?? null;
    dao.lowStockThreshold = printer.lowStockThreshold;
    dao.lowStock = printer.blankStock <= printer.lowStockThreshold;
    dao.defaultTemplateId = printer.defaultTemplateId ?? null;
    // `agentTokenHash` is `select: false` on the entity — `Printer` rows
    // loaded through the normal repository API never carry it, so `hasToken`
    // is derived by `PrinterService` passing it in separately where needed
    // (see `PrinterService.toListItemDao`) rather than read off `printer`
    // here.
    dao.hasToken = false;
    dao.createdAt = printer.createdAt;
    dao.updatedAt = printer.updatedAt;
    return dao;
  }
}
