/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** SSO login page URL — see src/auth/env.ts. Empty/unset disables the SSO gate. */
  readonly VITE_URL_LOGIN_SSO?: string;
  /** baseURL for the SSO backend's /auth/* endpoints — falls back to VITE_URL_LOGIN_SSO. */
  readonly VITE_BE_URL_WORKSPACE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
