import { SsoAuthGuard } from '@app/shared/auth/index';
import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Header,
  Param,
  Post,
  Query,
  Req,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import {
  PhotoVariantDao,
  ReviewEventDao,
  ReviewSetDetailDao,
  ReviewSetListItemDao,
  UploadVariantResultDao,
} from '../dao';
import {
  AiEditDto,
  ApproveRejectDto,
  ExportQueryDto,
  ListEventsQueryDto,
  ListSetsQueryDto,
  SetCurrentDto,
} from '../dto';
import { ReviewerRoleGuard } from '../guards/reviewer-role.guard';
import { MAX_UPLOAD_BYTES, PhotoReviewSetStatus } from '../photo-review.constants';
import { PhotoReviewService } from '../services/photo-review.service';
import { Pagination } from '@app/shared/http/pagination';

/**
 * Multer's own runtime shape for `@UploadedFile()` — declared locally
 * rather than typed as `Express.Multer.File` because this app has no
 * `@types/multer` installed (multer 2.2.0, bundled transitively through
 * `@nestjs/platform-express`, ships no `.d.ts` of its own either) and this
 * task is scoped to not touch `package.json`. `FileInterceptor` itself
 * (from `@nestjs/platform-express`) does not require multer's types to
 * compile, only this parameter annotation does.
 */
interface UploadedMulterFile {
  buffer: Buffer;
  mimetype: string;
  size: number;
  originalname: string;
}

/**
 * `GET /v1/review/sets*`, `/jobs/:id`, `/variants/:id/*`, `/export` — plan
 * §7's API table. Every route is `SsoAuthGuard` + `ReviewerRoleGuard`
 * except `export`, which additionally requires `req.user.isAdmin` (checked
 * inline in that one handler, per the task brief's own suggestion, rather
 * than a second dedicated guard for a single route).
 */
@Controller({ path: 'review', version: '1' })
@ApiTags('photo-review')
@UseGuards(SsoAuthGuard, ReviewerRoleGuard)
@ApiBearerAuth('sso')
export class ReviewController {
  constructor(private readonly photoReviewService: PhotoReviewService) {}

  /**
   * The origin the calling browser actually used to reach THIS request —
   * not a configured public URL — so a local-content link this request
   * hands back (`PhotoReviewService.issueLocalVariantViewLink`, via
   * `toVariantDao`/`resolveCurrentCardViewUrl`) resolves correctly however
   * the CMS reached this API. Same helper/reasoning as
   * `PhotoController.viewLink`'s own inline computation.
   */
  private apiBaseUrl(req: Request): string {
    return `${req.protocol}://${req.get('host')}`;
  }

  @Get('sets')
  @ApiOperation({ summary: 'List photo-review sets, filterable and paginated (plan §5.1)' })
  listSets(@Query() query: ListSetsQueryDto, @Req() req: Request): Promise<Pagination<ReviewSetListItemDao>> {
    return this.photoReviewService.listSets(query, this.apiBaseUrl(req));
  }

  @Get('sets/:id')
  @ApiOperation({ summary: 'Get one set — original photos, video, variants, recent events (plan §5.2)' })
  getSetDetail(@Param('id') id: string, @Req() req: Request): Promise<ReviewSetDetailDao> {
    return this.photoReviewService.getSetDetail(id, this.apiBaseUrl(req));
  }

  @Post('sets/:id/reprocess')
  @ApiOperation({ summary: 'Regenerate the CARD_AUTO variant — allowed even while the set is locked (plan §4/R-Q1)' })
  reprocess(@Param('id') id: string, @Req() req: Request): Promise<PhotoVariantDao> {
    return this.photoReviewService.reprocess(id, req.user?.id ?? null, this.apiBaseUrl(req));
  }

  @Post('sets/:id/ai-edit')
  @ApiOperation({ summary: 'Request an AI edit — 422 if the prompt hits the forbidden-keyword filter (plan §5.3/§6.3)' })
  aiEdit(@Param('id') id: string, @Body() dto: AiEditDto, @Req() req: Request): Promise<PhotoVariantDao> {
    return this.photoReviewService.aiEdit(id, dto, req.user?.id ?? null, this.apiBaseUrl(req));
  }

