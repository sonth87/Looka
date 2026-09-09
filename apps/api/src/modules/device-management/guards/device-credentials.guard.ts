import { CustomException, ERROR_CODE } from '@app/common/errors';
import {
  CanActivate,
  ExecutionContext,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Request } from 'express';
import { Device } from '../entities/device.entity';
import {
  DeviceService,
  deviceCredentialFailure,
} from '../services/device.service';

declare module 'express' {
  interface Request {
    device?: Device;
  }
}

/**
 * Authenticates a kiosk fetching its own resources (its campaign config —
 * see DeviceController.getMyConfig) via `x-device-id`/`x-device-secret`,
 * rather than the shared admin `x-api-key` `ApiKeyMiddleware` checks. A kiosk
 * has a device identity, not the admin key that manages every campaign — the
 * two are deliberately different credentials for different callers.
 */
@Injectable()
export class DeviceCredentialsGuard implements CanActivate {
  constructor(private readonly deviceService: DeviceService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const deviceId = req.header('x-device-id');
    const deviceSecret = req.header('x-device-secret');
    if (!deviceId || !deviceSecret) {
      throw new CustomException(
        'x-device-id and x-device-secret are both required',
        ERROR_CODE.DEVICE_SECRET_INVALID,
        HttpStatus.UNAUTHORIZED,
      );
    }

    const check = await this.deviceService.verifyCredentials(
      deviceId,
      deviceSecret,
    );
    if (!check.ok) {
      // 2026-09-08: was `UnauthorizedException`, which the global
      // `HttpExceptionFilter` maps to `errorCode: 401` in its default
      // branch — the kiosk (apps/desktop/src/main/deviceApi.ts) could not
      // tell "secret rotated" (5005) from "revoked" (5008) from "expired"
      // (5003) apart, and lumped every 401 into one generic message. See
      // `deviceCredentialFailure`'s own doc comment (device.service.ts).
      throw deviceCredentialFailure(check.reason);
    }

    req.device = check.device;
    return true;
  }
}
