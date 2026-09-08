/**
 * Message the kiosk shows on the §3.3 device-blocked overlay
 * (`FaceCaptureApp.tsx`) when `deviceBlockedReason === 'unauthorized'` —
 * extracted so the reason-to-copy mapping is unit-testable without React or
 * a DOM, same as `recordingGate.ts` in this directory.
 *
 * Exists for the 2026-09-08 "kiosk 3" incident fix: every 401 used to render
 * one undifferentiated "đã hết hạn hoặc bị thu hồi" message, which sent the
 * operator looking at campaign expiry when the real cause was a rotated
 * device secret (`apps/desktop`'s `deviceAuth.ts` decodes `apps/api`'s
 * `errorCode` into the same reason union this switches on — kept as a local
 * copy here rather than an import, since `packages/ui` cannot depend on
 * `apps/desktop`).
 */
export type DeviceRejectReason = 'INVALID_SECRET' | 'NOT_FOUND' | 'EXPIRED' | 'REVOKED' | 'UNKNOWN';

/** The pre-2026-09-08 generic message — kept as the fallback for 'UNKNOWN' and no reason at all (an old API, or a body that failed to parse). */
export const GENERIC_UNAUTHORIZED_MESSAGE =
  'Thiết bị này không còn được phép hoạt động (đã hết hạn hoặc bị thu hồi). Vui lòng liên hệ quản trị viên.';

const MESSAGE_BY_REASON: Record<Exclude<DeviceRejectReason, 'UNKNOWN'>, string> = {
  INVALID_SECRET:
    'Gói kích hoạt trên máy này không còn hợp lệ — mã bí mật của thiết bị đã được cấp lại trên CMS. ' +
    'Tải gói kích hoạt mới từ CMS, chép file activation.json vào cạnh file chạy Looka rồi mở lại ứng dụng.',
  REVOKED: 'Thiết bị này đã bị thu hồi quyền trên CMS. Liên hệ quản trị viên để được cấp gói kích hoạt mới.',
  EXPIRED: 'Chiến dịch của thiết bị này đã hết hạn. Vui lòng liên hệ quản trị viên.',
  NOT_FOUND: 'Thiết bị này không còn tồn tại trên CMS. Vui lòng liên hệ quản trị viên.',
};

/**
 * Picks the overlay message for an `'unauthorized'` block. `reason` is
 * `undefined` for an app build that predates `rejectReason` reaching this
 * far, or a `getDeviceAccessStatus()` call that returned no config at all —
 * both fall back to the same generic message as `'UNKNOWN'`.
 */
export function deviceUnauthorizedMessage(reason: DeviceRejectReason | null | undefined): string {
  if (!reason || reason === 'UNKNOWN') return GENERIC_UNAUTHORIZED_MESSAGE;
  return MESSAGE_BY_REASON[reason];
}
