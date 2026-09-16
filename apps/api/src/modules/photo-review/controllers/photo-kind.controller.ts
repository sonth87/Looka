import { SsoAuthGuard } from '@app/shared/auth/index';
import { Pagination } from '@app/shared/http/pagination';
import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { PhotoKindDao } from '../dao';
import {
  CreatePhotoKindDto,
  ListPhotoKindsQueryDto,
  UpdatePhotoKindDto,
} from '../dto';
import { PhotoKindService } from '../services/photo-kind.service';

/**
 * Configuration for "loại ảnh" (plan §5.6/yêu cầu 7) — ADMIN only, per plan
 * §7's table. Checked inline (`req.user?.isAdmin`) on every handler rather
 * than a dedicated guard class, per the task brief's own suggestion for
 * these three routes ("just check req.user?.isAdmin inline for these three
 * routes since they're config, not review actions").
 */
@Controller({ path: 'photo-kinds', version: '1' })
@ApiTags('photo-review')
@UseGuards(SsoAuthGuard)
@ApiBearerAuth('sso')
export class PhotoKindController {
  constructor(private readonly photoKindService: PhotoKindService) {}

  private assertAdmin(req: Request): void {
    if (!req.user?.isAdmin) {
      throw new ForbiddenException('Requires admin');
    }
  }

  /**
   * Same §9.1 backward-compat rule 6 as `CampaignController.listCampaigns`
   * — plain array (legacy) when `page` is omitted (e.g. a picker needing
   * every kind at once), paginated+searchable `{items, meta}` once a caller
   * opts in by passing `page` (`PhotoKindsPage.tsx`'s own management list).
   */
  @Get()
  @ApiOperation({
    summary:
      'List photo kinds (config, not a review action) — plain array if `page` is omitted (legacy), paginated+searchable otherwise — ADMIN only',
  })
  async list(
    @Query() query: ListPhotoKindsQueryDto,
    @Req() req: Request,
  ): Promise<PhotoKindDao[] | Pagination<PhotoKindDao>> {
    this.assertAdmin(req);
    if (query.page === undefined) {
      return this.photoKindService.listKinds();
    }
    return this.photoKindService.listKindsPaginated(query);
  }

  @Post()
  @ApiOperation({ summary: 'Create a photo kind — ADMIN only' })
  async create(
    @Body() dto: CreatePhotoKindDto,
    @Req() req: Request,
  ): Promise<PhotoKindDao> {
    this.assertAdmin(req);
    return this.photoKindService.createKind(dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a photo kind — ADMIN only' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdatePhotoKindDto,
    @Req() req: Request,
  ): Promise<PhotoKindDao> {
    this.assertAdmin(req);
    return this.photoKindService.updateKind(id, dto);
  }
}
