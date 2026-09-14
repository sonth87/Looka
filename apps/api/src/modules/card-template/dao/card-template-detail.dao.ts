import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { CardTemplate } from '../entities/card-template.entity';
import type { CardTemplateAsset } from '../entities/card-template-asset.entity';
import type { CardTemplateSide } from '../schema/card-template-layout.schema';
import { CardTemplateAssetDao } from './card-template-asset.dao';
import { CardTemplateListItemDao } from './card-template-list-item.dao';

export class CardTemplateDetailDao extends CardTemplateListItemDao {
  @ApiProperty() front: CardTemplateSide;
  @ApiProperty() back: CardTemplateSide;
  @ApiPropertyOptional() createdByUserId?: string | null;
  @ApiPropertyOptional() publishedAt?: Date | null;
  @ApiPropertyOptional() archivedAt?: Date | null;
  @ApiProperty({ type: [CardTemplateAssetDao] }) assets: CardTemplateAssetDao[];

  static fromDetail(
    template: CardTemplate,
    assets: CardTemplateAsset[],
    usageCount = 0,
  ): CardTemplateDetailDao {
    const base = CardTemplateListItemDao.from(template, usageCount);
    const dao = Object.assign(new CardTemplateDetailDao(), base);
    dao.front = template.front;
    dao.back = template.back;
    dao.createdByUserId = template.createdByUserId ?? null;
    dao.publishedAt = template.publishedAt ?? null;
    dao.archivedAt = template.archivedAt ?? null;
    dao.assets = assets.map((asset) => CardTemplateAssetDao.from(asset));
    return dao;
  }
}
