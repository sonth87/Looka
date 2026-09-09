import { ReviewDetailContent } from './ReviewDetailContent';

/**
 * Centered modal wrapper around `ReviewDetailContent` (2026-09-09) —
 * replaces `ReviewListPage`'s previous `<Link to={`/review/${id}`}>` full
 * page navigation, per the product ask: "vieww ảnh trên cms duyệt ảnh chỉ
 * cần hiển thị modal ảnh là được không cần next page" (viewing a set's
 * detail should just open a modal, not a separate page).
 *
 * Chrome is composed from two existing patterns in this CMS rather than a
 * new one:
 *  - The centered backdrop/panel look (`fixed inset-0` overlay, `bg-black/30`
 *    click-to-close backdrop, centered `rounded-2xl`/`shadow-xl` panel) is
 *    `CampaignDangerActions.tsx`'s `ModalShell`, just widened — `ModalShell`
 *    itself hardcodes `max-w-md`, too narrow for this page's 3-column
 *    original/current/versions grid, so this doesn't reuse the component
 *    directly, only its visual language.
 *  - The header ✕ button + Escape-to-close (`SessionDetailDrawer` /
 *    `CampaignStudentsPanel`'s `StudentDetailDrawer`) — `ModalShell` itself
 *    has neither, only backdrop-click. The Escape listener lives inside
 *    `ReviewDetailContent` (it owns the nested AI-edit/upload/reject/
 *    lightbox overlay state needed to guard it — see that file's header
 *    comment), mirroring `StudentDetailDrawer`'s own
 *    `!openSessionId` guard against Escape closing the outer panel while an
 *    inner one is open. The ✕ button and backdrop click below close
 *    unconditionally, same as `StudentDetailDrawer`.
 */
export function ReviewDetailModal({ id, onClose }: { id: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-full max-w-5xl max-h-[90vh] overflow-y-auto bg-white rounded-2xl shadow-xl p-6 pr-12">
        <button
          type="button"
          onClick={onClose}
          aria-label="Đóng"
          className="absolute top-3 right-3 text-gray-400 hover:text-gray-600 text-xl leading-none px-2 py-1 rounded-full hover:bg-gray-100"
        >
          ✕
        </button>
        <ReviewDetailContent id={id} onClose={onClose} />
      </div>
    </div>
  );
}
