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
import {
  PrinterDetailDao,
  PrinterListItemDao,
  PrinterStockEventDao,
} from '../dao';
import {
  CreatePrinterDto,
  ListPrintersQueryDto,
  PrinterStockAdjustDto,
  UpdatePrinterDto,
} from '../dto';
import { QueryPaginateDto } from '@app/shared/http/query-paginate.dto';
import { PrinterService } from '../services/printer.service';

/**
 * `GET/POST/PATCH /v1/printers*` — plan §2.7's "Quản lý máy in". CMS-only
 * (`SsoAuthGuard`+`PermissionsGuard`); the agent-authenticated
 * `POST /v1/printers/:id/heartbeat` deliberately lives on its own
 * `PrinterAgentController` instead, sharing this same `printers` path
 * prefix under a completely different guard — see that controller's own
 * doc comment for why they cannot both sit under one class-level
 * `@UseGuards()`.
 */
@Controller({ path: 'printers', version: '1' })
@ApiTags('print')
@UseGuards(SsoAuthGuard, PermissionsGuard)
@ApiBearerAuth('sso')
export class PrinterController {
  constructor(private readonly printerService: PrinterService) {}

  @Get()
  @RequirePermission('printer:read', 'Xem danh sách máy in')
  @ApiOperation({ summary: 'Danh sách máy in' })
  @ApiResponsePaginatedDecorator(PrinterListItemDao)
  list(
    @Query() query: ListPrintersQueryDto,
  ): Promise<Pagination<PrinterListItemDao>> {
    return this.printerService.list(query);
  }

  @Post()
  @RequirePermission('printer:write', 'Tạo máy in')
  @ApiOperation({ summary: 'Tạo máy in mới' })
  @ApiResponseDecorator(PrinterListItemDao)
  create(@Body() dto: CreatePrinterDto): Promise<PrinterListItemDao> {
    return this.printerService.create(dto);
  }

  @Get(':id')
  @RequirePermission('printer:read', 'Xem chi tiết máy in')
  @ApiOperation({
    summary:
      'Chi tiết máy in — kèm số phôi, hàng chờ, 20 sự kiện phôi gần nhất',
  })
  @ApiResponseDecorator(PrinterDetailDao)
  getDetail(@Param('id') id: string): Promise<PrinterDetailDao> {
    return this.printerService.getDetail(id);
  }

  @Patch(':id')
  @RequirePermission('printer:write', 'Sửa máy in')
  @ApiOperation({ summary: 'Sửa thông tin máy in' })
  @ApiResponseDecorator(PrinterListItemDao)
  patch(
    @Param('id') id: string,
    @Body() dto: UpdatePrinterDto,
  ): Promise<PrinterListItemDao> {
    return this.printerService.patch(id, dto);
  }

  @Post(':id/stock')
  @RequirePermission('printer:write', 'Cập nhật phôi máy in')
  @ApiOperation({
    summary: '"Nạp phôi" / điều chỉnh số phôi thủ công (REFILL/ADJUST/WASTE)',
  })
  @ApiResponseDecorator(PrinterStockEventDao)
  adjustStock(
    @Param('id') id: string,
    @Body() dto: PrinterStockAdjustDto,
    @Req() req: Request,
  ): Promise<PrinterStockEventDao> {
    return this.printerService.adjustStock(id, dto, req.user?.id ?? null);
  }

  @Get(':id/stock-events')
  @RequirePermission('printer:read', 'Xem lịch sử phôi máy in')
  @ApiOperation({ summary: 'Lịch sử thay đổi phôi, phân trang' })
  @ApiResponsePaginatedDecorator(PrinterStockEventDao)
  listStockEvents(
    @Param('id') id: string,
    @Query() query: QueryPaginateDto,
  ): Promise<Pagination<PrinterStockEventDao>> {
    return this.printerService.listStockEvents(
      id,
      query.page ?? 1,
      query.limit ?? 10,
    );
  }

  @Post(':id/disable')
  @RequirePermission('printer:write', 'Vô hiệu hóa máy in')
  @ApiOperation({
    summary: 'Vô hiệu hóa máy in (không nhận job mới, agent bị từ chối)',
  })
  @ApiResponseDecorator(PrinterListItemDao)
  disable(@Param('id') id: string): Promise<PrinterListItemDao> {
    return this.printerService.setEnabled(id, false);
  }

  @Post(':id/enable')
  @RequirePermission('printer:write', 'Kích hoạt lại máy in')
  @ApiOperation({ summary: 'Kích hoạt lại máy in đã vô hiệu hóa' })
  @ApiResponseDecorator(PrinterListItemDao)
  enable(@Param('id') id: string): Promise<PrinterListItemDao> {
    return this.printerService.setEnabled(id, true);
  }

  @Post(':id/test-print')
  @RequirePermission('printer:write', 'In thử')
  @ApiOperation({
    summary:
      'Xác nhận máy in sẵn sàng — xem doc comment service về giới hạn D-Q8',
  })
  testPrint(
    @Param('id') id: string,
  ): Promise<{ acknowledged: true; printerId: string }> {
    return this.printerService.testPrint(id);
  }

  @Post(':id/token')
  @RequirePermission('printer:write', 'Cấp/đổi token agent cho máy in')
  @ApiOperation({
    summary:
      'Cấp token mới cho print-agent — CHỈ hiển thị 1 lần trong response này',
  })
  issueToken(@Param('id') id: string): Promise<{ token: string }> {
    return this.printerService.issueToken(id);
  }
}
