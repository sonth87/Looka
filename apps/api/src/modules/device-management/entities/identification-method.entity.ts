import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Column, Entity } from 'typeorm';
import { BaseEntity } from '../../../shared/database/base.entity';

/**
 * DB catalog for `sessions.identification_method` — cms-8-screens-api-plan.md
 * §2.2/E1 ("phương thức định danh... mới, thay cho CHECK enum"). Seeded with
 * 7 rows by the migration (QR_CCCD, RFID, NFC, BARCODE, FACE_ID,
 * MANUAL_LOOKUP, OCR_CCCD — the last one added per §9.2's kiosk-impact
 * review: the desktop kiosk today OCRs the front of the CCCD, it does not
 * scan a QR code). Read-only from the API this pass (`GET
 * /v1/identification-methods` only) — no CMS write flow was asked for in
 * P3's scope; a table instead of an enum still means a future write route
 * needs no migration to add one.
 */
@Entity('identification_methods')
export class IdentificationMethod extends BaseEntity {
  @Column('varchar', { length: 30, unique: true })
  @ApiProperty({ description: 'Mã phương thức, ví dụ QR_CCCD' })
  code: string;

  @Column('varchar', { length: 255, name: 'name_vi' })
  @ApiProperty({ description: 'Tên hiển thị' })
  nameVi: string;

  @Column('text', { nullable: true })
  @ApiPropertyOptional({ description: 'Mô tả' })
  description?: string | null;

  @Column('boolean', { default: false, name: 'requires_hardware' })
  @ApiProperty({
    description: 'Có cần phần cứng riêng không (đầu đọc, camera…)',
  })
  requiresHardware: boolean;

  @Column('boolean', { default: true })
  @ApiProperty({ description: 'Còn hiển thị để chọn không' })
  active: boolean;

  @Column('int', { default: 0, name: 'sort_order' })
  @ApiProperty({ description: 'Thứ tự hiển thị' })
  sortOrder: number;
}
