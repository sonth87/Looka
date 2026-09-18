import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { isSsoConfigured } from '../auth/env';

/**
 * SSO session logout (docs/LOGIN.md §6) — the only sign-out control in this
 * sidebar since the old "Xoá API key" button was removed (2026-09-07, api-key
 * retired from the CMS entirely). Only rendered when SSO is actually
 * configured: `useAuth()` requires an `<AuthProvider>` ancestor, which
 * `AuthGate` only mounts when `isSsoConfigured` is true (see App.tsx/
 * AuthGate.tsx) — `isSsoConfigured` is a static env-derived constant, so this
 * condition never flips mid-session.
 */
function SsoLogoutButton() {
  const { logout, profile } = useAuth();
  const email = profile?.user?.email;

  return (
    <button
      onClick={() => {
        void logout();
      }}
      className="text-xs text-gray-400 hover:text-gray-600"
    >
      Đăng xuất tài khoản{email ? ` (${email})` : ''}
    </button>
  );
}

/**
 * Standard admin-CMS shell: a fixed sidebar (branding + nav) and a scrolling
 * content area — the layout every mainstream admin tool (Strapi, Directus,
 * Retool...) uses, rather than a single unstyled column of forms. The
 * sidebar was already built to make room for exactly this kind of
 * Dashboard/overview addition (now Tổng quan, Campaigns, Sinh viên).
 *
 * Light theme, deliberately: this is an office/daytime admin tool, distinct
 * from the dark kiosk-facing capture screen elsewhere in this monorepo — the
 * two run in different contexts and don't need to share a palette.
 *
 * Nav highlighting moved from an `activeNav`/`onNavigate` prop pair to plain
 * `NavLink` (2026-09-07, alongside `react-router-dom` being added — see
 * App.tsx's own doc comment): the URL is now the single source of truth for
 * "which page is open" instead of a piece of state this component had to be
 * told about. "Campaigns" stays highlighted for every `/campaigns/*` route
 * (new/:id/:id/edit included) since `NavLink` matches by path prefix here —
 * only "Tổng quan" needs `end` so `/` doesn't also match every other route.
 */
export function Layout({ children }: { children: ReactNode }) {
  const navItemClass = ({ isActive }: { isActive: boolean }) =>
    `block px-2 py-2 rounded-lg text-sm font-medium ${
      isActive ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-100'
    }`;

  return (
    <div className="min-h-screen flex bg-gray-50">
      <aside className="w-60 shrink-0 border-r border-gray-200 bg-white flex flex-col">
        <div className="px-5 py-5 border-b border-gray-200">
          <h1 className="font-bold text-lg tracking-tight text-gray-900">Looka CMS</h1>
          <p className="text-xs text-gray-500 mt-0.5">Quản trị campaign &amp; thiết bị</p>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1">
          {/* "Tổng quan" (plan item 11, 2026-09-17) — merged with the old separate "Vận hành" nav entry; that content is now a tab on this same page (`OverviewPage.tsx`). */}
          <NavLink to="/" end className={navItemClass}>
            Tổng quan
          </NavLink>
          <NavLink to="/campaigns" className={navItemClass}>
            Campaigns
          </NavLink>
          <NavLink to="/angle-presets" className={navItemClass}>
            Góc chụp
          </NavLink>
          {/*
            "Cấu hình" (2026-09-08, product feedback) — standalone page for
            "loại ảnh" (`photo_kinds`): standards shared across campaigns
            (card size/dpi/background, AI-edit prompt hints), not tied to any
            one campaign. "Sinh viên" moved OUT of this top-level nav the
            same day — it's now a tab inside each campaign's own detail page
            (`CampaignStudentsPanel`, `CampaignDetail.tsx`), since captured
            students only ever make sense in the context of one campaign.
          */}
          <NavLink to="/config" className={navItemClass}>
            Cấu hình
          </NavLink>
          {/*
            "Workflow" (Phase 5, cms-8-screens-api-plan.md §2.2/P2) — góc
            chụp, chuẩn ảnh thẻ và phương thức định danh cho một campaign,
            versioned độc lập với campaign. "Điều kiện tiếp nhận"
            (eligibility) moved off this screen 2026-09-18, now configured
            per-campaign (`CampaignForm.tsx`) — see `apps/cms/src/api.ts`'s
            `EligibilityConfig` section header comment. "Phương thức định
            danh" là danh mục dùng chung mà workflow tham chiếu tới, nên đặt
            cạnh nhau cùng nhóm cấu hình ở trên.
          */}
          <NavLink to="/workflows" className={navItemClass}>
            Workflow
          </NavLink>
          <NavLink to="/identification-methods" className={navItemClass}>
            Phương thức định danh
          </NavLink>
          {/*
            "Duyệt ảnh" (C5, cms-photo-review-plan.md §0/§R-Q7) — a deliberately
            separate area ("route riêng, menu riêng, vai trò riêng REVIEWER")
            rather than folded into the admin nav group above; visually set
            apart with a divider so it doesn't read as "just another campaign
            admin page". `ReviewerRoleGuard` isn't wired into `AuthGate` yet in
            this pass (server-side guard from the concurrent backend
            workstream) — every signed-in SSO user sees this link today, same
            as the rest of the CMS currently does.
          */}
          <div className="pt-3 mt-3 border-t border-gray-200">
            <NavLink to="/review" className={navItemClass}>
              Duyệt ảnh
            </NavLink>
            <NavLink to="/print" className={navItemClass}>
              In thẻ
            </NavLink>
            {/*
              "Phôi thẻ" (Task C, 2026-09-16) — card-template CRUD + layout
              editor (`/card-templates`), placed right after "In thẻ" since a
              batch's default template and a print item's per-item template
              both come from this catalog.
            */}
            <NavLink to="/card-templates" className={navItemClass}>
              Phôi thẻ
            </NavLink>
            {/*
              "Máy in" — printer hardware/lifecycle management (status,
              phôi/stock, agent token), distinct from "In thẻ" above (print
              BATCHES/ITEMS — the jobs a printer executes). Placed right
              after it since they're the two halves of the same "in thẻ"
              concern: job queue vs. the physical hardware running it.
            */}
            <NavLink to="/printers" className={navItemClass}>
              Máy in
            </NavLink>
          </div>

          {/*
            "Phân quyền" — role/permission administration (roles, their
            permission sets, which users hold them). Kept in its own group,
            separate from the campaign/photo-operations items above: this is
            system administration, not a day-to-day capture/review/print
            task.
          */}
          <div className="pt-3 mt-3 border-t border-gray-200">
            {/* "Người dùng" (plan item 12, 2026-09-17) — browsable/filterable list, placed right before "Phân quyền" since gán vai trò is the very next thing an admin does after finding someone here. */}
            <NavLink to="/users" className={navItemClass}>
              Người dùng
            </NavLink>
            <NavLink to="/roles" className={navItemClass}>
              Phân quyền
            </NavLink>
          </div>
        </nav>

        <div className="px-4 py-4 border-t border-gray-200 space-y-2">
          {isSsoConfigured && <SsoLogoutButton />}
        </div>
      </aside>

      <main className="flex-1 min-w-0 overflow-y-auto">
        <div className="max-w-6xl mx-auto p-8">{children}</div>
      </main>
    </div>
  );
}
