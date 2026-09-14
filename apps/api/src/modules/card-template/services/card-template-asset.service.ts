import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { Repository } from 'typeorm';
import sharp from 'sharp';
import { FileStorageService } from '@app/modules/file-storage/services/file-storage.service';
import {
  ASSET_MIME_TYPES,
  MAX_ASSET_BYTES,
  type CardTemplateAssetKind,
} from '../card-template.constants';
import { CardTemplateAssetDao } from '../dao';
import { CardTemplateAsset } from '../entities/card-template-asset.entity';
import { CardTemplateService } from './card-template.service';

interface UploadedMulterFile {
  buffer: Buffer;
  mimetype: string;
  size: number;
  originalname: string;
}

/** Asset upload/delete for a template's LOGO/BACKGROUND/FONT files (plan §2.6). Uploaded synchronously via `FileStorageService.uploadRaw` — same reasoning as the avatar/roster uploads already in this codebase (a small, interactive CMS action a person is waiting on). */
@Injectable()
export class CardTemplateAssetService {
  constructor(
    @InjectRepository(CardTemplateAsset)
    private readonly assets: Repository<CardTemplateAsset>,
    private readonly fileStorage: FileStorageService,
    private readonly templateService: CardTemplateService,
  ) {}

  async upload(
    templateId: string,
    kind: CardTemplateAssetKind,
    file: UploadedMulterFile,
  ): Promise<CardTemplateAssetDao> {
    const template = await this.templateService.loadTemplateOrFail(templateId);
    if (template.status === 'ARCHIVED') {
      throw new ConflictException('Phôi đã lưu trữ, không thể thêm asset');
    }
    if (!file || file.size === 0) {
      throw new BadRequestException('Thiếu file');
    }
    if (file.size > MAX_ASSET_BYTES) {
      throw new BadRequestException('File vượt quá 5MB');
    }
    const allowed = ASSET_MIME_TYPES[kind];
    if (!allowed.includes(file.mimetype)) {
      throw new BadRequestException(
        `Loại file không hợp lệ cho ${kind}: ${file.mimetype}`,
      );
    }

    let width: number | null = null;
    let height: number | null = null;
    if (file.mimetype.startsWith('image/')) {
      try {
        const metadata = await sharp(file.buffer).metadata();
        width = metadata.width ?? null;
        height = metadata.height ?? null;
      } catch {
        // Not fatal — SVG logos in particular can fail sharp's metadata probe
        // in some builds; the asset is still stored, just without pixel
        // dimensions recorded.
      }
    }

    const result = await this.fileStorage.uploadRaw({
      virtualPath: `card-templates/${templateId}/${kind.toLowerCase()}/${randomUUID()}-${file.originalname}`,
      mimeType: file.mimetype,
      data: new Uint8Array(file.buffer),
      idempotencyKey: this.templateService.generateAssetIdempotencyKey(),
    });

    const asset = this.assets.create({
      templateId,
      kind,
      fsFileId: result.fileId,
      fileName: file.originalname,
      mimeType: file.mimetype,
      width,
      height,
    });
    const saved = await this.assets.save(asset);
    return CardTemplateAssetDao.from(saved);
  }

  async delete(templateId: string, assetId: string): Promise<void> {
    const asset = await this.assets.findOne({
      where: { id: assetId, templateId },
    });
    if (!asset) {
      throw new NotFoundException('Không tìm thấy asset');
    }
    await this.fileStorage.deleteFile(asset.fsFileId).catch(() => undefined);
    await this.assets.remove(asset);
  }
}
