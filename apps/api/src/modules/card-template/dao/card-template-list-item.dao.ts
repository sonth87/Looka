import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { CardTemplate } from '../entities/card-template.entity';

class CardSizeDao {
  @ApiProperty() widthMm: number;
  @ApiProperty() heightMm: number;
}

/**
 * `GET /v1/card-templates` row. `usageCount` — `COUNT(print_items.template_id)`
 * per plan §2.6, `NOT IN ('CANCELLED', 'FAILED')` so an abandoned/failed
 * item never counts as "in use" — now real as of P6
 * (`CardTemplateService.usageCountsFor`, raw SQL against `print_items`,
 * module-boundary convention). Callers MUST pass the real count in; this
 * class does not compute it itself so `list()` can batch one query for
 * every row on a page instead of N.
 */
export class CardTemplateListItemDao {
  @ApiProperty() id: string;
  @ApiProperty() code: string;
  @ApiProperty() name: string;
  @ApiPropertyOptional() description?: string | null;
  @ApiProperty() status: string;
  @ApiProperty() version: number;
  @ApiProperty({ type: CardSizeDao }) cardSize: CardSizeDao;
  @ApiProperty() dpi: number;
  @ApiProperty() usageCount: number;
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;

  static from(template: CardTemplate, usageCount = 0): CardTemplateListItemDao {
    const dao = new CardTemplateListItemDao();
    dao.id = template.id;
    dao.code = template.code;
    dao.name = template.name;
    dao.description = template.description ?? null;
    dao.status = template.status;
    dao.version = template.version;
    dao.cardSize = {
      widthMm: template.cardWidthMm,
      heightMm: template.cardHeightMm,
    };
    dao.dpi = template.dpi;
    dao.usageCount = usageCount;
    dao.createdAt = template.createdAt;
    dao.updatedAt = template.updatedAt;
    return dao;
  }
}
