export const USER_DIRECTORY_CLIENT = Symbol('USER_DIRECTORY_CLIENT');

export interface DirectoryUserRecord {
  email: string;
  displayName: string;
  title?: string | null;
  code?: string | null;
  phone?: string | null;
}

/**
 * Port for the external "danh bạ cán bộ" (admin directory) —
 * cms-8-screens-api-plan.md §2.8 D-Q10, still awaiting a real spec from
 * the university side ("hiện tại chỉ thêm tay, viết hàm để call api lấy
 * thông tin, api sau tôi sẽ cung cấp đường dẫn" — the user's own words).
 * `application/` depends only on this interface; the concrete adapter
 * (`infrastructure/integrations/user-directory.client.ts`) is swapped in
 * by `IdentityModule` — same seam `shared/integrations` uses for
 * fs-core/sidecar/SSO (backend-layering-plan.md §3), just module-local
 * since this port has no other consumer yet.
 */
export interface IUserDirectoryClient {
  /**
   * Throws `UserDirectoryNotConfiguredError` when `USER_DIRECTORY_URL` is
   * unset — a caller decides whether that is a hard failure or a
   * "nothing to do yet" no-op (`SyncUsersHandler` treats it as the
   * latter).
   */
  fetchAll(): Promise<DirectoryUserRecord[]>;
}

export class UserDirectoryNotConfiguredError extends Error {
  constructor() {
    super(
      'USER_DIRECTORY_URL is not set — the admin directory API spec has not been provided yet (D-Q10).',
    );
    this.name = 'UserDirectoryNotConfiguredError';
  }
}
