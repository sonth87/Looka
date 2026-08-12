import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

export default defineConfig({
  plugins: [tailwindcss(), react()],
  resolve: {
    alias: {
      '@face/core': path.resolve(__dirname, '../../packages/core/src'),
      '@face/camera': path.resolve(__dirname, '../../packages/camera/src'),
      '@face/cv-engine': path.resolve(__dirname, '../../packages/cv-engine/src'),
      '@face/cv-mediapipe': path.resolve(__dirname, '../../packages/cv-mediapipe/src'),
      '@face/face-quality': path.resolve(__dirname, '../../packages/face-quality/src'),
      '@face/workflow-engine': path.resolve(__dirname, '../../packages/workflow-engine/src'),
      '@face/database': path.resolve(__dirname, '../../packages/database/src'),
      '@face/ui': path.resolve(__dirname, '../../packages/ui/src'),
    },
  },
  server: {
    port: 3000,
    host: true,
  },
});
