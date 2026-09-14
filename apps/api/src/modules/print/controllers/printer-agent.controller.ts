import {
  Body,
  Controller,
  ForbiddenException,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { PrinterHeartbeatDto } from '../dto';
import { PrinterAgentGuard } from '../guards/printer-agent.guard';
import { PrinterService } from '../services/printer.service';

/**
 * `POST /v1/printers/:id/heartbeat` — agent-authenticated (`PrinterAgentGuard`),
 * NOT `SsoAuthGuard`/`PermissionsGuard`. Split out from `PrinterController`
 * for the same reason `PrintAgentController` is split from
 * `PrintItemController` — one class-level `@UseGuards()` per controller,
 * and these two guard stacks must never share one. Both controllers sit
 * under the same `printers` path prefix; no route collision since
 * `PrinterController` declares no `:id/heartbeat` route of its own.
 */
@Controller({ path: 'printers', version: '1' })
@ApiTags('print-agent')
@ApiSecurity('printer-token')
@UseGuards(PrinterAgentGuard)
export class PrinterAgentController {
  constructor(private readonly printerService: PrinterService) {}

  @Post(':id/heartbeat')
  @ApiOperation({
    summary: 'Agent báo trạng thái máy in (ONLINE/OFFLINE/ERROR)',
  })
  async heartbeat(
    @Param('id') id: string,
    @Body() dto: PrinterHeartbeatDto,
    @Req() req: Request,
  ): Promise<{ ok: true }> {
    // `PrinterAgentGuard` resolves+verifies `req.printer` from the token
    // alone — it deliberately does NOT cross-check `:id` against it (that
    // guard is shared with routes where `:id` means a different resource
    // entirely; see its own doc comment for the live bug this fixed). This
    // route's `:id` IS a printer id, so the check belongs here instead: one
    // printer's token must not be able to heartbeat AS a different printer
    // id named in the URL.
    if (id !== req.printer!.id) {
      throw new ForbiddenException('Token không khớp với máy in này');
    }
    await this.printerService.heartbeat(req.printer!, dto);
    return { ok: true };
  }
}
