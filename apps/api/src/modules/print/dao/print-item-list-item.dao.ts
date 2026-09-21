import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { PrintItem } from '../entities/print-item.entity';

/**
 * Fields a person's record needs for the render/print pipeline but this
 * table has no dedicated column for — never guessed, computed at read time
 * from `full_name`/`class_name`/`faculty` being `null`, so it can never
 * drift from the columns it describes (see the entity's own doc comment).
 */
function computeMissingFields(item: PrintItem): string[] {
  const missing: string[] = [];
  if (!item.fullName) missing.push('fullName');
  if (!item.className) missing.push('className');
  if (!item.faculty) missing.push('faculty');
  if (!item.variantId) missing.push('cardPhoto');
  return missing;
}

export class PrintItemListItemDao {
  @ApiProperty() id: string;
  @ApiPropertyOptional() batchId?: string | null;
  @ApiProperty() campaignId: string;
  @ApiProperty() setId: string;
  @ApiPropertyOptional() variantId?: string | null;
  @ApiProperty() subjectCode: string;
  @ApiPropertyOptional() fullName?: string | null;
  @ApiPropertyOptional() className?: string | null;
  @ApiPropertyOptional() faculty?: string | null;
  @ApiPropertyOptional() templateId?: string | null;
  @ApiProperty() status: string;
  @ApiPropertyOptional() printerId?: string | null;
  @ApiPropertyOptional() printedAt?: Date | null;
  @ApiPropertyOptional() renderedAt?: Date | null;
  @ApiPropertyOptional() exportedAt?: Date | null;
  @ApiPropertyOptional() errorMessage?: string | null;
  @ApiPropertyOptional() reprintOfItemId?: string | null;
  @ApiProperty({
    type: [String],
    description: 'Trường còn thiếu — CMS cần sửa tay',
  })
  missingFields: string[];
  @ApiPropertyOptional({
    description:
      'Người chụp (operator SSO) — resolved qua setId → subject_photo_sets.source_session_id → sessions.operator_user_id → users, null nếu chưa có',
  })
  operatorName?: string | null;
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;

  static from(
    item: PrintItem,
    operatorName?: string | null,
  ): PrintItemListItemDao {
    const dao = new PrintItemListItemDao();
    dao.id = item.id;
    dao.batchId = item.batchId ?? null;
    dao.campaignId = item.campaignId;
    dao.setId = item.setId;
    dao.variantId = item.variantId ?? null;
    dao.subjectCode = item.subjectCode;
    dao.fullName = item.fullName ?? null;
    dao.className = item.className ?? null;
    dao.faculty = item.faculty ?? null;
    dao.templateId = item.templateId ?? null;
    dao.status = item.status;
    dao.printerId = item.printerId ?? null;
    dao.printedAt = item.printedAt ?? null;
    dao.renderedAt = item.renderedAt ?? null;
    dao.exportedAt = item.exportedAt ?? null;
    dao.errorMessage = item.errorMessage ?? null;
    dao.reprintOfItemId = item.reprintOfItemId ?? null;
    dao.missingFields = computeMissingFields(item);
    dao.operatorName = operatorName ?? null;
    dao.createdAt = item.createdAt;
    dao.updatedAt = item.updatedAt;
    return dao;
  }
}

export { computeMissingFields };
