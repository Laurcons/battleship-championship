import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  // In `VITE_API_MODE=http` the dev server forwards API calls to a locally running API.
  server: { port: 5173, strictPort: true, fs: { allow: ['../..'] }, proxy: { '/api': 'http://127.0.0.1:3000' } },
  preview: { port: 4173, strictPort: true },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./test/setup.ts'],
    include: ['test/**/*.test.{ts,tsx}'],
    css: false,
  },
});
