import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DirectoryUserRecord,
  IUserDirectoryClient,
  UserDirectoryNotConfiguredError,
} from '../../application/ports/user-directory.port';

/**
 * Stub adapter — no real API to call against yet (D-Q10). Written so that
 * once a real spec exists, only THIS file's `fetchAll()` body needs to
 * change (the field-mapping logic below is a best-effort guess at a
 * generic directory shape and is explicitly expected to be rewritten, not
 * extended): the port, the command, the handler, and both controller
 * routes stay as-is.
 */
@Injectable()
export class UserDirectoryClient implements IUserDirectoryClient {
  private readonly logger = new Logger(UserDirectoryClient.name);

  constructor(private readonly configService: ConfigService) {}

  async fetchAll(): Promise<DirectoryUserRecord[]> {
    const baseUrl = this.configService.get<string>('USER_DIRECTORY_URL');
    if (!baseUrl) {
      throw new UserDirectoryNotConfiguredError();
    }
    const apiKey = this.configService.get<string>('USER_DIRECTORY_API_KEY');

    this.logger.log(`Fetching admin directory from ${baseUrl}`);
    const response = await fetch(baseUrl, {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
    });
    if (!response.ok) {
      throw new Error(`Admin directory API returned HTTP ${response.status}`);
    }

    const body: unknown = await response.json();
    const rows = Array.isArray(body)
      ? body
      : Array.isArray((body as { data?: unknown })?.data)
        ? (body as { data: unknown[] }).data
        : [];

    // Best-effort field mapping — no real schema to conform to yet;
    // several plausible key spellings are tried per field so this does not
    // silently return zero rows against a slightly different but
    // recognizable shape. Replace once the real API spec arrives.
    return rows
      .map((raw): DirectoryUserRecord | null => {
        const row = raw as Record<string, unknown>;
        const email = firstString(row, ['email', 'Email', 'mail']);
        if (!email) return null;
        return {
          email,
          displayName:
            firstString(row, [
              'displayName',
              'full_name',
              'fullName',
              'name',
            ]) ?? email,
          title: firstString(row, ['title', 'position', 'chuc_danh']),
          code: firstString(row, ['code', 'employee_code', 'ma_can_bo']),
          phone: firstString(row, ['phone', 'phone_number', 'so_dien_thoai']),
        };
      })
      .filter((r): r is DirectoryUserRecord => r !== null);
  }
}

function firstString(
  row: Record<string, unknown>,
  keys: string[],
): string | undefined {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}
