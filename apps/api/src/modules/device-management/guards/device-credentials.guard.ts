import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import { Device } from '../entities/device.entity';
import { DeviceService } from '../services/device.service';

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
      throw new UnauthorizedException('x-device-id and x-device-secret are both required');
    }

    const check = await this.deviceService.verifyCredentials(deviceId, deviceSecret);
    if (!check.ok) {
      throw new UnauthorizedException(`Device credential check failed: ${check.reason}`);
    }

    req.device = check.device;
    return true;
  }
}
