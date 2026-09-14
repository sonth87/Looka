import { BaseEntity } from '@app/shared/database/base.entity';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Column, Entity, Index } from 'typeorm';
import type {
  PrinterConnection,
  PrinterPrintMode,
  PrinterStatus,
  PrinterUsageMode,
} from '../print.constants';

/**
 * One physical printer — plan §2.7. `deviceId` (nullable, no FK — see the
 * migration's top comment) links a printer physically attached to a kiosk;
 * a centralized-office printer has none. `agentTokenHash` mirrors
 * `Device.deviceSecretHash`'s "hashed, select:false, shown once" pattern
 * (see `PrinterController.issueToken`) — DIRECT mode's actual print agent
 * is out of scope this pass (D-Q8), so this column exists for the API
 * shape to be ready, not because anything consumes it yet.
 */
@Entity('printers')
export class Printer extends BaseEntity {
  @Column('varchar', { length: 255 })
  @ApiProperty({ description: 'Tên máy in' })
  name: string;

  @Column('varchar', { length: 255, nullable: true })
  @ApiPropertyOptional({ description: 'Model máy in' })
  model?: string | null;

  @Column('varchar', { length: 12, name: 'print_mode', default: 'SINGLE_SIDE' })
  @ApiProperty({ description: 'SINGLE_SIDE | DUPLEX' })
  printMode: PrinterPrintMode;

  @Column('varchar', { length: 12, name: 'usage_mode', default: 'CENTRALIZED' })
  @ApiProperty({ description: 'DIRECT | CENTRALIZED' })
  usageMode: PrinterUsageMode;

  @Column('varchar', { length: 255, nullable: true })
  @ApiPropertyOptional({ description: 'Vị trí đặt máy (text tự do, D-Q7)' })
  location?: string | null;

  /** Kiosk this printer is physically attached to, if any — `devices` (device-management), no FK, see migration comment. */
  @Column('uuid', { name: 'device_id', nullable: true })
  @ApiPropertyOptional({
    description: 'Thiết bị (kiosk) gắn máy in này, nếu có',
  })
  deviceId?: string | null;

  @Column('jsonb', { nullable: true })
  @ApiPropertyOptional({
    description:
      'Thông tin kết nối {type: USB|NETWORK|AGENT, address, spoolerName}',
  })
  connection?: PrinterConnection | null;

  @Column('varchar', { length: 10, default: 'OFFLINE' })
  @Index()
  @ApiProperty({ description: 'ONLINE | OFFLINE | ERROR | DISABLED' })
  status: PrinterStatus;

  @Column('timestamptz', { name: 'last_seen_at', nullable: true })
  @ApiPropertyOptional({ description: 'Lần agent báo về gần nhất (heartbeat)' })
  lastSeenAt?: Date | null;

  @Column('text', { name: 'last_error', nullable: true })
  @ApiPropertyOptional({ description: 'Lỗi gần nhất agent báo về' })
  lastError?: string | null;

  @Column('int', { name: 'blank_stock', default: 0 })
  @ApiProperty({ description: 'Số phôi còn lại' })
  blankStock: number;

  @Column('timestamptz', { name: 'blank_stock_updated_at', nullable: true })
  @ApiPropertyOptional({ description: 'Lần cập nhật phôi gần nhất' })
  blankStockUpdatedAt?: Date | null;

  @Column('int', { name: 'low_stock_threshold', default: 0 })
  @ApiProperty({ description: 'Ngưỡng cảnh báo sắp hết phôi' })
  lowStockThreshold: number;

  /** card_templates (card-template module), no FK — see migration comment. Used as the default when a batch/item doesn't set its own. */
  @Column('uuid', { name: 'default_template_id', nullable: true })
  @ApiPropertyOptional({ description: 'Phôi in mặc định cho máy này' })
  defaultTemplateId?: string | null;

  /**
   * SHA-256 of the agent token, never the plaintext — same reasoning as
   * `Device.deviceSecretHash`. `select: false` so a plain `find()`/list
   * query never accidentally leaks it; `PrinterAgentGuard` reads it via an
   * explicit `.addSelect()` (see that guard's own doc comment for why a
   * hash-indexed lookup, not a per-row `timingSafeEqual`, is this column's
   * verification strategy).
   */
  @Column('varchar', {
    length: 64,
    name: 'agent_token_hash',
    nullable: true,
    select: false,
  })
  agentTokenHash?: string | null;
}
