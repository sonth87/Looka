import { useState } from 'react';
import { ApiKeyGate } from './components/ApiKeyGate';
import { Layout } from './components/Layout';
import { CampaignList } from './components/CampaignList';
import { CampaignDetail } from './components/CampaignDetail';

/**
 * No router — the CMS is small enough (campaign list, campaign detail) that
 * a plain piece of state for "which campaign is open" is simpler and one
 * fewer dependency than pulling in a routing library for two views.
 */
export default function App() {
  const [openCampaignId, setOpenCampaignId] = useState<string | null>(null);

  return (
    <ApiKeyGate>
      <Layout>
        {openCampaignId ? (
          <CampaignDetail campaignId={openCampaignId} onBack={() => setOpenCampaignId(null)} />
        ) : (
          <CampaignList onOpenCampaign={setOpenCampaignId} />
        )}
      </Layout>
    </ApiKeyGate>
  );
}
