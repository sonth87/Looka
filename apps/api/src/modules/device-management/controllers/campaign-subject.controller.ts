import {
  ApiResponseArrayDecorator,
  ApiResponseDecorator,
  ApiResponsePaginatedDecorator,
} from '@app/shared/http/api-response.decorator';
import { SsoAuthGuard } from '@app/shared/auth/index';
import { PermissionsGuard } from '@app/modules/identity/presentation/guards/permissions.guard';
import { RequirePermission } from '@app/modules/identity/presentation/guards/require-permission.decorator';
import {
  Controller,
  Delete,
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
import {
  ApiBearerAuth,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { CampaignSubjectDao, CampaignSubjectImportDao } from '../dao';
import { ListCampaignSubjectsQueryDto } from '../dto/list-campaign-subjects-query.dto';
import { CampaignSubjectService } from '../services/campaign-subject.service';

const MAX_ROSTER_BYTES = 10 * 1024 * 1024;

/** Same reasoning as `review.controller.ts`'s own `UploadedMulterFile` — no `@types/multer` installed. */
interface UploadedMulterFile {
  buffer: Buffer;
  mimetype: string;
  size: number;
  originalname: string;
}

/**
 * Roster import (D-Q3) — CMS/admin surface, `campaign:write`. Kiosk lookup
 * lives in a separate controller (`CampaignSubjectLookupController`,
 * `DeviceCredentialsGuard`) — same "different caller, different guard,
 * separate class" convention `DeviceController`/`DeviceSelfController`
 * already use.
 */
@Controller({ path: 'campaigns', version: '1' })
@ApiTags('device-management')
@UseGuards(SsoAuthGuard, PermissionsGuard)
@RequirePermission('campaign:write', 'Quản lý danh sách sinh viên đợt chụp')
@ApiBearerAuth('sso')
export class CampaignSubjectController {
  constructor(private readonly subjectService: CampaignSubjectService) {}

  @Post(':id/subjects/imports')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_ROSTER_BYTES } }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Import roster từ file Excel — trường multipart tên "file"',
  })
  @ApiResponseDecorator(CampaignSubjectImportDao, { status: 201 })
  importRoster(
    @Param('id') campaignId: string,
    @UploadedFile() file: UploadedMulterFile,
    @Req() req: Request,
  ): Promise<CampaignSubjectImportDao> {
    return this.subjectService.importRoster(
      campaignId,
      file,
      req.user?.id ?? null,
    );
  }

  @Get(':id/subjects/imports')
  @ApiOperation({ summary: 'List every roster import for a campaign' })
  @ApiResponseArrayDecorator(CampaignSubjectImportDao)
  listImports(
    @Param('id') campaignId: string,
  ): Promise<CampaignSubjectImportDao[]> {
    return this.subjectService.listImports(campaignId);
  }

  @Get(':id/subjects/imports/:importId')
  @ApiOperation({
    summary: 'Get one roster import — totals + error report link',
  })
  @ApiResponseDecorator(CampaignSubjectImportDao)
  getImport(
    @Param('id') campaignId: string,
    @Param('importId') importId: string,
  ): Promise<CampaignSubjectImportDao> {
    return this.subjectService.getImport(campaignId, importId);
  }

  @Delete(':id/subjects/imports/:importId')
  @ApiOperation({
    summary:
      'Delete a roster import — refused if any session already matched a subject from it',
  })
  async deleteImport(
    @Param('id') campaignId: string,
    @Param('importId') importId: string,
  ): Promise<{ id: string }> {
    await this.subjectService.deleteImport(campaignId, importId);
    return { id: importId };
  }

  @Get(':id/subjects')
  @ApiOperation({ summary: 'List a campaign’s roster rows, paginated' })
  @ApiResponsePaginatedDecorator(CampaignSubjectDao)
  listSubjects(
    @Param('id') campaignId: string,
    @Query() query: ListCampaignSubjectsQueryDto,
  ) {
    return this.subjectService.listSubjects(campaignId, query);
  }

  /**
   * Declared with a literal `subjects` second segment, not `:id` — no
   * collision with `GET campaigns/:id` (`CampaignController`, 2 segments)
   * or `GET campaigns/:id/subjects` (3 segments, but this route's own 3rd
   * segment is the literal `import-template`, not `subjects`) — see
   * `CampaignController`'s own doc comment for the route-shadowing history
   * this codebase is deliberately careful about.
   */
  @Get('subjects/import-template')
  @Header(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  )
  @ApiOperation({ summary: 'Download the roster Excel template' })
  async downloadTemplate(): Promise<StreamableFile> {
    const buffer = await this.subjectService.buildTemplate();
    return new StreamableFile(buffer, {
      disposition: 'attachment; filename="roster-template.xlsx"',
    });
  }
}
