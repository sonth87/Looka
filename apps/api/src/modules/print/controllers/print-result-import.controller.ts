import {
  ApiResponseArrayDecorator,
  ApiResponseDecorator,
} from '@app/shared/http/api-response.decorator';
import { SsoAuthGuard } from '@app/shared/auth/index';
import { PermissionsGuard } from '@app/modules/identity/presentation/guards/permissions.guard';
import { RequirePermission } from '@app/modules/identity/presentation/guards/require-permission.decorator';
import {
  Controller,
  Get,
  Header,
  Param,
  Post,
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
import { PrintResultImportDao } from '../dao';
import { PrintResultImportService } from '../services/print-result-import.service';

const MAX_RESULT_FILE_BYTES = 10 * 1024 * 1024;

/** Same reasoning as `CampaignSubjectController`'s own `UploadedMulterFile` — no `@types/multer` installed. */
interface UploadedMulterFile {
  buffer: Buffer;
  mimetype: string;
  size: number;
  originalname: string;
}

/**
 * Print-result upload (Giai đoạn 4, plan §4.3) — kept as its own controller
 * with a bare `print` prefix, same "several controllers safely share the
 * `print`/`print/batches` path space, Nest allows it as long as no two
 * ROUTES collide" convention `PrintAgentController`'s own doc comment
 * documents. `GET result-template` (1 segment after `print`) and
 * `:id/result-imports[...]` (3-4 segments starting with a literal
 * `batches`) never collide with `PrintBatchController`'s own `:id/...`
 * routes (that controller's prefix is `print/batches`, not bare `print`).
 */
@Controller({ path: 'print', version: '1' })
@ApiTags('print')
@UseGuards(SsoAuthGuard, PermissionsGuard)
@ApiBearerAuth('sso')
export class PrintResultImportController {
  constructor(private readonly resultImportService: PrintResultImportService) {}

  @Post('batches/:id/result-imports')
  @RequirePermission('print-batch:write', 'Upload kết quả in')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_RESULT_FILE_BYTES } }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Upload file kết quả in — trường multipart tên "file"',
  })
  @ApiResponseDecorator(PrintResultImportDao, { status: 201 })
  importResults(
    @Param('id') batchId: string,
    @UploadedFile() file: UploadedMulterFile,
    @Req() req: Request,
  ): Promise<PrintResultImportDao> {
    return this.resultImportService.importResults(
      batchId,
      file,
      req.user?.id ?? null,
    );
  }

  @Get('batches/:id/result-imports')
  @RequirePermission('print-batch:read', 'Xem lịch sử upload kết quả in')
  @ApiOperation({ summary: 'Lịch sử các lần upload kết quả in của đợt' })
  @ApiResponseArrayDecorator(PrintResultImportDao)
  listImports(@Param('id') batchId: string): Promise<PrintResultImportDao[]> {
    return this.resultImportService.listImports(batchId);
  }

  @Get('batches/:id/result-imports/:importId')
  @RequirePermission('print-batch:read', 'Xem chi tiết 1 lần upload kết quả in')
  @ApiOperation({
    summary: 'Chi tiết 1 lần upload — tổng số dòng + link báo cáo lỗi',
  })
  @ApiResponseDecorator(PrintResultImportDao)
  getImport(
    @Param('id') batchId: string,
    @Param('importId') importId: string,
  ): Promise<PrintResultImportDao> {
    return this.resultImportService.getImport(batchId, importId);
  }

  @Get('result-template')
  @Header(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  )
  @ApiOperation({ summary: 'Tải file mẫu kết quả in' })
  async downloadTemplate(): Promise<StreamableFile> {
    const buffer = await this.resultImportService.buildTemplate();
    return new StreamableFile(buffer, {
      disposition: 'attachment; filename="print-result-template.xlsx"',
    });
  }
}