  /**
   * Simplification documented in `PhotoReviewService.getJob`'s own comment:
   * `:id` is a `photo_variants.id`, there is no separate job table in this
   * pass.
   */
  @Get('jobs/:id')
  @ApiOperation({ summary: 'Poll an AI-edit/reprocess job — :id is a photo_variants.id, see service doc comment' })
  getJob(@Param('id') id: string, @Req() req: Request): Promise<PhotoVariantDao> {
    return this.photoReviewService.getJob(id, this.apiBaseUrl(req));
  }

  @Post('variants/:id/accept')
  @ApiOperation({ summary: 'Accept a READY CARD_AI/CARD_UPLOAD variant as the current card photo' })
  acceptVariant(@Param('id') id: string, @Req() req: Request): Promise<PhotoVariantDao> {
    return this.photoReviewService.acceptVariant(id, req.user?.id ?? null, this.apiBaseUrl(req));
  }

  @Post('variants/:id/discard')
  @ApiOperation({ summary: 'Discard a variant (never allowed on the current variant)' })
  discardVariant(@Param('id') id: string, @Req() req: Request): Promise<PhotoVariantDao> {
    return this.photoReviewService.discardVariant(id, req.user?.id ?? null, this.apiBaseUrl(req));
  }

  @Post('sets/:id/upload')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  @ApiOperation({
    summary: 'Replace the card photo with an uploaded file — mandatory identity check against the original FRONT photo (plan §5.4/R-Q8)',
  })
  uploadVariant(
    @Param('id') id: string,
    @UploadedFile() file: UploadedMulterFile,
    @Req() req: Request,
  ): Promise<UploadVariantResultDao> {
    return this.photoReviewService.uploadVariant(id, file, req.user?.id ?? null, this.apiBaseUrl(req));
  }

  @Post('sets/:id/current')
  @ApiOperation({ summary: 'Switch which variant is the current card photo' })
  setCurrent(@Param('id') id: string, @Body() dto: SetCurrentDto, @Req() req: Request): Promise<ReviewSetListItemDao> {
    return this.photoReviewService.setCurrent(id, dto.variantId, req.user?.id ?? null, this.apiBaseUrl(req));
  }

  @Post('sets/:id/approve')
  @ApiOperation({ summary: 'Approve a set (plan §5.5)' })
  approve(@Param('id') id: string, @Body() dto: ApproveRejectDto, @Req() req: Request): Promise<ReviewSetListItemDao> {
    return this.photoReviewService.approve(id, dto, req.user?.id ?? null, this.apiBaseUrl(req));
  }

  @Post('sets/:id/reject')
  @ApiOperation({ summary: 'Reject a set, with a note (plan §5.5)' })
  reject(@Param('id') id: string, @Body() dto: ApproveRejectDto, @Req() req: Request): Promise<ReviewSetListItemDao> {
    return this.photoReviewService.reject(id, dto, req.user?.id ?? null, this.apiBaseUrl(req));
  }

  @Get('sets/:id/events')
  @ApiOperation({ summary: 'Audit log for a set, newest first, paginated' })
  listEvents(@Param('id') id: string, @Query() query: ListEventsQueryDto): Promise<Pagination<ReviewEventDao>> {
    return this.photoReviewService.listEvents(id, query);
  }

  /**
   * ADMIN only (plan §7's own table row) — checked inline rather than a
   * dedicated guard class for one route, per the task brief's suggestion
   * for the analogous `photo_kinds` routes.
   */
  @Get('export')
  @Header('Content-Type', 'application/zip')
  @ApiOperation({ summary: 'Export a zip of every APPROVED set\'s current card photo + manifest.csv (plan R-Q9). ADMIN only.' })
  async exportApproved(@Query() query: ExportQueryDto, @Req() req: Request): Promise<StreamableFile> {
    if (!req.user?.isAdmin) {
      throw new ForbiddenException('Requires admin');
    }
    const status = query.status ?? PhotoReviewSetStatus.APPROVED;
    const zip = await this.photoReviewService.exportApproved(query.campaignId, status);
    return new StreamableFile(zip, { disposition: `attachment; filename="photo-review-export-${query.campaignId}.zip"` });
  }
}
