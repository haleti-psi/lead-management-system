import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// PWA (vite-plugin-pwa), shadcn/ui aliases, and proxy are wired by the Stage-7
// foundation wave. Preview binds 8080 to match the Cloud Run container port.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@lms/shared': path.resolve(__dirname, '../../packages/shared/src'),
    },
  },
  server: { port: 5173 },
  preview: { port: 8080 },
  build: { outDir: 'dist' },
});
