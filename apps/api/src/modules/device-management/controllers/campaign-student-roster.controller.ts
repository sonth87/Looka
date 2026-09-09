import {
  ApiResponseDecorator,
  ApiResponsePaginatedDecorator,
} from '@app/common/decorators';
import { SsoAuthGuard } from '@app/common/guards';
import { CustomException, ERROR_CODE } from '@app/common/errors';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import {
  CampaignStudentRosterDao,
  RosterImportResultDao,
  RosterLookupResultDao,
} from '../dao';
import { ListCampaignStudentRosterQueryDto } from '../dto/list-campaign-student-roster-query.dto';
import { UpdateCampaignStudentRosterRowDto } from '../dto/update-campaign-student-roster-row.dto';
import { AdminRoleGuard } from '../guards/admin-role.guard';
import { CampaignMemberGuard } from '../guards/campaign-member.guard';
import { CampaignStudentRosterService } from '../services/campaign-student-roster.service';

/** Generous but bounded — a roster of a few thousand rows is well under this; guards against an accidental non-CSV upload. */
const MAX_ROSTER_CSV_BYTES = 5 * 1024 * 1024;

/**
 * Multer's own runtime shape for `@UploadedFile()` — same reasoning as
 * `review.controller.ts`'s identical local interface: this app has no
 * `@types/multer` installed, and this task is scoped to not touch
 * `package.json`.
 */
interface UploadedMulterFile {
  buffer: Buffer;
  mimetype: string;
  size: number;
  originalname: string;
}

/**
 * "Sinh viên dự kiến" campaign roster (2026-09-09) — see
 * `CampaignStudentRoster` entity's own doc comment. Every route except
 * `lookup` is CMS/admin-only (`AdminRoleGuard`), same gating as
 * `CaptureConfigurationController`. `lookup` is the one route the kiosk
 * itself calls, gated the same way `GET /v1/campaigns/:id/config` already
 * is (`CampaignMemberGuard`: an SSO-logged-in, APPROVED member of an OPEN
 * campaign) rather than admin-only — see that guard's own doc comment.
 */
@Controller({ path: 'campaigns', version: '1' })
@ApiTags('device-management')
@ApiBearerAuth('sso')
export class CampaignStudentRosterController {
  constructor(private readonly rosterService: CampaignStudentRosterService) {}

  @Get(':id/roster')
  @UseGuards(SsoAuthGuard, AdminRoleGuard)
  @ApiOperation({ summary: "List a campaign's expected-student roster, paginated, searchable" })
  @ApiResponsePaginatedDecorator(CampaignStudentRosterDao)
  listRoster(
    @Param('id') campaignId: string,
    @Query() query: ListCampaignStudentRosterQueryDto,
  ) {
    return this.rosterService.listRoster(campaignId, query);
  }

  @Post(':id/roster/import')
  @UseGuards(SsoAuthGuard, AdminRoleGuard)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_ROSTER_CSV_BYTES } }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  @ApiOperation({
    summary:
      'Bulk-import/upsert the roster from a CSV (columns: mã SV, tên, số CCCD, lớp?, ngành?, năm học? — any order, header required)',
  })
  @ApiResponseDecorator(RosterImportResultDao, { status: 201 })
  async importRoster(
    @Param('id') campaignId: string,
    @UploadedFile() file: UploadedMulterFile,
  ): Promise<RosterImportResultDao> {
    if (!file || !file.buffer?.length) {
      throw new CustomException('A CSV file is required', ERROR_CODE.BAD_REQUEST, HttpStatus.BAD_REQUEST);
    }
    return this.rosterService.importRoster(campaignId, file.buffer.toString('utf8'));
  }

  @Patch(':id/roster/:rowId')
  @UseGuards(SsoAuthGuard, AdminRoleGuard)
  @ApiOperation({ summary: 'Fix a single roster row (e.g. a mistyped CCCD digit from a bad import)' })
  @ApiResponseDecorator(CampaignStudentRosterDao)
  updateRow(
    @Param('id') campaignId: string,
    @Param('rowId') rowId: string,
    @Body() dto: UpdateCampaignStudentRosterRowDto,
  ): Promise<CampaignStudentRosterDao> {
    return this.rosterService.updateRow(campaignId, rowId, dto);
  }

  @Delete(':id/roster/:rowId')
  @UseGuards(SsoAuthGuard, AdminRoleGuard)
  @ApiOperation({ summary: 'Remove one roster row' })
  async deleteRow(
    @Param('id') campaignId: string,
    @Param('rowId') rowId: string,
  ): Promise<{ id: string }> {
    await this.rosterService.deleteRow(campaignId, rowId);
    return { id: rowId };
  }

  @Delete(':id/roster')
  @UseGuards(SsoAuthGuard, AdminRoleGuard)
  @ApiOperation({ summary: 'Clear the entire roster (e.g. an import landed on the wrong campaign)' })
  clearRoster(@Param('id') campaignId: string): Promise<{ removed: number }> {
    return this.rosterService.clearRoster(campaignId);
  }

  /**
   * The kiosk's own call — see `CampaignStudentRosterService.lookupByCitizenId`'s
   * own doc comment for why `found: false` is a normal 200 response, never a
   * thrown 404.
   */
  @Get(':id/roster/lookup')
  @UseGuards(SsoAuthGuard, CampaignMemberGuard)
  @ApiQuery({ name: 'citizenId', required: true })
  @ApiOperation({ summary: 'Find the roster row (if any) matching a freshly scanned CCCD number' })
  @ApiResponseDecorator(RosterLookupResultDao)
  lookup(
    @Param('id') campaignId: string,
    @Query('citizenId') citizenId: string,
  ): Promise<RosterLookupResultDao> {
    return this.rosterService.lookupByCitizenId(campaignId, citizenId ?? '');
  }
}
