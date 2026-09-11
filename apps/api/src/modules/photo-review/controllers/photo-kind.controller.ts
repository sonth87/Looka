import { SsoAuthGuard } from '@app/shared/auth/index';
import { Body, Controller, ForbiddenException, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { PhotoKindDao } from '../dao';
import { CreatePhotoKindDto, UpdatePhotoKindDto } from '../dto';
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

  @Get()
  @ApiOperation({ summary: 'List photo kinds (config, not a review action) — ADMIN only' })
  async list(@Req() req: Request): Promise<PhotoKindDao[]> {
    this.assertAdmin(req);
    return this.photoKindService.listKinds();
  }

  @Post()
  @ApiOperation({ summary: 'Create a photo kind — ADMIN only' })
  async create(@Body() dto: CreatePhotoKindDto, @Req() req: Request): Promise<PhotoKindDao> {
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
