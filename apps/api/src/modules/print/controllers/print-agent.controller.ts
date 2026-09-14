import { ApiResponseArrayDecorator } from '@app/shared/http/api-response.decorator';
import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiSecurity, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { PrintItemDetailDao } from '../dao';
import { PrintItemStatusCallbackDto } from '../dto';
import { PrinterAgentGuard } from '../guards/printer-agent.guard';
import { PrintItemService } from '../services/print-item.service';

/**
 * The print-agent-facing half of `print/*` — `GET /v1/print/queue` and
 * `POST /v1/print/items/:id/status`, plan §2.5's own "Print agent" section.
 * Deliberately NOT `SsoAuthGuard`/`PermissionsGuard` (the caller is a
 * printer/kiosk process, not a logged-in CMS user) — `PrinterAgentGuard`
 * instead, same reasoning `DeviceCredentialsGuard` documents for
 * `DeviceSelfController`. Kept as its own controller rather than added to
 * `PrintItemController` so the two guard stacks never have to coexist on
 * one class (`@UseGuards()` is class-level there); both controllers happen
 * to share the `print`/`print/items` path space, which Nest allows as long
 * as no two routes collide (they don't — see each controller's own doc
 * comment).
 *
 * The real DIRECT-mode print agent (an Electron/PC app polling this,
 * pushing to a Windows spooler) is explicitly out of scope this pass
 * (D-Q8) — this only defines the shape a future agent would consume.
 */
@Controller({ path: 'print', version: '1' })
@ApiTags('print-agent')
@ApiSecurity('printer-token')
@UseGuards(PrinterAgentGuard)
export class PrintAgentController {
  constructor(private readonly itemService: PrintItemService) {}

  @Get('queue')
  @ApiQuery({
    name: 'printerId',
    required: false,
    description:
      'Tùy chọn — nếu có, PrinterAgentGuard đã kiểm tra khớp với token; máy in thực tế luôn lấy từ token, không từ query này',
  })
  @ApiOperation({
    summary: 'Agent lấy danh sách item QUEUED của máy in mình (Bearer token)',
  })
  @ApiResponseArrayDecorator(PrintItemDetailDao)
  queue(
    @Query('printerId') _printerId: string | undefined,
    @Req() req: Request,
  ): Promise<PrintItemDetailDao[]> {
    // `PrinterAgentGuard` already resolved+verified `req.printer` from the
    // token (and, when `printerId` was given, confirmed it matches) — the
    // query param is accepted for API-shape/documentation purposes only;
    // the actual filter always uses the guard-resolved id so the two can
    // never disagree.
    return this.itemService.queueForPrinter(req.printer!.id);
  }

  @Post('items/:id/status')
  @ApiOperation({
    summary: 'Agent báo trạng thái PRINTING/PRINTED/FAILED cho 1 item',
  })
  async status(
    @Param('id') id: string,
    @Body() dto: PrintItemStatusCallbackDto,
    @Req() req: Request,
  ): Promise<{ ok: true }> {
    await this.itemService.statusCallback(id, req.printer!, dto);
    return { ok: true };
  }
}
