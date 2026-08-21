import { CustomException, ERROR_CODE } from '@app/common/errors';
import { HttpStatus, Injectable, NestMiddleware } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';
import { NextFunction, Request, Response } from 'express';

/**
 * Gate for the kiosk-facing routes (sessions, photos): the caller must send
 * the shared secret configured as API_KEY in the `x-api-key` header.
 *
 * There is no per-caller identity here - no admin/user table exists in this
 * project, unlike the reference CMS this otherwise mirrors, which
 * authenticates operators via Passport/JWT Guards (`AdminJwtGuard`). This is
 * one static credential every trusted client (currently: the web app) is
 * provisioned with out of band, applied as middleware rather than a Guard by
 * explicit choice, so it deliberately departs from that reference here.
 */
@Injectable()
export class ApiKeyMiddleware implements NestMiddleware {
  private readonly expectedKey: Buffer;

  constructor(configService: ConfigService) {
    const apiKey = configService.get<string>('security.apiKey');
    if (!apiKey) {
      // Fails at boot, the same way FileStorageService's onModuleInit does
      // for an unreachable file-service: a server that silently accepts
      // every request because nobody set API_KEY is worse than one that
      // won't start.
      throw new Error('API_KEY must be set - refusing to start without it');
    }
    this.expectedKey = Buffer.from(apiKey);
  }

  use(req: Request, res: Response, next: NextFunction): void {
    const provided = req.header('x-api-key');
    if (!provided) {
      throw new CustomException(
        'API key required',
        ERROR_CODE.API_KEY_MISSING,
        HttpStatus.UNAUTHORIZED,
      );
    }

    const providedKey = Buffer.from(provided);
    // Constant-time compare - a length/byte-position-timed comparison would
    // let a caller recover the key one correct byte at a time.
    const valid =
      providedKey.length === this.expectedKey.length &&
      timingSafeEqual(providedKey, this.expectedKey);

    if (!valid) {
      throw new CustomException(
        'Invalid API key',
        ERROR_CODE.API_KEY_INVALID,
        HttpStatus.UNAUTHORIZED,
      );
    }

    next();
  }
}
