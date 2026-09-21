import {
  ApiResponseArrayDecorator,
  ApiResponseDecorator,
  ApiResponsePaginatedDecorator,
} from '@app/shared/http/api-response.decorator';
import { SsoAuthGuard } from '@app/shared/auth/index';
import { PermissionsGuard } from '@app/modules/identity/presentation/guards/permissions.guard';
import { RequirePermission } from '@app/modules/identity/presentation/guards/require-permission.decorator';
import {
  Body,
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
import {
  CampaignSubjectDao,
  CampaignSubjectDistinctValuesDao,
  CampaignSubjectImportDao,
} from '../dao';
import { TestRosterLookupResultDao } from '../dao/test-roster-lookup-result.dao';
import { DistinctSubjectValuesQueryDto } from '../dto/distinct-subject-values-query.dto';
import { ListCampaignSubjectsQueryDto } from '../dto/list-campaign-subjects-query.dto';
import { RequestSubjectPullDto } from '../dto/request-subject-pull.dto';
import { TestRosterLookupDto } from '../dto/test-roster-lookup.dto';
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

  /**
   * `POST /v1/campaigns/:id/subjects/pulls` (plan §3.1, feature 1) — queues
   * a full pull of this campaign's own `eligibilityConfig.api` into the
   * durable 2-tier queue and returns the new `campaign_subject_imports`
   * row immediately at `PENDING_FETCH` (see
   * `CampaignSubjectService.requestPull`'s own doc comment). Poll it via
   * the existing `GET :id/subjects/imports/:importId` — no separate
   * "list pulls" route needed, a pull is just an import with
   * `source: 'EXTERNAL_API'`. 3 segments after `:id`
   * (`subjects`/`pulls` literal) — no shadowing risk against this
   * controller's other routes, same reasoning as their own doc comments.
   */
  @Post(':id/subjects/pulls')
  @ApiOperation({
    summary:
      'Kéo toàn bộ dữ liệu từ API điều kiện tiếp nhận của campaign về roster — chạy nền qua hàng đợi',
  })
  @ApiResponseDecorator(CampaignSubjectImportDao, { status: 202 })
  requestPull(
    @Param('id') campaignId: string,
    @Body() dto: RequestSubjectPullDto,
    @Req() req: Request,
  ): Promise<CampaignSubjectImportDao> {
    return this.subjectService.requestPull(
      campaignId,
      req.user?.id ?? null,
      dto,
    );
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
   * `GET /v1/campaigns/:id/subjects/distinct-values?field=className|faculty|major`
   * — card-photo-export-and-filters-plan-2026-09-17.md §G.2.a. Populates the
   * class/faculty/major filter dropdowns in the Photo Review and Print CMS
   * screens from the real roster (`campaign_subjects`), since none of those
   * 3 fields are catalogs/enums — they're free-text columns copied from an
   * Excel import. 3 segments after `:id` (`subjects`/`distinct-values`
   * literal) — no shadowing risk against `:id/subjects` (2 segments) or
   * `:id/subjects/imports[...]` (3-4 segments with a different 3rd literal),
   * same reasoning as this controller's other route-ordering doc comments.
   */
  @Get(':id/subjects/distinct-values')
  @ApiOperation({
    summary:
      'Giá trị duy nhất của 1 field (className/faculty/major) trong roster — dựng dropdown filter',
  })
  @ApiResponseDecorator(CampaignSubjectDistinctValuesDao)
  distinctValues(
    @Param('id') campaignId: string,
    @Query() query: DistinctSubjectValuesQueryDto,
  ): Promise<CampaignSubjectDistinctValuesDao> {
    return this.subjectService.distinctValues(campaignId, query.field);
  }

  /**
   * `POST /v1/campaigns/:id/subjects/test-roster-lookup` (plan §E.3,
   * `upload-identity-and-workflow-cleanup-plan-2026-09-17.md`) — dry-run
   * button for the workflow-editing screen: tests `key` + a not-yet-saved
   * `rules[]` draft against this campaign's already-imported roster,
   * mirroring `lookupSubject`'s ROSTER branch. 3 segments after `:id`
   * (`subjects`/`test-roster-lookup` literal) — no shadowing risk against
   * `:id/subjects` (2 segments) or the other 3-segment routes above, same
   * reasoning as this controller's other route-ordering doc comments.
   */
  @Post(':id/subjects/test-roster-lookup')
  @ApiOperation({
    summary:
      'Thử tra cứu 1 mã theo dữ liệu roster đã import + rule chưa lưu (từ màn cấu hình workflow)',
  })
  @ApiResponseDecorator(TestRosterLookupResultDao)
  testRosterLookup(
    @Param('id') campaignId: string,
    @Body() dto: TestRosterLookupDto,
  ): Promise<TestRosterLookupResultDao> {
    return this.subjectService.testRosterLookup(
      campaignId,
      dto.key,
      dto.rules ?? [],
    );
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
