import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Request } from 'express';
import { Repository } from 'typeorm';
import { Printer } from '../entities/printer.entity';
import { hashPrinterToken } from '../services/printer-token.util';

declare module 'express' {
  interface Request {
    printer?: Printer;
  }
}

/**
 * Authenticates a print agent (kiosk/PC with a printer attached) hitting
 * `GET /v1/print/queue`, `POST /v1/print/items/:id/status`, or
 * `POST /v1/printers/:id/heartbeat` — the "caller is a printer, not a CMS
 * user" routes the task brief calls out explicitly, deliberately NOT gated
 * by `SsoAuthGuard`/`PermissionsGuard`.
 *
 * Closest existing precedent is `DeviceCredentialsGuard`
 * (`x-device-id`/`x-device-secret`, looked up by id then compared with
 * `timingSafeEqual`), but a printer's credential is a single bearer token
 * with no separate public id sent alongside it (D-Q8 — DIRECT printing's
 * real agent is out of scope this pass, so there is no existing client
 * shaping this choice; a single opaque token is the simplest shape a future
 * agent implementation can adopt). That rules out the id-then-compare
 * approach: instead, the SHA-256 hash is looked up directly via the unique
 * index on `printers.agent_token_hash` (`UQ_printers_agent_token_hash`) —
 * the same "hash a bearer token, index-lookup it" pattern used for API keys
 * industry-wide (also `ApiKeyMiddleware`'s conceptual sibling, minus the
 * `timingSafeEqual` since there is no second value to compare against; a
 * B-tree index lookup on a high-entropy SHA-256 hash is not the kind of
 * byte-by-byte comparison `timingSafeEqual` defends against).
 *
 * Where the route ALSO carries the printer id as a QUERY param (`printerId`
 * on `GET /v1/print/queue`), it is checked against the token's own printer.
 * `:id` route params are deliberately NOT compared here — this guard is
 * shared by THREE routes and `:id` means a different resource on each
 * (`printers.id` on heartbeat, `print_items.id` on the status callback), so
 * a blind param-name match would 403 a perfectly valid agent call whenever
 * `:id` happens to be something other than a printer id (confirmed live:
 * the status-callback route always failed this check before it was
 * narrowed to `printerId` alone). Each controller that needs its own `:id`
 * checked against `req.printer` does so explicitly (see
 * `PrinterAgentController.heartbeat`).
 */
@Injectable()
export class PrinterAgentGuard implements CanActivate {
  constructor(
    @InjectRepository(Printer)
    private readonly printers: Repository<Printer>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const auth = req.header('authorization');
    const token = auth?.startsWith('Bearer ') ? auth.slice(7).trim() : null;
    if (!token) {
      throw new UnauthorizedException('Thiếu Bearer token của máy in');
    }

    const hash = hashPrinterToken(token);
    const printer = await this.printers
      .createQueryBuilder('p')
      .addSelect('p.agentTokenHash')
      .where('p.agentTokenHash = :hash', { hash })
      .getOne();
    if (!printer) {
      throw new UnauthorizedException('Token máy in không hợp lệ');
    }
    if (printer.status === 'DISABLED') {
      throw new ForbiddenException('Máy in đã bị vô hiệu hóa');
    }

    const claimedPrinterId = req.query?.printerId as string | undefined;
    if (claimedPrinterId && claimedPrinterId !== printer.id) {
      throw new ForbiddenException('Token không khớp với máy in này');
    }

    req.printer = printer;
    return true;
  }
}
