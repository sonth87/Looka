import { toDao } from '@app/shared/http/to-dao.helper';
import { CustomException, ERROR_CODE } from '@app/shared/errors/legacy';
import { CommonService } from '@app/shared/common/common.service';
import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DeviceDao, SelfEnrollDeviceDao } from '../dao';
import { CreateDeviceDto, ReissueDeviceDto, SelfEnrollDeviceDto } from '../dto';
import { Device, DeviceStatus } from '../entities/device.entity';
import {
  generateDeviceSecret,
  hashDeviceSecret,
  verifyDeviceSecret,
} from './device-secret.util';
import { CampaignService } from './campaign.service';

export type DeviceCredentialCheck =
  | { ok: true; device: Device }
  | {
      ok: false;
      reason: 'NOT_FOUND' | 'INVALID_SECRET' | 'EXPIRED' | 'REVOKED';
    };

/**
 * Maps a failed `DeviceCredentialCheck.reason` to the `CustomException` both
 * `DeviceCredentialsGuard` and `DeviceExpiryMiddleware` must throw — shared
 * here instead of duplicated in each so the two authentication paths can
 * never drift apart on which `ERROR_CODE` a given reason maps to. Always
 * 401: even `NOT_FOUND` is treated as an auth failure at this boundary
 * (never leaking "does this id exist" beyond "your credentials don't work"),
 * matching both callers' existing behavior.
 *
 * The resulting body (`HttpExceptionFilter` → `HttpResponseError`) is
 * `{ errorCode, message }` — the kiosk (`apps/desktop/src/main/deviceApi.ts`)
 * reads `errorCode` to tell "your secret was rotated, get the new package"
 * (5005) apart from "you were revoked, contact an admin" (5008) apart from
 * "your campaign expired" (5003), which a bare `UnauthorizedException`
 * (falls into `HttpExceptionFilter`'s default branch as `errorCode: 401`)
 * could never distinguish.
 */
export function deviceCredentialFailure(
  reason: 'NOT_FOUND' | 'INVALID_SECRET' | 'EXPIRED' | 'REVOKED',
): CustomException {
  switch (reason) {
    case 'NOT_FOUND':
      return new CustomException(
        'Device not found',
        ERROR_CODE.DEVICE_NOT_FOUND,
        HttpStatus.UNAUTHORIZED,
      );
    case 'EXPIRED':
      return new CustomException(
        'Device expired',
        ERROR_CODE.DEVICE_EXPIRED,
        HttpStatus.UNAUTHORIZED,
      );
    case 'REVOKED':
      return new CustomException(
        'Device revoked',
        ERROR_CODE.DEVICE_REVOKED,
        HttpStatus.UNAUTHORIZED,
      );
    case 'INVALID_SECRET':
      return new CustomException(
        'Invalid device secret',
        ERROR_CODE.DEVICE_SECRET_INVALID,
        HttpStatus.UNAUTHORIZED,
      );
  }
}

@Injectable()
export class DeviceService extends CommonService<Device> {
  constructor(
    @InjectRepository(Device)
    repository: Repository<Device>,
    private readonly campaignService: CampaignService,
  ) {
    super(repository);
  }

  /**
   * Creates the device row and returns the plaintext secret exactly once —
   * only `ActivationPackageService` (called right after this, in the same
   * request) ever sees it. Nothing persists the plaintext; only its hash is
   * stored, so a lost activation zip cannot be recovered, only reissued via
   * a fresh registration.
   *
   * `requestApiBaseUrl` (2026-09-07): the admin no longer has to type the
   * kiosk-facing API address into the CMS form — the controller derives it
   * from the very request the admin's own browser is already making
   * (`req.protocol`/`req.get('host')`), and it's used here only when the
   * admin didn't explicitly override `dto.authApiEndpoint`. This is still
   * only a best guess (it reflects wherever the ADMIN'S browser reached the
   * API from, which is wrong if a kiosk is on a different network path —
   * e.g. the admin using `localhost` while the kiosk is a separate physical
   * machine), so `dto.authApiEndpoint` stays a real override for that case,
   * not a rubber-stamped field.
   */
  async registerDevice(
    campaignId: string,
    dto: CreateDeviceDto,
    // Defaults to '' for callers that don't care (existing tests) — the
    // controller always passes the real derived value; see this param's
    // own doc comment above.
    requestApiBaseUrl = '',
  ): Promise<{ device: Device; plainSecret: string }> {
    await this.campaignService.findCampaignEntityOrFail(campaignId);

    const plainSecret = generateDeviceSecret();
    const device = await this.create({
      campaignId,
      name: dto.name,
      authApiEndpoint: dto.authApiEndpoint?.trim() || requestApiBaseUrl,
      deviceSecretHash: hashDeviceSecret(plainSecret),
      status: DeviceStatus.REGISTERED,
    });

    return { device, plainSecret };
  }

