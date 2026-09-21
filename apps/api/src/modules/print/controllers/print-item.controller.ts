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
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import {
  PrintItemDetailDao,
  PrintItemGroupDao,
  PrintItemListItemDao,
} from '../dao';
import {
  BulkCreatePrintItemsDto,
  BulkTemplatePrintItemsDto,
  ListPrintItemsQueryDto,
  PrintItemGroupsQueryDto,
  UpdatePrintItemDto,
} from '../dto';
import { PrintItemService } from '../services/print-item.service';

/**
 * `GET/PATCH /v1/print/items*` — plan §2.5's main list for "Quản lý đợt in
 * thẻ" plus the per-item render/preview/reprint/bulk actions. CMS-only
 * (`SsoAuthGuard`+`PermissionsGuard`) — the print-agent's OWN
 * `items/:id/status` callback lives on `PrintAgentController` instead
 * (different guard entirely, see that controller's doc comment), even
 * though both share the `print` path prefix.
 */
@Controller({ path: 'print/items', version: '1' })
@ApiTags('print')
@UseGuards(SsoAuthGuard, PermissionsGuard)
@ApiBearerAuth('sso')
export class PrintItemController {
  constructor(private readonly itemService: PrintItemService) {}

  @Get()
  @RequirePermission('print-item:read', 'Xem danh sách item in')
  @ApiOperation({
    summary:
      'Danh sách item in, lọc theo campaign/đợt/trạng thái/lớp/khoa (plan §2.5)',
  })
  @ApiResponsePaginatedDecorator(PrintItemListItemDao)
  list(
    @Query() query: ListPrintItemsQueryDto,
  ): Promise<Pagination<PrintItemListItemDao>> {
    return this.itemService.list(query);
  }

  // Declared before `:id` so the literal segment `groups` never gets
  // swallowed by the `:id` param route — same ordering rule
  // `card-template.controller.ts`'s `fields` route documents.
  @Get('groups')
  @RequirePermission('print-item:read', 'Xem thống kê gom nhóm item in')
  @ApiOperation({ summary: 'Đếm item theo lớp/khoa (gom nhóm), plan §2.5' })
  @ApiResponseArrayDecorator(PrintItemGroupDao)
  groups(
    @Query() query: PrintItemGroupsQueryDto,
  ): Promise<PrintItemGroupDao[]> {
    return this.itemService.groups(query);
  }

  @Get(':id')
  @RequirePermission('print-item:read', 'Xem chi tiết item in')
  @ApiOperation({ summary: 'Chi tiết 1 item in, kèm lịch sử trạng thái' })
  @ApiResponseDecorator(PrintItemDetailDao)
  getDetail(@Param('id') id: string): Promise<PrintItemDetailDao> {
    return this.itemService.getDetail(id);
  }

  @Patch(':id')
  @RequirePermission('print-item:write', 'Sửa item in')
  @ApiOperation({
    summary:
      'Sửa phôi/dữ liệu bổ sung, hoặc chuyển CANCELLED/PRINTED (thao tác tay)',
  })
  @ApiResponseDecorator(PrintItemDetailDao)
  patch(
    @Param('id') id: string,
    @Body() dto: UpdatePrintItemDto,
    @Req() req: Request,
  ): Promise<PrintItemDetailDao> {
    return this.itemService.patch(id, dto, req.user?.id ?? null);
  }

  @Post(':id/render')
  @RequirePermission('print-item:write', 'Render lại mặt trước/sau item in')
  @ApiOperation({
    summary: 'Render (hoặc render lại) ảnh mặt trước/sau (plan §2.5)',
  })
  @ApiResponseDecorator(PrintItemDetailDao)
  render(@Param('id') id: string): Promise<PrintItemDetailDao> {
    return this.itemService.render(id);
  }

  @Get(':id/preview')
  @RequirePermission('print-item:read', 'Xem thử ảnh item in')
  @ApiOperation({
    summary: 'PNG mặt trước/sau — ảnh đã render nếu có, ngược lại render thử',
  })
  async preview(
    @Param('id') id: string,
    @Query('side') side: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const resolvedSide =
      side === 'back' ? 'back' : side === 'front' || !side ? 'front' : null;
    if (!resolvedSide)
      throw new BadRequestException('side phải là front hoặc back');
    const png = await this.itemService.preview(id, resolvedSide);
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'no-store');
    res.send(png);
  }

  @Post(':id/reprint')
  @RequirePermission('print-item:write', 'Tạo bản in lại cho item')
  @ApiOperation({
    summary: 'Tạo item in lại (reprint), item gốc chuyển REPRINT_REQUESTED',
  })
  @ApiResponseDecorator(PrintItemDetailDao)
  reprint(
    @Param('id') id: string,
    @Req() req: Request,
  ): Promise<PrintItemDetailDao> {
    return this.itemService.reprint(id, req.user?.id ?? null);
  }

  @Post('bulk')
  @RequirePermission(
    'print-item:write',
    'Tạo hàng loạt item in từ hồ sơ đã duyệt',
  )
  @ApiOperation({
    summary: 'Tạo item in từ danh sách setIds hoặc filter (chỉ hồ sơ APPROVED)',
  })
  bulkCreate(@Body() dto: BulkCreatePrintItemsDto): Promise<{
    created: number;
    createdIds: string[];
    skipped: Array<{ setId: string; reason: string }>;
  }> {
    return this.itemService.bulkCreate(dto);
  }

  @Post('bulk-template')
  @RequirePermission('print-item:write', 'Áp phôi in hàng loạt')
  @ApiOperation({
    summary: '"Thiết kế phôi cho 1 người rồi áp cho nhiều người" (plan §2.5)',
  })
  bulkApplyTemplate(
    @Body() dto: BulkTemplatePrintItemsDto,
  ): Promise<{ updated: number }> {
    return this.itemService.bulkApplyTemplate(dto);
  }
}
