import { useState } from 'react';
import { ApiKeyGate } from './components/ApiKeyGate';
import { Layout } from './components/Layout';
import { CampaignList } from './components/CampaignList';
import { CampaignDetail } from './components/CampaignDetail';
import { StatsOverview } from './components/StatsOverview';

type View = { name: 'overview' } | { name: 'list' } | { name: 'detail'; campaignId: string };

/**
 * No router — the CMS is small enough (overview, campaign list, campaign
 * detail) that a plain piece of state for "which view is open" is simpler
 * and one fewer dependency than pulling in a routing library for three views.
 */
export default function App() {
  const [view, setView] = useState<View>({ name: 'overview' });

  const openCampaign = (campaignId: string) => setView({ name: 'detail', campaignId });

  return (
    <ApiKeyGate>
      <Layout
        activeNav={view.name === 'overview' ? 'overview' : 'campaigns'}
        onNavigate={(nav) => setView(nav === 'overview' ? { name: 'overview' } : { name: 'list' })}
      >
        {view.name === 'overview' && <StatsOverview onOpenCampaign={openCampaign} />}
        {view.name === 'list' && <CampaignList onOpenCampaign={openCampaign} />}
        {view.name === 'detail' && (
          <CampaignDetail campaignId={view.campaignId} onBack={() => setView({ name: 'list' })} />
        )}
      </Layout>
    </ApiKeyGate>
  );
}
