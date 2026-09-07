import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { AuthGate } from './auth/AuthGate';
import { Layout } from './components/Layout';
import { StatsOverview } from './components/StatsOverview';
import { CampaignList } from './components/CampaignList';
import { CreateCampaignPage } from './components/CreateCampaignPage';
import { CampaignDetail } from './components/CampaignDetail';
import { EditCampaignPage } from './components/EditCampaignPage';

/**
 * `react-router-dom` (2026-09-07) — this app previously used a hand-rolled
 * `View` union + `useState` instead of a router, on the reasoning that three
 * views (overview/list/detail) didn't justify the dependency. That reasoning
 * no longer holds: this task added dedicated create/edit/view pages for a
 * campaign, so the view count grew to five real routes (plus overview),
 * each of which also benefits from being a real bookmarkable/shareable URL
 * with working back/forward — exactly what a router is for. See
 * docs/ROADMAP.md for the full route table.
 *
 * `AuthContext`'s query-string token capture
 * (`window.history.replaceState`) and `env.ts`'s `redirectToLogin`
 * (`window.location.href`) both still work unmodified underneath
 * `BrowserRouter`: neither one goes through `react-router-dom`'s navigation
 * APIs, they operate on the raw `window.location`/History API directly, and
 * `BrowserRouter` does not intercept or wrap those — it only listens to
 * `popstate` and reads `window.location` itself. A `replaceState` call from
 * outside the router is invisible to it until the next render/navigation,
 * which is fine here since `AuthProvider`'s effect runs once on mount,
 * before `BrowserRouter` has rendered any route-dependent UI that would need
 * to react to it.
 */
export default function App() {
  return (
    // AuthGate is the sole gate now (2026-09-07): it decides both who may
    // open the CMS and, via the Bearer token it captures, which apps/api
    // calls succeed (see api.ts's request()). The old ApiKeyGate/shared
    // x-api-key layer was removed once SSO login shipped - see
    // docs/ROADMAP.md.
    <AuthGate>
      <BrowserRouter>
        <Layout>
          <Routes>
            <Route path="/" element={<StatsOverview />} />
            <Route path="/campaigns" element={<CampaignList />} />
            <Route path="/campaigns/new" element={<CreateCampaignPage />} />
            <Route path="/campaigns/:id" element={<CampaignDetail />} />
            <Route path="/campaigns/:id/edit" element={<EditCampaignPage />} />
          </Routes>
        </Layout>
      </BrowserRouter>
    </AuthGate>
  );
}
