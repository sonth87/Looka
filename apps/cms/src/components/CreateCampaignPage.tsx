import { Link, useNavigate } from 'react-router-dom';
import { CampaignForm } from './CampaignForm';

/**
 * Dedicated create page (`/campaigns/new`) — thin wrapper around the shared
 * `CampaignForm` (2026-09-08 redesign, ui-redesign-plan.md C2.2: one 3-part
 * form for both create and edit instead of two near-duplicate ones). On
 * success, navigates straight to the new campaign's view page rather than
 * back to the list: the freshly created campaign is exactly what the admin
 * wants next (e.g. to review its device/member tabs).
 */
export function CreateCampaignPage() {
  const navigate = useNavigate();

  return (
    <div>
      <Link to="/campaigns" className="text-gray-500 hover:text-gray-700 mb-4 inline-block text-sm">
        ← Danh sách campaign
      </Link>
      <h1 className="text-2xl font-bold text-gray-900 mb-1">Tạo campaign</h1>
      <p className="text-sm text-gray-500 mb-6">Điền đủ 3 phần bên dưới — cuộn hoặc dùng mục lục để di chuyển.</p>

      <CampaignForm
        mode="create"
        onSaved={(created) => navigate(`/campaigns/${created.id}`)}
        onCancel={() => navigate('/campaigns')}
      />
    </div>
  );
}