  /**
   * `POST /v1/devices/self-enroll` (§3.3) — user-token, no campaign. Looks
   * the calling machine up by `fingerprint`:
   *
   * - **Found** (same machine, logging in again — possibly a different
   *   user): rotates its secret WITH OVERLAP, mirroring exactly the
   *   "keep the secret a running kiosk actually uses alive" pattern
   *   `reissueDevice` already implements (same pitfall this shares with
   *   it: `deviceSecretHash`/`previousSecretHash` are `select: false`, so
   *   they must be asked for explicitly). Updates `lastUserId` and
   *   `hostname` (the machine's reported name may have changed since);
   *   `enrolledByUserId`/`campaignId` are left untouched — this is a
   *   returning device, not a new registration. Refuses (409) a REVOKED
   *   device rather than silently letting self-enroll undo an admin's
   *   explicit "Thu hồi" — that action stays admin-only, via `reissueDevice`.
   * - **Not found**: creates a brand-new row, `campaignId: null` (chosen at
   *   login/session time instead, §3.9), `enrolledByUserId`/`lastUserId`
   *   both set to the calling user, secret generated the same way
   *   `registerDevice` does.
   *
   * Returns the plaintext secret exactly once, same rule as
   * `registerDevice`/`reissueDevice` — nothing persists it, only its hash.
   */
  async selfEnroll(
    dto: SelfEnrollDeviceDto,
    userId: string,
    requestApiBaseUrl = '',
  ): Promise<SelfEnrollDeviceDao> {
    // Fails clearly here rather than storing a campaignId that later 404s
    // out of GET /v1/devices/config with no obvious cause.
    if (dto.campaignId) {
      await this.campaignService.findCampaignEntityOrFail(dto.campaignId);
    }

    const existing = await this.repository.findOne({
      where: { fingerprint: dto.fingerprint },
      select: {
        id: true,
        campaignId: true,
        name: true,
        authApiEndpoint: true,
        status: true,
        deviceSecretHash: true,
        previousSecretHash: true,
      },
    });

    if (existing) {
      if (existing.status === DeviceStatus.REVOKED) {
        throw new CustomException(
          'This device was revoked — an admin must reissue it before it can self-enroll again',
          ERROR_CODE.DEVICE_FINGERPRINT_REVOKED,
          HttpStatus.CONFLICT,
        );
      }

      const plainSecret = generateDeviceSecret();
      const patch: Partial<Device> = {
        deviceSecretHash: hashDeviceSecret(plainSecret),
        previousSecretHash:
          existing.previousSecretHash ?? existing.deviceSecretHash,
        secretRotatedAt: new Date(),
        hostname: dto.hostname,
        lastUserId: userId,
        // Re-attaches whichever campaign the operator picked this time —
        // see the DTO's own doc comment for why this is how a kiosk that
        // capture-for a different campaign than before gets updated.
        // Omitted (undefined) leaves the existing value untouched.
        ...(dto.campaignId !== undefined ? { campaignId: dto.campaignId } : {}),
      };
      await this.update(existing.id, patch);

      const apiBaseUrl = existing.authApiEndpoint || requestApiBaseUrl;
      const campaignId = dto.campaignId ?? existing.campaignId ?? null;
      return { deviceId: existing.id, deviceSecret: plainSecret, apiBaseUrl, campaignId };
    }

    const plainSecret = generateDeviceSecret();
    const device = await this.create({
      campaignId: dto.campaignId ?? null,
      name: dto.hostname,
      hostname: dto.hostname,
      fingerprint: dto.fingerprint,
      authApiEndpoint: requestApiBaseUrl,
      deviceSecretHash: hashDeviceSecret(plainSecret),
      status: DeviceStatus.REGISTERED,
      enrolledByUserId: userId,
      lastUserId: userId,
    });

    return {
      deviceId: device.id,
      deviceSecret: plainSecret,
      apiBaseUrl: requestApiBaseUrl,
      campaignId: dto.campaignId ?? null,
    };
  }

