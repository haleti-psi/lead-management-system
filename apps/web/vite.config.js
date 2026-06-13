import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';
// PWA (vite-plugin-pwa) and shadcn/ui aliases are wired by the Stage-7
// foundation wave. Preview binds 8080 to match the Cloud Run container port.
// The dev server proxies `/api` to the local API (env-schema default PORT 8080)
// so the same-origin apiClient base path (`/api/v1`) works in development.
export default defineConfig({
    plugins: [react()],
    resolve: {
        alias: {
            '@': path.resolve(__dirname, 'src'),
            '@lms/shared': path.resolve(__dirname, '../../packages/shared/src'),
        },
    },
    server: {
        port: 5173,
        proxy: {
            '/api': { target: 'http://localhost:8080', changeOrigin: true },
        },
    },
    preview: { port: 8080 },
    build: { outDir: 'dist' },
    test: {
        // Component specs select jsdom via `// @vitest-environment jsdom`; this setup
        // runs in every spec to register Testing Library cleanup after each test.
        setupFiles: ['./src/test/setup.ts'],
    },
});
