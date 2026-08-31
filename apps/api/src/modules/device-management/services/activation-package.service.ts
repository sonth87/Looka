import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import archiver from 'archiver';
import { existsSync } from 'fs';
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
 * docs/plans/multi-camera-device-management-discussion.md §3.2: the one
 * shared installer (a static file, copied in as-is — never rebuilt per
 * device) plus this device's own `activation.json`. An operator downloads
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
    const installerPath = this.configService.get<string>('desktopInstaller.path');
    if (installerPath && existsSync(installerPath)) {
      archive.file(installerPath, { name: basename(installerPath) });
    } else {
      this.logger.warn(
        'DESKTOP_INSTALLER_PATH not set or not found on disk — activation zip will contain activation.json only, no installer.',
      );
    }

    await archive.finalize();
    return done;
  }
}