  /**
   * Rotates an existing device's secret WITH OVERLAP (2026-09-08 fix for the
   * "kiosk 3" incident — see docs/ROADMAP.md's dated entry): same
   * id/name/history, only `deviceSecretHash`/`previousSecretHash`/
   * `secretRotatedAt` (and, optionally, `authApiEndpoint`) change. This is
   * the only way to get a device a usable activation package again once the
   * original zip is gone (tab closed, download failed, etc.), since the
   * plaintext secret is never persisted and therefore cannot simply be
   * re-sent — see this class's own doc comment on `registerDevice`.
   *
   * Unlike the old behavior, this no longer kills whatever secret a running
   * kiosk currently has loaded: that secret (tracked as `previousSecretHash`)
   * stays valid — no time limit — until either the *new* secret is used
   * successfully once (`verifyCredentials` clears it) or an admin explicitly
   * calls `revokeDevice`. That is what makes clicking "Tải gói kích hoạt" a
   * second time for an already-running kiosk harmless instead of a silent
   * 401 lockout (the actual incident this fixes).
   *
   * "Keep the secret the kiosk is actually running" rule: if
   * `previousSecretHash` is already set (an earlier reissue's new secret was
   * never used), it is left untouched — that intermediate, never-loaded
   * secret is the one that dies here, not the one the kiosk is live on.
   * Only when `previousSecretHash` is still null does the *current* hash
   * move into it.
   *
   * **Verified pitfall**: `findDeviceEntityOrFail` does not select
   * `select:false` columns, so a naive `previousSecretHash = device.deviceSecretHash`
   * would read `undefined` — and TypeORM's `save()` silently skips
   * `undefined` properties, so the overlap would never actually persist.
   * This loads the row with an explicit `select` (same pattern as
   * `verifyCredentials` below) and writes via `CommonService.update()`
   * rather than `save()` of a partially-loaded entity, for the same reason.
   *
   * `status`/`activatedAt` (2026-09-07, changed by product request — "chỉ
   * cần tải gói chứ không cần phải thiết lập lại kích hoạt"): only reset to
   * REGISTERED/`null` when the device was NOT already ACTIVATED — a device
   * that was already running is left showing ACTIVATED across the reissue.
   * A REVOKED device reissued this way goes back to REGISTERED (it has no
   * "was activated" state worth preserving across a revoke), clearing
   * `revokedAt` — this is the normal "cấp gói kích hoạt mới" path back in
   * after a "Thu hồi".
   */
  async reissueDevice(
    id: string,
    dto: ReissueDeviceDto,
    requestApiBaseUrl = '',
  ): Promise<{ device: Device; plainSecret: string }> {
    const device = await this.repository.findOne({
      where: { id },
      select: {
        id: true,
        campaignId: true,
        name: true,
        authApiEndpoint: true,
        status: true,
        deviceSecretHash: true,
        previousSecretHash: true,
      },
    });
    if (!device) {
      throw new CustomException(
        'Device not found',
        ERROR_CODE.DEVICE_NOT_FOUND,
        HttpStatus.NOT_FOUND,
      );
    }

    const plainSecret = generateDeviceSecret();
    const patch: Partial<Device> = {
      deviceSecretHash: hashDeviceSecret(plainSecret),
      previousSecretHash: device.previousSecretHash ?? device.deviceSecretHash,
      secretRotatedAt: new Date(),
      revokedAt: null,
    };
    if (device.status !== DeviceStatus.ACTIVATED) {
      patch.status = DeviceStatus.REGISTERED;
      patch.activatedAt = null;
    }
    if (dto.authApiEndpoint !== undefined) {
      patch.authApiEndpoint = dto.authApiEndpoint;
    } else if (!device.authApiEndpoint) {
      patch.authApiEndpoint = requestApiBaseUrl;
    }
    await this.update(id, patch);

    return { device: { ...device, ...patch }, plainSecret };
  }

