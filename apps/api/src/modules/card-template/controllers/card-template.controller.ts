import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { SsoAuthGuard } from '@app/shared/auth/index';
import {
  ApiResponseArrayDecorator,
  ApiResponseDecorator,
  ApiResponsePaginatedDecorator,
} from '@app/shared/http/api-response.decorator';
import { Pagination } from '@app/shared/http/pagination';
import { PermissionsGuard } from '@app/modules/identity/presentation/guards/permissions.guard';
import { RequirePermission } from '@app/modules/identity/presentation/guards/require-permission.decorator';
import {
  CARD_TEMPLATE_FIELDS,
  MAX_ASSET_BYTES,
} from '../card-template.constants';
import {
  CardTemplateAssetDao,
  CardTemplateDetailDao,
  CardTemplateFieldDao,
  CardTemplateListItemDao,
} from '../dao';
import {
  CreateCardTemplateDto,
  ListCardTemplatesQueryDto,
  PreviewCardTemplateDto,
  UpdateCardTemplateDto,
  UploadCardTemplateAssetDto,
} from '../dto';
import { CardTemplateAssetService } from '../services/card-template-asset.service';
import { CardTemplateRenderService } from '../services/card-template-render.service';
import { CardTemplateService } from '../services/card-template.service';

/**
 * Multer's own runtime shape — same "no `@types/multer` installed" reasoning
 * `user.command.controller.ts`/`review.controller.ts` already document.
 */
interface UploadedMulterFile {
  buffer: Buffer;
  mimetype: string;
  size: number;
  originalname: string;
}

@Controller({ path: 'card-templates', version: '1' })
@ApiTags('card-template')
@UseGuards(SsoAuthGuard, PermissionsGuard)
export class CardTemplateController {
  constructor(
    private readonly templateService: CardTemplateService,
    private readonly assetService: CardTemplateAssetService,
    private readonly renderService: CardTemplateRenderService,
  ) {}

  @Get()
  @RequirePermission('card-template:read', 'Xem danh sách phôi in')
  @ApiOperation({ summary: 'Danh sách phôi in, kèm usageCount (plan §2.6)' })
  @ApiResponsePaginatedDecorator(CardTemplateListItemDao)
  list(
    @Query() query: ListCardTemplatesQueryDto,
  ): Promise<Pagination<CardTemplateListItemDao>> {
    return this.templateService.list(query);
  }

  // Declared BEFORE `:id` so the literal segment `fields` never gets
  // swallowed by the `:id` param route — same route-ordering rule
  // `review.controller.ts`'s own `stats` vs `sets/:id` split relies on.
  @Get('fields')
  @RequirePermission('card-template:read', 'Xem catalog biến dữ liệu phôi')
  @ApiOperation({
    summary: 'Catalog biến dữ liệu (field) có thể dùng trong layout',
  })
  @ApiResponseArrayDecorator(CardTemplateFieldDao)
  fields(): CardTemplateFieldDao[] {
    return CARD_TEMPLATE_FIELDS.map((f) => {
      const dao = new CardTemplateFieldDao();
      dao.field = f.field;
      dao.label = f.label;
      dao.type = f.type;
      return dao;
    });
  }

  @Post()
  @RequirePermission('card-template:write', 'Tạo phôi in')
  @ApiOperation({ summary: 'Tạo phôi in mới (DRAFT)' })
  @ApiResponseDecorator(CardTemplateDetailDao)
  create(
    @Body() dto: CreateCardTemplateDto,
    @Req() req: Request,
  ): Promise<CardTemplateDetailDao> {
    return this.templateService.create(dto, req.user?.id ?? null);
  }

  @Get(':id')
  @RequirePermission('card-template:read', 'Xem chi tiết phôi in')
  @ApiOperation({ summary: 'Chi tiết 1 phôi in, kèm assets' })
  @ApiResponseDecorator(CardTemplateDetailDao)
  getDetail(@Param('id') id: string): Promise<CardTemplateDetailDao> {
    return this.templateService.getDetail(id);
  }

