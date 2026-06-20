import { defineConfig, devices } from '@playwright/test';

/**
 * Mahad Nafsy end-to-end smoke suite.
 *
 * Targets a *running* deployment (local or production). Configure via env:
 *   BASE_URL        public site         (default http://127.0.0.1:3000)
 *   ADMIN_BASE_URL  admin dashboard     (default http://127.0.0.1:4000)
 *   API_BASE_URL    REST API            (default http://127.0.0.1:3001)
 *   TEST_ADMIN_EMAIL / TEST_ADMIN_PASSWORD  → enable the admin-login spec
 *
 * Run:  npm run test:e2e         (after `npx playwright install --with-deps`)
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: process.env.BASE_URL || 'http://127.0.0.1:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    ignoreHTTPSErrors: true,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
