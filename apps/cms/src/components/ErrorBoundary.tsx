import { Component, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * The actual `componentDidCatch` boundary — a class component because React
 * has no hook equivalent for catching render errors. Kept internal to this
 * file; callers use the `ErrorBoundary` function component below, which
 * additionally resets on route change (see its own doc comment).
 */
class RenderCrashBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary] render crash:', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="max-w-lg mx-auto mt-16 p-6 rounded-2xl border border-red-200 bg-red-50 text-center">
          <AlertTriangle className="w-8 h-8 text-red-500 mx-auto mb-3" />
          <h1 className="text-lg font-semibold text-red-800 mb-1.5">Đã xảy ra lỗi hiển thị</h1>
          <p className="text-sm text-red-700 mb-4 break-words">{this.state.error.message}</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white font-semibold text-sm"
          >
            Tải lại trang
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

/**
 * Top-level render-crash guard (2026-09-18, plan §1.1/B1) — before this, the
 * CMS had NO error boundary anywhere: one uncaught render `TypeError` (e.g.
 * dereferencing a field an API response didn't actually carry — exactly
 * what happened on "Duyệt" in the photo-review detail page) blanked the
 * entire document with no recovery except a manual URL reload. Wraps
 * `<Routes>` in `App.tsx`.
 *
 * Keyed by `location.pathname` so navigating to a different route remounts
 * the boundary and clears a stuck error automatically — a crash on
 * `/review/:id` no longer has to follow the user to every other page they
 * try to visit afterwards. Must render inside `<BrowserRouter>` (uses
 * `useLocation()`).
 */
export function ErrorBoundary({ children }: { children: ReactNode }) {
  const location = useLocation();
  return <RenderCrashBoundary key={location.pathname}>{children}</RenderCrashBoundary>;
}