  /**
   * Explicit "Thu hồi" (revoke) — 2026-09-08, the harder counterpart to
   * `reissueDevice`'s soft, overlapping rotation above: invalidates BOTH the
   * current and previous secret immediately, no overlap, no grace period.
   * The right action when an admin actually wants a kiosk locked out right
   * now (lost/stolen device, decommissioned kiosk), as opposed to just
   * wanting a fresh copy of the activation package.
   *
   * One `update()`: flips `status` to REVOKED, stamps `revokedAt`, clears
   * the overlap pair (`previousSecretHash`/`secretRotatedAt` — there is
   * nothing to overlap with once revoked), and — defense in depth, in case
   * anything ever reads `deviceSecretHash` without checking `status` first —
   * overwrites it with the hash of a secret nobody was ever given.
   */
  async revokeDevice(id: string): Promise<DeviceDao> {
    await this.findDeviceEntityOrFail(id);
    const patch: Partial<Device> = {
      status: DeviceStatus.REVOKED,
      revokedAt: new Date(),
      previousSecretHash: null,
      secretRotatedAt: null,
      deviceSecretHash: hashDeviceSecret(generateDeviceSecret()),
    };
    await this.update(id, patch);
    return this.findDeviceOrFail(id);
  }

  /**
   * Manually marks a device ACTIVATED from the CMS (2026-09-07 product
   * request) — normally `verifyCredentials` below is the only thing that
   * flips this, the moment a real kiosk's first `GET /v1/devices/config`
   * succeeds. This exists for testing/ops purposes when an admin wants the
   * device to read as activated without waiting for (or without ever
   * having) a real kiosk call in. Deliberately does NOT touch
   * `deviceSecretHash` — unlike `reissueDevice`, this never invalidates
   * whatever credentials are already out there.
   *
   * Refuses a REVOKED device (2026-09-08): manually flipping the CMS badge
   * back to ACTIVATED without going through `reissueDevice` would make the
   * CMS lie — the device's only stored secret at that point is the
   * `revokeDevice` decoy nobody was ever given, so no kiosk could actually
   * be running successfully. Reissuing (which clears REVOKED back to
   * REGISTERED) is the only way back in.
   */
  async activateDevice(id: string): Promise<DeviceDao> {
    const device = await this.findDeviceEntityOrFail(id);
    if (device.status === DeviceStatus.REVOKED) {
      throw new CustomException(
        'Device is revoked',
        ERROR_CODE.DEVICE_REVOKED,
        HttpStatus.CONFLICT,
      );
    }
    device.status = DeviceStatus.ACTIVATED;
    device.activatedAt = new Date();
    await this.save(device);
    return toDao(DeviceDao, device);
  }

  async findAllByCampaign(campaignId: string): Promise<DeviceDao[]> {
    await this.campaignService.findCampaignEntityOrFail(campaignId);
    const devices = await this.findAll({
      where: { campaignId },
      order: { createdAt: 'DESC' },
    });
    return toDao(DeviceDao, devices);
  }

  async findDeviceEntityOrFail(id: string): Promise<Device> {
    const device = await this.findOne({
      where: { id },
      relations: { campaign: true },
    });
    if (!device) {
      throw new CustomException(
        'Device not found',
        ERROR_CODE.DEVICE_NOT_FOUND,
        HttpStatus.NOT_FOUND,
      );
    }
    return device;
  }

  async findDeviceOrFail(id: string): Promise<DeviceDao> {
    return toDao(DeviceDao, await this.findDeviceEntityOrFail(id));
  }

