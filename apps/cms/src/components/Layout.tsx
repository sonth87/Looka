import type { ReactNode } from 'react';
import { getApiKey, setApiKey } from '../api';

/**
 * Standard admin-CMS shell: a fixed sidebar (branding + nav) and a scrolling
 * content area — the layout every mainstream admin tool (Strapi, Directus,
 * Retool...) uses, rather than a single unstyled column of forms. Only one
 * nav item exists today (Campaigns); the sidebar is still worth having now
 * so a Devices-overview or Dashboard page has somewhere to slot in later
 * without another layout pass.
 *
 * Light theme, deliberately: this is an office/daytime admin tool, distinct
 * from the dark kiosk-facing capture screen elsewhere in this monorepo — the
 * two run in different contexts and don't need to share a palette.
 */
export function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex bg-gray-50">
      <aside className="w-60 shrink-0 border-r border-gray-200 bg-white flex flex-col">
        <div className="px-5 py-5 border-b border-gray-200">
          <h1 className="font-bold text-lg tracking-tight text-gray-900">Looka CMS</h1>
          <p className="text-xs text-gray-500 mt-0.5">Quản trị campaign &amp; thiết bị</p>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1">
          <div className="px-2 py-2 rounded-lg bg-blue-50 text-blue-700 text-sm font-medium">Campaigns</div>
        </nav>

        <div className="px-4 py-4 border-t border-gray-200">
          <button
            onClick={() => {
              if (confirm('Xoá API key đã lưu và đăng xuất?')) {
                setApiKey('');
                window.location.reload();
              }
            }}
            className="text-xs text-gray-400 hover:text-gray-600"
          >
            Đăng xuất ({getApiKey().slice(0, 4)}••••)
          </button>
        </div>
      </aside>

      <main className="flex-1 min-w-0 overflow-y-auto">
        <div className="max-w-6xl mx-auto p-8">{children}</div>
      </main>
    </div>
  );
}
