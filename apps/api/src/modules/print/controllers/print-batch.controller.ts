import { SsoAuthGuard } from '@app/shared/auth/index';
import {
  ApiResponseDecorator,
  ApiResponsePaginatedDecorator,
} from '@app/shared/http/api-response.decorator';
import { Pagination } from '@app/shared/http/pagination';
import { PermissionsGuard } from '@app/modules/identity/presentation/guards/permissions.guard';
import { RequirePermission } from '@app/modules/identity/presentation/guards/require-permission.decorator';
import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  Patch,
  Post,
  Query,
  Req,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { PrintBatchDetailDao, PrintBatchListItemDao } from '../dao';
import {
  BatchItemsDto,
  CreatePrintBatchDto,
  ExportPrintBatchDto,
  ListPrintBatchesQueryDto,
  PrintPackageQueryDto,
  SendPrintBatchDto,
  UpdatePrintBatchDto,
} from '../dto';
import { PrintBatchService } from '../services/print-batch.service';

/** `GET/POST/PATCH /v1/print/batches*` — plan §2.5's đợt-in lifecycle. CMS-only. */
@Controller({ path: 'print/batches', version: '1' })
@ApiTags('print')
@UseGuards(SsoAuthGuard, PermissionsGuard)
@ApiBearerAuth('sso')
export class PrintBatchController {
  constructor(private readonly batchService: PrintBatchService) {}

  @Get()
  @RequirePermission('print-batch:read', 'Xem danh sách đợt in')
  @ApiOperation({ summary: 'Danh sách đợt in' })
  @ApiResponsePaginatedDecorator(PrintBatchListItemDao)
  list(
    @Query() query: ListPrintBatchesQueryDto,
  ): Promise<Pagination<PrintBatchListItemDao>> {
    return this.batchService.list(query);
  }

  @Post()
  @RequirePermission('print-batch:write', 'Tạo đợt in')
  @ApiOperation({ summary: 'Tạo đợt in mới (DRAFT)' })
  @ApiResponseDecorator(PrintBatchDetailDao)
  create(
    @Body() dto: CreatePrintBatchDto,
    @Req() req: Request,
  ): Promise<PrintBatchDetailDao> {
    return this.batchService.create(dto, req.user?.id ?? null);
  }

  @Get(':id')
  @RequirePermission('print-batch:read', 'Xem chi tiết đợt in')
  @ApiOperation({ summary: 'Chi tiết 1 đợt in' })
  @ApiResponseDecorator(PrintBatchDetailDao)
  getDetail(@Param('id') id: string): Promise<PrintBatchDetailDao> {
    return this.batchService.getDetail(id);
  }

  @Patch(':id')
  @RequirePermission('print-batch:write', 'Sửa đợt in')
  @ApiOperation({ summary: 'Sửa đợt in — chỉ khi DRAFT/READY' })
  @ApiResponseDecorator(PrintBatchDetailDao)
  patch(
    @Param('id') id: string,
    @Body() dto: UpdatePrintBatchDto,
  ): Promise<PrintBatchDetailDao> {
    return this.batchService.patch(id, dto);
  }

  @Post(':id/items')
  @RequirePermission('print-batch:write', 'Thêm item vào đợt in')
  @ApiOperation({ summary: 'Thêm danh sách item vào đợt in' })
  @ApiResponseDecorator(PrintBatchDetailDao)
  addItems(
    @Param('id') id: string,
    @Body() dto: BatchItemsDto,
  ): Promise<PrintBatchDetailDao> {
    return this.batchService.addItems(id, dto.itemIds);
  }

  @Delete(':id/items/:itemId')
  @RequirePermission('print-batch:write', 'Gỡ item khỏi đợt in')
  @ApiOperation({
    summary: 'Gỡ 1 item khỏi đợt in (item vẫn tồn tại, chỉ mất batchId)',
  })
  async removeItem(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
  ): Promise<{ removed: true }> {
    await this.batchService.removeItem(id, itemId);
    return { removed: true };
  }

  @Post(':id/items/remove')
  @RequirePermission('print-batch:write', 'Gỡ nhiều item khỏi đợt in')
  @ApiOperation({
    summary:
      'Gỡ hàng loạt item khỏi đợt in (item vẫn tồn tại, chỉ mất batchId)',
  })
  removeItems(
    @Param('id') id: string,
    @Body() dto: BatchItemsDto,
  ): Promise<{ removed: number }> {
    return this.batchService.removeItems(id, dto.itemIds);
  }

