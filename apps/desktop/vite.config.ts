import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    emptyOutDir: false,
  },
  resolve: {
    alias: {
      '@face/core': path.resolve(__dirname, '../../packages/core/src/index.ts'),
      '@face/camera': path.resolve(__dirname, '../../packages/camera/src/index.ts'),
      '@face/cv-engine': path.resolve(__dirname, '../../packages/cv-engine/src/index.ts'),
      '@face/cv-mediapipe': path.resolve(__dirname, '../../packages/cv-mediapipe/src/index.ts'),
      '@face/hand-gesture': path.resolve(__dirname, '../../packages/hand-gesture/src/index.ts'),
      '@face/face-quality': path.resolve(__dirname, '../../packages/face-quality/src/index.ts'),
      '@face/workflow-engine': path.resolve(__dirname, '../../packages/workflow-engine/src/index.ts'),
      '@face/database': path.resolve(__dirname, '../../packages/database/src/index.ts'),
      '@face/biometric': path.resolve(__dirname, '../../packages/biometric/src/index.ts'),
      '@face/recognition-engine': path.resolve(__dirname, '../../packages/recognition-engine/src/index.ts'),
      '@face/attendance-engine': path.resolve(__dirname, '../../packages/attendance-engine/src/index.ts'),
      '@face/ui': path.resolve(__dirname, '../../packages/ui/src/index.ts'),
    },
  },
  server: {
    port: 3001,
  },
});
