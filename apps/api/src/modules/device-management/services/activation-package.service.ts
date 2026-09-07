import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import archiver from 'archiver';
import { existsSync, statSync } from 'fs';
import { basename } from 'path';
import { PassThrough } from 'stream';
import { Campaign } from '../entities/campaign.entity';
import { Device } from '../entities/device.entity';

export interface ActivationPayload {
  deviceId: string;
  deviceSecret: string;
  campaignId: string;
  name: string;
  authApiEndpoint?: string;
}

/**
 * Builds the single downloadable zip described in
 * docs/plans/multi-camera-device-management-discussion.md §3.2: the shared
 * app build for whichever OS the registering admin picked (a static
 * directory, copied in as-is — never rebuilt per device) plus this device's
 * own `activation.json`, sitting next to the exe so the app picks it up on
 * first launch with no separate install/copy step. An operator downloads
 * one file per registration and gets everything needed to bring up that
 * kiosk, instead of having to combine two separate downloads themselves.
 */
@Injectable()
export class ActivationPackageService {
  private readonly logger = new Logger(ActivationPackageService.name);

  constructor(private readonly configService: ConfigService) {}

  async buildActivationZip(
    device: Device,
    campaign: Campaign,
    plainSecret: string,
    os: 'mac' | 'win' = 'mac',
  ): Promise<Buffer> {
    const payload: ActivationPayload = {
      deviceId: device.id,
      deviceSecret: plainSecret,
      campaignId: campaign.id,
      name: device.name,
      authApiEndpoint: device.authApiEndpoint,
    };

    const archive = archiver('zip', { zlib: { level: 9 } });
    const output = new PassThrough();
    const chunks: Buffer[] = [];
    output.on('data', (chunk: Buffer) => chunks.push(chunk));
    const done = new Promise<Buffer>((resolve, reject) => {
      output.on('end', () => resolve(Buffer.concat(chunks)));
      archive.on('error', reject);
    });
    archive.pipe(output);

    archive.append(JSON.stringify(payload, null, 2), { name: 'activation.json' });

    // Not configured/found is not an error here — see this class's own doc
    // comment. The registration itself must still succeed so the CMS flow
    // is testable before an ops decision about where builds live is made.
    //
    // 2026-09-07: switched from embedding the NSIS *installer* to embedding
    // the unpacked app folder directly (e.g. electron-builder's
    // `release/win-unpacked/`) — a whole debugging session was lost to the
    // installer-vs-app distinction: the installer is a separate wizard that
    // must be clicked through (Next → Install → Finish) before the real
    // `app.asar` ever runs, and even then `activation.json` would land next
    // to the DOWNLOADED installer, not next to wherever it chose to install
    // the app, so it never actually got picked up on first launch. A kiosk
    // just needs to unzip once and run the exe directly — no installer
    // wizard, no separate copy step.
    //
    // On win, the folder's CONTENTS are flattened straight into the zip
    // root (archiver's `directory(path, false)`) rather than nested under a
    // `win-unpacked/` subfolder — `findAndImportActivationFileIfPresent`
    // looks for `activation.json` in the exe's own directory
    // (`apps/desktop/src/main/secrets.ts`), so it must land next to
    // `Looka.exe`, not one level above it. Mac is NOT flattened: a `.app`
    // bundle is a single atomic unit (`SomeName.app/Contents/...`) that
    // must keep its own top-level name to stay a valid bundle, and no mac
    // build has been produced/tested in this environment yet — revisit
    // this branch together with wherever `secrets.ts` ends up looking for
    // `activation.json` relative to a `.app` bundle before shipping mac.
    const installerPath = this.configService.get<string>(
      os === 'win' ? 'desktopInstaller.pathWin' : 'desktopInstaller.pathMac',
    );
    if (installerPath && existsSync(installerPath)) {
      if (statSync(installerPath).isDirectory()) {
        archive.directory(installerPath, os === 'win' ? false : basename(installerPath));
      } else {
        archive.file(installerPath, { name: basename(installerPath) });
      }
    } else {
      this.logger.warn(
        `DESKTOP_INSTALLER_PATH_${os.toUpperCase()} not set or not found on disk — activation zip will contain activation.json only, no installer.`,
      );
    }

    await archive.finalize();
    return done;
  }
}
