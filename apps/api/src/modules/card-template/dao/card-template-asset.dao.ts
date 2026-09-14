import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { CardTemplateAsset } from '../entities/card-template-asset.entity';

export class CardTemplateAssetDao {
  @ApiProperty() id: string;
  @ApiProperty() kind: string;
  @ApiProperty() fsFileId: string;
  @ApiProperty() fileName: string;
  @ApiProperty() mimeType: string;
  @ApiPropertyOptional() width?: number | null;
  @ApiPropertyOptional() height?: number | null;
  @ApiProperty() createdAt: Date;

  static from(asset: CardTemplateAsset): CardTemplateAssetDao {
    const dao = new CardTemplateAssetDao();
    dao.id = asset.id;
    dao.kind = asset.kind;
    dao.fsFileId = asset.fsFileId;
    dao.fileName = asset.fileName;
    dao.mimeType = asset.mimeType;
    dao.width = asset.width ?? null;
    dao.height = asset.height ?? null;
    dao.createdAt = asset.createdAt;
    return dao;
  }
}
