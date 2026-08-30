import { useState, type ReactNode } from 'react';
import { getApiKey, setApiKey } from '../api';

/**
 * The whole auth model this CMS has to work with: one shared admin
 * `x-api-key`, the same key `ApiKeyMiddleware` already checks for
 * session/photo routes (see apps/api's app.module.ts). No per-user login
 * exists on the server, so this deliberately doesn't pretend to have one —
 * it just asks for the key once and stores it for next time.
 */
export function ApiKeyGate({ children }: { children: ReactNode }) {
  const [hasKey, setHasKey] = useState(() => getApiKey().length > 0);
  const [input, setInput] = useState('');

  if (hasKey) return <>{children}</>;

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-gray-50">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!input.trim()) return;
          setApiKey(input.trim());
          setHasKey(true);
        }}
        className="w-full max-w-sm rounded-2xl border border-gray-200 bg-white shadow-sm p-6"
      >
        <h1 className="text-xl font-bold mb-1 text-gray-900">Looka CMS</h1>
        <p className="text-gray-500 text-sm mb-4">Nhập API key quản trị để tiếp tục.</p>
        <input
          type="password"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="API key"
          className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 mb-4 text-gray-900"
          autoFocus
        />
        <button type="submit" className="w-full py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold">
          Tiếp tục
        </button>
      </form>
    </div>
  );
}