  /**
   * The check every authenticated kiosk request ultimately reduces to (see
   * docs/plans/multi-camera-device-management-discussion.md §3.3): does
   * `deviceId`/`secret` resolve to a real, non-expired, non-revoked device?
   * `deviceSecretHash`/`previousSecretHash` both have `select: false` on the
   * entity, so they must be asked for explicitly here — every other read
   * path in this service never sees them.
   *
   * Order (2026-09-08, "secret rotation with overlap" — see
   * docs/ROADMAP.md's dated entry):
   *   1. no row → `NOT_FOUND`.
   *   2. `status === REVOKED` → `REVOKED` (checked before any secret compare —
   *      a revoked device's stored `deviceSecretHash` is a decoy nobody was
   *      ever given, but REVOKED must win over INVALID_SECRET regardless).
   *   3. current hash matches → OK; if `previousSecretHash` was set, this is
   *      the kiosk finally loading the new package — clear it (and
   *      `secretRotatedAt`) since the rotation this represents is now complete.
   *   4. else, `previousSecretHash` set and matches → OK, but do NOT clear —
   *      the kiosk is still running the old secret, the overlap continues.
   *   5. else → `INVALID_SECRET`.
   *   6. only now, campaign expiry → `EXPIRED` — kept after the secret check
   *      (unchanged from before) so a wrong secret on an expired campaign
   *      still reads as INVALID_SECRET, not EXPIRED.
   *
   * Bookkeeping: exactly one `update()` on success (`lastAuthAt` + the
   * REGISTERED→ACTIVATED flip + clearing `previousSecretHash`/`secretRotatedAt`
   * when applicable) and exactly one `update()` on failure other than
   * NOT_FOUND (`lastAuthFailedAt`/`lastAuthFailReason`) — this runs on the
   * kiosk's hot path (once per session/config fetch, events ≤ every 15s), so
   * it deliberately never does more than one write per call.
   */
  async verifyCredentials(
    deviceId: string,
    secret: string,
  ): Promise<DeviceCredentialCheck> {
    const device = await this.repository.findOne({
      where: { id: deviceId },
      relations: { campaign: true },
      select: {
        id: true,
        campaignId: true,
        deviceSecretHash: true,
        previousSecretHash: true,
        status: true,
        campaign: { id: true, expiresAt: true },
      },
    });
    if (!device) return { ok: false, reason: 'NOT_FOUND' };

    const fail = async (
      reason: 'INVALID_SECRET' | 'EXPIRED' | 'REVOKED',
    ): Promise<DeviceCredentialCheck> => {
      await this.update(device.id, {
        lastAuthFailedAt: new Date(),
        lastAuthFailReason: reason,
      });
      return { ok: false, reason };
    };

    if (device.status === DeviceStatus.REVOKED) {
      return fail('REVOKED');
    }

    let rotationCompleted = false;
    if (verifyDeviceSecret(secret, device.deviceSecretHash)) {
      rotationCompleted = device.previousSecretHash != null;
    } else if (
      device.previousSecretHash != null &&
      verifyDeviceSecret(secret, device.previousSecretHash)
    ) {
      // Kiosk is still running the pre-rotation secret — valid, but the
      // overlap isn't resolved yet, so previousSecretHash/secretRotatedAt
      // are left as-is.
    } else {
      return fail('INVALID_SECRET');
    }

    const expiresAt = device.campaign?.expiresAt;
    if (expiresAt && expiresAt.getTime() <= Date.now()) {
      return fail('EXPIRED');
    }

    const patch: Partial<Device> = { lastAuthAt: new Date() };
    if (rotationCompleted) {
      patch.previousSecretHash = null;
      patch.secretRotatedAt = null;
    }
    // First successful call is what "activation" means — the kiosk has
    // proven it actually loaded the file, not just that CMS created a row.
    if (device.status === DeviceStatus.REGISTERED) {
      patch.status = DeviceStatus.ACTIVATED;
      patch.activatedAt = new Date();
    }
    await this.update(device.id, patch);

    return { ok: true, device: { ...device, ...patch } };
  }
}
