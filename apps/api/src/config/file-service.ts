import { registerAs } from '@nestjs/config';

/**
 * The file-service holding actual photo bytes. Mirrors the shape of `r2.ts`
 * in the reference CMS: one file per external storage provider, read via
 * ConfigService rather than `process.env` directly at the call site.
 *
 * The key is namespace-wide - anyone holding it can read and write every file
 * this tenant owns - so it lives only here, read once at startup, and is never
 * echoed back to a client. See the integration guide, section 2.
 */
export const fileService = registerAs('fileService', () => ({
  baseUrl: process.env.FS_BASE_URL,
  tenant: process.env.FS_TENANT ?? 'looka-face-capture',
  // Left empty on purpose when unset: FileStorageService then obtains one via
  // self-service provisioning at startup, which is idempotent per tenant name.
  apiKey: process.env.FS_API_KEY ?? '',
  // Only read when actually provisioning (apiKey above is empty) — the
  // file-service self-service endpoint records this as the tenant's contact
  // for the camera capture pipeline. Fixed default matches the operational
  // mailbox this deployment reports under; override via env only if a given
  // environment needs a different tenant contact.
  contactEmail: process.env.FS_CONTACT_EMAIL ?? 'camera@dainam.edu.vn',
}));
