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
 * Retool...) uses, rather than a single unstyled column of forms. Two nav
 * items today (Tổng quan, Campaigns) — the sidebar was already built to make
 * room for exactly this kind of Dashboard/overview addition.
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
          <NavLink to="/" end className={navItemClass}>
            Tổng quan
          </NavLink>
          <NavLink to="/campaigns" className={navItemClass}>
            Campaigns
          </NavLink>
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
