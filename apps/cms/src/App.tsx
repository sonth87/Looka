import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthGate } from './auth/AuthGate';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Layout } from './components/Layout';
import { OverviewPage } from './components/OverviewPage';
import { CampaignList } from './components/CampaignList';
import { CreateCampaignPage } from './components/CreateCampaignPage';
import { CampaignDetail } from './components/CampaignDetail';
import { EditCampaignPage } from './components/EditCampaignPage';
import { AnglePresetsPage } from './components/AnglePresetsPage';
import { PhotoKindsPage } from './components/PhotoKindsPage';
import { PrintersPage } from './components/PrintersPage';
import { RolesPage } from './components/RolesPage';
import { UsersPage } from './components/UsersPage';
import { ReviewListPage } from './photo-review/ReviewListPage';
import { ReviewDetailPage } from './photo-review/ReviewDetailPage';
import { PrintPage } from './print/PrintPage';
import { PrintBatchDetailPage } from './print/PrintBatchDetailPage';
import { CampaignPrintStatusPage } from './print/CampaignPrintStatusPage';
import { CardTemplatesPage } from './card-templates/CardTemplatesPage';
import { CardTemplateDetailPage } from './card-templates/CardTemplateDetailPage';
import { WorkflowsPage } from './workflow/WorkflowsPage';
import { IdentificationMethodsPage } from './workflow/IdentificationMethodsPage';
import { DesktopCallbackPage } from './components/DesktopCallbackPage';

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
          <ErrorBoundary>
            <Routes>
              <Route path="/" element={<OverviewPage />} />
              {/* Plan item 11, 2026-09-17: "Vận hành" merged into "Tổng quan" (now tabs on `/`) — redirect old bookmarks/links instead of 404ing. */}
              <Route path="/dashboard" element={<Navigate to="/" replace />} />
              <Route path="/campaigns" element={<CampaignList />} />
              <Route path="/campaigns/new" element={<CreateCampaignPage />} />
              <Route path="/campaigns/:id" element={<CampaignDetail />} />
              <Route path="/campaigns/:id/edit" element={<EditCampaignPage />} />
              <Route path="/angle-presets" element={<AnglePresetsPage />} />
              {/* "Mẫu chụp" (`capture_configurations`) retired 2026-09-17 — Workflow (`/workflows`) is now the single config entry point. */}
              <Route path="/capture-configurations" element={<Navigate to="/workflows" replace />} />
              <Route path="/config" element={<PhotoKindsPage />} />
              <Route path="/review" element={<ReviewListPage />} />
              {/* "Phân công duyệt" moved from its own route into a tab on `/review` itself (2026-09-22 — "để 1 trang trong duyệt ảnh", not a separate page); old bookmarks still land somewhere real. */}
              <Route path="/review/assignments" element={<Navigate to="/review" replace />} />
              <Route path="/review/:id" element={<ReviewDetailPage />} />
              <Route path="/print" element={<PrintPage />} />
              <Route path="/print/by-campaign" element={<CampaignPrintStatusPage />} />
              <Route path="/print/batches/:id" element={<PrintBatchDetailPage />} />
              <Route path="/card-templates" element={<CardTemplatesPage />} />
              <Route path="/card-templates/:id" element={<CardTemplateDetailPage />} />
              <Route path="/printers" element={<PrintersPage />} />
              <Route path="/users" element={<UsersPage />} />
              <Route path="/roles" element={<RolesPage />} />
              <Route path="/workflows" element={<WorkflowsPage />} />
              <Route path="/identification-methods" element={<IdentificationMethodsPage />} />
              <Route path="/desktop-callback" element={<DesktopCallbackPage />} />
            </Routes>
          </ErrorBoundary>
        </Layout>
      </BrowserRouter>
    </AuthGate>
  );
}