  @Patch(':id')
  @RequirePermission('card-template:write', 'Sửa phôi in')
  @ApiOperation({
    summary: 'Sửa phôi in — ACTIVE và đã dùng thì tự tăng version (plan §2.6)',
  })
  @ApiResponseDecorator(CardTemplateDetailDao)
  patch(
    @Param('id') id: string,
    @Body() dto: UpdateCardTemplateDto,
  ): Promise<CardTemplateDetailDao> {
    return this.templateService.patch(id, dto);
  }

  @Delete(':id')
  @RequirePermission('card-template:delete', 'Xóa phôi in')
  @ApiOperation({ summary: 'Xóa phôi in — chỉ DRAFT, chưa dùng để in' })
  async delete(@Param('id') id: string): Promise<{ deleted: true }> {
    await this.templateService.delete(id);
    return { deleted: true };
  }

  @Post(':id/duplicate')
  @RequirePermission('card-template:write', 'Nhân bản phôi in')
  @ApiOperation({ summary: 'Nhân bản phôi in thành 1 bản DRAFT mới' })
  @ApiResponseDecorator(CardTemplateDetailDao)
  duplicate(@Param('id') id: string): Promise<CardTemplateDetailDao> {
    return this.templateService.duplicate(id);
  }

  @Post(':id/publish')
  @RequirePermission('card-template:write', 'Publish phôi in')
  @ApiOperation({ summary: 'Publish phôi in (DRAFT → ACTIVE)' })
  @ApiResponseDecorator(CardTemplateDetailDao)
  publish(@Param('id') id: string): Promise<CardTemplateDetailDao> {
    return this.templateService.publish(id);
  }

  @Post(':id/archive')
  @RequirePermission('card-template:write', 'Lưu trữ phôi in')
  @ApiOperation({ summary: 'Lưu trữ phôi in' })
  @ApiResponseDecorator(CardTemplateDetailDao)
  archive(@Param('id') id: string): Promise<CardTemplateDetailDao> {
    return this.templateService.archive(id);
  }

  @Post(':id/assets')
  @RequirePermission(
    'card-template:write',
    'Thêm asset (logo/nền/font) cho phôi in',
  )
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_ASSET_BYTES } }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Tải logo/ảnh nền/font — trường multipart "file" + "kind"',
  })
  @ApiResponseDecorator(CardTemplateAssetDao)
  uploadAsset(
    @Param('id') id: string,
    @Body() dto: UploadCardTemplateAssetDto,
    @UploadedFile() file: UploadedMulterFile,
  ): Promise<CardTemplateAssetDao> {
    return this.assetService.upload(id, dto.kind, file);
  }

  @Delete(':id/assets/:assetId')
  @RequirePermission('card-template:write', 'Xóa asset của phôi in')
  @ApiOperation({ summary: 'Xóa 1 asset của phôi in' })
  async deleteAsset(
    @Param('id') id: string,
    @Param('assetId') assetId: string,
  ): Promise<{ deleted: true }> {
    await this.assetService.delete(id, assetId);
    return { deleted: true };
  }

  @Post(':id/preview')
  @RequirePermission('card-template:read', 'Xem thử phôi in')
  @ApiOperation({
    summary: 'Render PNG xem thử — {setId | sampleData, side} (plan §2.6)',
  })
  async preview(
    @Param('id') id: string,
    @Body() dto: PreviewCardTemplateDto,
    @Res() res: Response,
  ): Promise<void> {
    if (!dto.setId && !dto.sampleData) {
      throw new BadRequestException('Cần truyền setId hoặc sampleData');
    }
    const template = await this.templateService.loadTemplateOrFail(id);
    const png = await this.renderService.render(template, dto.side ?? 'front', {
      setId: dto.setId,
      sampleData: dto.sampleData,
    });
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'no-store');
    res.send(png);
  }
}
