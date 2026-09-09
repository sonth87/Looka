import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ApiError, Campaign, getCampaign } from '../api';
import { CampaignForm } from './CampaignForm';

/**
 * Dedicated edit page (`/campaigns/:id/edit`) — thin wrapper around the
 * shared `CampaignForm` (see `CreateCampaignPage`'s own doc comment for the
 * 2026-09-08 merge). Settings editing stays its own page; `CampaignDetail`'s
 * "Cài đặt" tab links here rather than embedding the form inline.
 */
export function EditCampaignPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    getCampaign(id)
      .then(setCampaign)
      .catch((err) => setError(err instanceof ApiError ? err.message : String(err)));
  }, [id]);

  if (error) return <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-700">{error}</div>;
  if (!campaign) return <p className="text-gray-500">Đang tải...</p>;

  return (
    <div>
      <Link to={`/campaigns/${campaign.id}`} className="text-gray-500 hover:text-gray-700 mb-4 inline-block text-sm">
        ← {campaign.name}
      </Link>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Sửa campaign</h1>

      <CampaignForm
        mode="edit"
        campaign={campaign}
        onSaved={() => navigate(`/campaigns/${campaign.id}`)}
        onCancel={() => navigate(`/campaigns/${campaign.id}`)}
      />
    </div>
  );
}
