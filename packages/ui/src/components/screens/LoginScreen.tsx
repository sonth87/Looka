import { useState } from 'react';
import type { AuthClient, AuthenticatedIdentity } from '../../lib/authClient.js';

export interface LoginScreenProps {
  authClient: AuthClient;
  onLoggedIn: (identity: AuthenticatedIdentity) => void;
  deviceLabel?: string;
  appVersion?: string;
}

/**
 * S1 (ui-redesign-plan.md §2) — the app's very first screen. Renders one of
 * two logins depending on what `authClient` actually supports (see
 * `authClient.ts`'s own doc comment):
 *  - `authClient.ssoLogin` present → the real flow: a single "Đăng nhập
 *    bằng Microsoft 365" button that opens the school's SSO (desktop's
 *    `SsoAuthClient`, backed by `apps/desktop/src/main/ssoLogin.ts`'s
 *    `BrowserWindow`). This app never sees a password.
 *  - otherwise → the local `DevAuthClient` fallback: type any name/email
 *    and it "logs in" instantly. Only useful against a dev `apps/api` with
 *    `ALLOW_UNAUTHENTICATED_ADMIN_DEV=true`.
 */
export function LoginScreen({ authClient, onLoggedIn, deviceLabel, appVersion }: LoginScreenProps) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleManualSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) {
      setError('Nhập email để đăng nhập.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const identity: AuthenticatedIdentity = { displayName: name.trim() || email.trim(), email: email.trim() };
      await authClient.login(identity);
      onLoggedIn(identity);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleSsoLogin() {
    if (!authClient.ssoLogin) return;
    setBusy(true);
    setError(null);
    try {
      const identity = await authClient.ssoLogin();
      if (identity) onLoggedIn(identity);
      // null = operator closed the SSO window without finishing — back to
      // this screen with no error, same as cancelling any other login.
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="w-full h-full flex flex-col items-center justify-center bg-slate-950 text-slate-100 px-6">
      <div className="text-2xl font-semibold tracking-tight mb-1">Looka</div>
      <div className="text-slate-400 mb-8">Chụp ảnh thẻ</div>

      {authClient.ssoLogin ? (
        <div className="w-full max-w-sm bg-slate-900/70 border border-slate-800 rounded-2xl p-6 flex flex-col gap-4">
          <div className="text-sm text-slate-300 leading-relaxed text-center">
            Đăng nhập bằng tài khoản Microsoft 365 của trường
          </div>

          {error && <div className="text-sm text-rose-400 text-center">{error}</div>}

          <button
            type="button"
            onClick={() => void handleSsoLogin()}
            disabled={busy}
            className="mt-2 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white font-medium py-3 transition-colors"
          >
            {busy ? 'Đang đăng nhập…' : 'Đăng nhập bằng Microsoft 365'}
          </button>
        </div>
      ) : (
        <form
          onSubmit={handleManualSubmit}
          className="w-full max-w-sm bg-slate-900/70 border border-slate-800 rounded-2xl p-6 flex flex-col gap-4"
        >
          <div className="text-sm text-slate-300 leading-relaxed">
            Đăng nhập bằng tài khoản Microsoft 365 của trường
            <div className="mt-1 text-xs text-amber-400/90">
              (Chế độ thử nghiệm cục bộ — chưa nối SSO thật. Nhập tên/email bất kỳ để tiếp tục.)
            </div>
          </div>

          <label className="flex flex-col gap-1 text-sm text-slate-300">
            Họ tên
            <input
              className="rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 text-slate-100 outline-none focus:border-blue-500"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Nguyễn Văn A"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm text-slate-300">
            Email
            <input
              className="rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 text-slate-100 outline-none focus:border-blue-500"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="ten@dainam.edu.vn"
              type="email"
              required
            />
          </label>

          {error && <div className="text-sm text-rose-400">{error}</div>}

          <button
            type="submit"
            disabled={busy}
            className="mt-2 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white font-medium py-3 transition-colors"
          >
            {busy ? 'Đang đăng nhập…' : 'Đăng nhập'}
          </button>
        </form>
      )}

      <div className="mt-8 text-xs text-slate-500 flex items-center gap-2">
        <span className={'w-2 h-2 rounded-full bg-emerald-500'} />
        <span>{deviceLabel ?? 'Máy này'}</span>
        {appVersion && <span>· Phiên bản {appVersion}</span>}
      </div>
    </div>
  );
}
