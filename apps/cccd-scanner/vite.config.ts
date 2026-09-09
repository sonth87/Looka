import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],

  // Relative asset paths — a packaged build is opened with loadFile() under
  // file://, where Vite's default base of '/' would resolve to the root of
  // the drive and load nothing. See apps/desktop/vite.config.ts's identical
  // comment; this app is packaged the same way.
  base: './',

  build: {
    emptyOutDir: false,
  },

  server: {
    port: 3010,
  },
});
