import { CustomException, ERROR_CODE } from '@app/common/errors';
import type { Visibility } from '@face/core';
import { FsClient, FsError } from '@face/fs-client';
import type { FsFileInfo, UpdateResult } from '@face/fs-client';
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
  // Per-tenant clients for kiosk photos (A.7) - lazily provisioned and kept
  // for the life of the process. FsClient.provision() is idempotent per
  // tenant name, so re-provisioning would just return the same key at the
  // cost of a round trip; caching avoids that on every view-link/delete.
  private readonly tenantClients = new Map<string, FsClient>();

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
    const contactEmail = this.configService.get<string>(
      'fileService.contactEmail',
    );
    const provisioned = await FsClient.provision(baseUrl, tenant, {
      contactEmail,
    });
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
    visibility?: Visibility;
  }) {
    return this.client.uploadRaw(input);
  }

  /**
   * Release a chunked session's quota hold instead of waiting for it to
   * expire on its own. Best-effort — the caller decides whether a failure
   * here should stop anything else.
   */
  cancelUpload(uploadId: string) {
    return this.client.cancelUpload(uploadId);
  }

  /** Current scan/lifecycle state for a file already accepted by the server. */
  getFile(fileId: string): Promise<FsFileInfo> {
    return this.client.getFile(fileId);
  }

  /**
   * Overwrite an existing file's content in place (new version, same
   * `virtual_path`/`fileId`) - used by `UploadWorkerService` to resolve an
   * `ALREADY_REGISTERED` conflict on a flat, session-agnostic virtual path
   * (e.g. a kiosk retake landing on the same `students/<CCCD>/...` path an
   * earlier session already registered - see that service's own doc comment
   * for the live-confirmed scenario this closes). `uploadRaw`/`upload`
   * always POST a brand-new file and can never repair this themselves: the
   * server keys `virtual_path` uniqueness ahead of `Idempotency-Key`, so a
   * second session's genuinely different key is rejected outright rather
   * than treated as a silent overwrite.
   */
  updateContent(
    fileId: string,
    input: { etag: string; data: Uint8Array; mimeType: string },
  ): Promise<UpdateResult> {
    return this.client.updateContent(fileId, input);
  }

  /**
   * Lazily provisions (and caches) an `FsClient` scoped to one tenant - used
   * for kiosk photos, whose tenant name is the device id (A.7, plan D4).
   * This is the same idempotent self-service call the kiosk itself makes at
   * first boot, so a device that has already provisioned its own key just
   * gets that key back here; nothing is provisioned twice.
   */
  async clientForTenant(tenantName: string): Promise<FsClient> {
    const cached = this.tenantClients.get(tenantName);
    if (cached) return cached;

    const baseUrl = this.configService.get<string>('fileService.baseUrl')!;
    const contactEmail = this.configService.get<string>(
      'fileService.contactEmail',
    );

    try {
      const provisioned = await FsClient.provision(baseUrl, tenantName, {
        contactEmail,
      });
      const client = new FsClient({ baseUrl, apiKey: provisioned.apiKey });
      this.tenantClients.set(tenantName, client);
      return client;
    } catch (error) {
      // Most likely cause in practice: this API host is outside
      // FS_PROVISION_ALLOW_CIDR (403) - a network placement problem, not
      // something worth retrying on its own. The tenant name is logged so
      // an operator can tell which device tripped it.
      const message =
        error instanceof FsError ? error.message : (error as Error).message;
      this.logger.warn(
        `clientForTenant failed for tenant "${tenantName}": ${message}`,
      );
      throw new CustomException(
        message,
        ERROR_CODE.FILE_STORAGE_UPSTREAM_ERROR,
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }

  /**
   * A URL the browser can load, without the API key going with it.
   *
   * The key covers the whole namespace: anyone holding it can read and write
   * every file this service owns, not only the photo they asked for.
   * Permission is checked when the link is opened, against `viewerId` rather
   * than against this process.
   *
   * `tenantName` selects a per-device client for a kiosk photo (A.7);
   * omitted, this uses the default tenant every web-path photo lives under.
   */
  async issueViewLink(
    fileId: string,
    viewerId: string,
    tenantName?: string,
  ): Promise<PhotoViewLink> {
    const client = tenantName
      ? await this.clientForTenant(tenantName)
      : this.client;
    try {
      await client.waitUntilReady(fileId, {
        timeoutMs: 30_000,
        pollMs: 2_000,
      });
      const link = await client.issueDownloadLink(fileId, viewerId, 600, true);
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

  /**
   * Removes a file from the file-service. Used by
   * `SessionService.completeSession` for a superseded attempt that already
   * reached the file-service before the operator approved a different one
   * (A.4). Best-effort — the caller decides whether a failure here should
   * stop anything else, same as `cancelUpload`.
   */
  async deleteFile(fileId: string, tenantName?: string): Promise<void> {
    const client = tenantName
      ? await this.clientForTenant(tenantName)
      : this.client;
    await client.deleteFile(fileId);
  }
}
