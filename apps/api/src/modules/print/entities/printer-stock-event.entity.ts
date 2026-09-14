import { BaseEntity } from '@app/shared/database/base.entity';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import type { PrinterStockEventReason } from '../print.constants';
import { Printer } from './printer.entity';

/**
 * Audit trail for every `printers.blank_stock` change — plan §2.7.
 * `resultingStock` is a point-in-time snapshot (not recomputed from the sum
 * of deltas at read time) so the history stays readable even if a future
 * migration changes how `blank_stock` is derived — same reasoning
 * `Device.lastAuthFailReason` etc. keep a display-only mirror alongside the
 * source-of-truth column.
 */
@Entity('printer_stock_events')
export class PrinterStockEvent extends BaseEntity {
  @Column('uuid', { name: 'printer_id' })
  @Index()
  @ApiProperty({ description: 'Máy in liên quan' })
  printerId: string;

  @ManyToOne(() => Printer, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'printer_id' })
  printer?: Printer;

  @Column('int')
  @ApiProperty({ description: 'Thay đổi (+/-)' })
  delta: number;

  @Column('varchar', { length: 10 })
  @ApiProperty({ description: 'REFILL | PRINT | ADJUST | WASTE' })
  reason: PrinterStockEventReason;

  @Column('int', { name: 'resulting_stock' })
  @ApiProperty({ description: 'Số phôi còn lại sau thay đổi này' })
  resultingStock: number;

  @Column('uuid', { name: 'actor_user_id', nullable: true })
  @ApiPropertyOptional({
    description: 'Người thực hiện, null nếu hệ thống tự động (PRINT)',
  })
  actorUserId?: string | null;

  @Column('text', { nullable: true })
  @ApiPropertyOptional({ description: 'Ghi chú' })
  note?: string | null;

  @Column('timestamptz', { default: () => 'now()' })
  @ApiProperty({ description: 'Thời điểm thay đổi' })
  at: Date;
}
