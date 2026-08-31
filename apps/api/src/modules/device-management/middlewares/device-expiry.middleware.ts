import { CustomException, ERROR_CODE } from '@app/common/errors';
import { HttpStatus, Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { DeviceService } from '../services/device.service';

/**
 * The "Lớp Looka (apps/api)" half of the two-layer expiry block described in
 * docs/plans/multi-camera-device-management-discussion.md §3.3 — the other
 * half is fs-core's own per-device key. Only ever applies to the **web**
 * flow: the desktop kiosk does not call `apps/api` at all today (it talks
 * straight to fs-core — see that doc section for why), so there is nothing
 * for this middleware to check on that path yet.
 *
 * Deliberately a pass-through when neither header is sent, rather than a
 * hard requirement on every route it's attached to: no web client sends
 * `x-device-id`/`x-device-secret` yet, and turning this into a mandatory
 * check today would 401 every existing capture request rather than add a
 * new, additive guard. It only ever blocks a request that *claims* a device
 * identity and turns out to be invalid, expired, or unregistered — never one
 * that simply doesn't send these headers at all. Whoever wires device
 * headers into the actual web client decides when this stops being optional
 * (e.g. by rejecting the two headers' absence explicitly once that ships).
 */
@Injectable()
export class DeviceExpiryMiddleware implements NestMiddleware {
  constructor(private readonly deviceService: DeviceService) {}

  async use(req: Request, res: Response, next: NextFunction): Promise<void> {
    const deviceId = req.header('x-device-id');
    const deviceSecret = req.header('x-device-secret');
    if (!deviceId && !deviceSecret) {
      next();
      return;
    }
    if (!deviceId || !deviceSecret) {
      throw new CustomException(
        'Both x-device-id and x-device-secret are required together',
        ERROR_CODE.DEVICE_SECRET_INVALID,
        HttpStatus.UNAUTHORIZED,
      );
    }

    const check = await this.deviceService.verifyCredentials(deviceId, deviceSecret);
    if (!check.ok) {
      const [code, message] =
        check.reason === 'EXPIRED'
          ? [ERROR_CODE.DEVICE_EXPIRED, 'Device expired']
          : check.reason === 'NOT_FOUND'
            ? [ERROR_CODE.DEVICE_NOT_FOUND, 'Device not found']
            : [ERROR_CODE.DEVICE_SECRET_INVALID, 'Invalid device secret'];
      throw new CustomException(message, code, HttpStatus.UNAUTHORIZED);
    }

    next();
  }
}
