import { Link, useParams } from 'react-router-dom';
import { ReviewDetailContent } from './ReviewDetailContent';

/**
 * "Duyệt ảnh" detail page, route `/review/:id`. As of 2026-09-09 this is no
 * longer how `ReviewListPage`'s cards open a photo set — the product ask
 * ("chỉ cần hiển thị modal ảnh, không cần next page") moved that to
 * `ReviewDetailModal` instead. This full-page route is kept registered
 * (App.tsx) as a fallback/deep-link: nothing in this codebase currently
 * constructs a `/review/:id` link on its own, but it costs nothing to keep
 * working for anyone who already bookmarked or shared one, or for a future
 * caller (e.g. a notification) that wants a real standalone URL rather than
 * a modal that only exists while the list page is mounted. All the actual
 * fetch/action logic lives in `ReviewDetailContent`, shared with the modal
 * so the two never drift apart.
 */
export function ReviewDetailPage() {
  const { id } = useParams<{ id: string }>();

  return (
    <div>
      <Link to="/review" className="text-gray-500 hover:text-gray-700 mb-4 inline-block text-sm">
        ← Danh sách
      </Link>

      {id ? <ReviewDetailContent id={id} /> : <p className="text-gray-500">Đang tải...</p>}
    </div>
  );
}
