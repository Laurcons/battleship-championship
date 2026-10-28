import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const PORT = 3100;
const webDist = path.resolve(import.meta.dirname, 'dist-real');

/** End-to-end tests against the real stack: the API serves the built web app, programs are real WebSocket clients. */
export default defineConfig({
  testDir: './e2e-real',
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  workers: 3,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
    viewport: { width: 1280, height: 900 },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm build:real && pnpm --filter @bsc/api start',
    url: `http://127.0.0.1:${PORT}/api/session`,
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      NODE_ENV: 'development',
      PORT: String(PORT),
      HOST: '127.0.0.1',
      WEB_DIST: webDist,
      SHARED_PASSWORD: 'e2e shared password',
      ADMIN_USERNAME: 'admin',
      ADMIN_PASSWORD: 'e2e admin password',
      MOVE_TIMEOUT_MS: '3000',
      PLACE_TIMEOUT_MS: '3000',
      GRACE_MS: '4000',
      LOGIN_ATTEMPTS: '1000',
      API_RATE_LIMIT: '1000000', // every test comes from one address
    },
  },
});
