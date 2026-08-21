import { CustomException, ERROR_CODE } from '@app/common/errors';
import { FsClient, FsError } from '@face/fs-client';
import { HttpStatus, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface PhotoViewLink {
  url: string;
  viewUrl?: string;
  expiresAt: string;
}

/**
 * Thin wrapper around the provisioned `FsClient` - same role
 * `R2UploadService` plays over the raw `S3Client` in the reference CMS.
 *
 * Builds its own client in `onModuleInit` rather than through an async
 * factory provider in the module file: Nest awaits lifecycle hooks the same
 * way it awaits an async factory during bootstrap, so a deployment pointing
 * at nothing still fails at boot, not on the first upload - this just keeps
 * the construction logic next to the service that owns it.
 */
@Injectable()
export class FileStorageService implements OnModuleInit {
  private readonly logger = new Logger(FileStorageService.name);
  private client!: FsClient;

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit(): Promise<void> {
    const baseUrl = this.configService.get<string>('fileService.baseUrl');
    if (!baseUrl) {
      throw new Error('FS_BASE_URL is not set. See apps/api/.env.example.');
    }

    const configuredKey = this.configService.get<string>('fileService.apiKey');
    if (configuredKey) {
      this.client = new FsClient({ baseUrl, apiKey: configuredKey });
      return;
    }

    // Provisioning is keyed by tenant name and returns the same key every
    // time, so asking at startup is safe and saves an operator copying a
    // secret by hand.
    const tenant = this.configService.get<string>('fileService.tenant')!;
    const provisioned = await FsClient.provision(baseUrl, tenant);
    this.logger.log(
      `provisioned key for "${tenant}" in ${provisioned.namespace ?? 'unknown namespace'}`,
    );
    this.client = new FsClient({ baseUrl, apiKey: provisioned.apiKey });
  }

  /** Send raw bytes. Always chunked for anything past the direct-upload ceiling - see FsClient. */
  uploadRaw(input: {
    virtualPath: string;
    mimeType: string;
    data: Uint8Array;
    idempotencyKey: string;
  }) {
    return this.client.uploadRaw(input);
  }

  /**
   * A URL the browser can load, without the API key going with it.
   *
   * The key covers the whole namespace: anyone holding it can read and write
   * every file this service owns, not only the photo they asked for.
   * Permission is checked when the link is opened, against `viewerId` rather
   * than against this process.
   */
  async issueViewLink(
    fileId: string,
    viewerId: string,
  ): Promise<PhotoViewLink> {
    try {
      await this.client.waitUntilReady(fileId, {
        timeoutMs: 30_000,
        pollMs: 2_000,
      });
      const link = await this.client.issueDownloadLink(
        fileId,
        viewerId,
        600,
        true,
      );
      return {
        url: link.url,
        viewUrl: link.viewUrl,
        expiresAt: link.expiresAt,
      };
    } catch (error) {
      if (error instanceof FsError) {
        this.logger.warn(`view-link failed for ${fileId}: ${error.message}`);
        throw new CustomException(
          error.message,
          ERROR_CODE.FILE_STORAGE_UPSTREAM_ERROR,
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      }
      throw error;
    }
  }
}