  @Post(':id/populate')
  @RequirePermission('print-batch:write', 'Nạp tự động ảnh đã duyệt vào đợt in')
  @ApiOperation({
    summary:
      'Tạo + gắn toàn bộ item chưa in của campaign (đã duyệt) vào đợt in (plan §4.1)',
  })
  populate(@Param('id') id: string): Promise<{
    created: number;
    attached: number;
    skipped: Array<{ setId: string; reason: string }>;
  }> {
    return this.batchService.populate(id);
  }

  @Post(':id/render')
  @RequirePermission('print-batch:write', 'Render toàn bộ đợt in')
  @ApiOperation({
    summary:
      'Render mọi item chưa render trong đợt (đồng bộ, xem doc comment service)',
  })
  render(@Param('id') id: string): Promise<{
    rendered: number;
    failed: number;
    errors: Array<{ itemId: string; message: string }>;
  }> {
    return this.batchService.render(id);
  }

  @Post(':id/send')
  @RequirePermission('print-batch:write', 'Gửi in đợt in')
  @ApiOperation({
    summary:
      'DIRECT ONLY: xếp hàng cho print-agent (QUEUED). Đợt CENTRALIZED dùng "Xuất gói" + "Hoàn tất đợt" thay vì route này. Bỏ trống itemIds = cả đợt.',
  })
  @ApiResponseDecorator(PrintBatchDetailDao)
  send(
    @Param('id') id: string,
    @Body() dto: SendPrintBatchDto,
  ): Promise<PrintBatchDetailDao> {
    return this.batchService.send(id, dto.itemIds);
  }

  @Get(':id/package')
  @RequirePermission('print-batch:read', 'Tải gói in tập trung')
  @Header('Content-Type', 'application/zip')
  @ApiOperation({
    summary:
      'Tải lại zip (ảnh mặt trước/sau + manifest.csv) — CHỈ ĐỌC, không đóng dấu ngày xuất. Bỏ trống itemIds = cả đợt.',
  })
  async downloadPackage(
    @Param('id') id: string,
    @Query() query: PrintPackageQueryDto,
  ): Promise<StreamableFile> {
    const { zip, filename } = await this.batchService.package(
      id,
      query.itemIds,
    );
    return new StreamableFile(zip, {
      disposition: `attachment; filename="${filename}"`,
    });
  }

  @Post(':id/package')
  @RequirePermission('print-batch:write', 'Xuất gói in tập trung')
  @Header('Content-Type', 'application/zip')
  @ApiOperation({
    summary:
      '"Xuất gói" (CENTRALIZED) — tải zip VÀ đóng dấu exported_at, RENDERED→EXPORTED cho các item có trong gói. Bỏ trống itemIds = cả đợt.',
  })
  async exportPackage(
    @Param('id') id: string,
    @Body() dto: ExportPrintBatchDto,
    @Req() req: Request,
  ): Promise<StreamableFile> {
    const { zip, filename } = await this.batchService.exportPackage(
      id,
      dto.itemIds,
      req.user?.id ?? null,
    );
    return new StreamableFile(zip, {
      disposition: `attachment; filename="${filename}"`,
    });
  }

  @Post(':id/complete')
  @RequirePermission('print-batch:write', 'Hoàn tất đợt in')
  @ApiOperation({
    summary:
      '"Hoàn tất đợt" (CENTRALIZED) — chuyển đợt sang DONE, cần ít nhất 1 item đã EXPORTED/PRINTED',
  })
  @ApiResponseDecorator(PrintBatchDetailDao)
  complete(@Param('id') id: string): Promise<PrintBatchDetailDao> {
    return this.batchService.complete(id);
  }

  @Post(':id/cancel')
  @RequirePermission('print-batch:write', 'Hủy đợt in')
  @ApiOperation({ summary: 'Hủy đợt in (không hủy các item bên trong)' })
  @ApiResponseDecorator(PrintBatchDetailDao)
  cancel(@Param('id') id: string): Promise<PrintBatchDetailDao> {
    return this.batchService.cancel(id);
  }
}
