import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { ASSET_KINDS } from '../card-template.constants';

/** Multipart form field alongside `file` on `POST /v1/card-templates/:id/assets`. */
export class UploadCardTemplateAssetDto {
  @ApiProperty({ enum: ASSET_KINDS })
  @IsIn(ASSET_KINDS)
  kind: 'LOGO' | 'BACKGROUND' | 'FONT';
}
