import { BaseEntity } from '@app/shared/database/base.entity';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import type { PrintItemEventSource } from '../print.constants';
import { PrintItem } from './print-item.entity';

/**
 * Audit trail for every `print_items.status` transition — plan §2.5,
 * mirrors `photo_review_events`'s "no exceptions" convention. `source`
 * distinguishes an app-driven transition (`SYSTEM` — e.g. render success →
 * RENDERED), a print-agent callback (`PRINT_AGENT` — the only source
 * allowed to report PRINTING/FAILED from the field), and a human action in
 * the CMS (`MANUAL` — the only other source allowed to set PRINTED, per BA
 * decision #14: "đã in" must be a confirmed physical print, never
 * inferred).
 */
@Entity('print_item_events')
export class PrintItemEvent extends BaseEntity {
  @Column('uuid', { name: 'item_id' })
  @Index()
  @ApiProperty({ description: 'Item liên quan' })
  itemId: string;

  @ManyToOne(() => PrintItem, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'item_id' })
  item?: PrintItem;

  @Column('varchar', { length: 20, name: 'from_status', nullable: true })
  @ApiPropertyOptional({ description: 'Trạng thái trước' })
  fromStatus?: string | null;

  @Column('varchar', { length: 20, name: 'to_status' })
  @ApiProperty({ description: 'Trạng thái sau' })
  toStatus: string;

  @Column('varchar', { length: 16 })
  @ApiProperty({ description: 'SYSTEM | PRINT_AGENT | MANUAL | RESULT_UPLOAD' })
  source: PrintItemEventSource;

  @Column('uuid', { name: 'actor_user_id', nullable: true })
  @ApiPropertyOptional({
    description: 'Người thực hiện, null nếu hệ thống/agent',
  })
  actorUserId?: string | null;

  @Column('text', { nullable: true })
  @ApiPropertyOptional({ description: 'Ghi chú/lý do' })
  message?: string | null;

  @Column('timestamptz', { default: () => 'now()' })
  @ApiProperty({ description: 'Thời điểm' })
  at: Date;
}
