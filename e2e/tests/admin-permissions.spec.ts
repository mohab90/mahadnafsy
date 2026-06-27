import { test, expect, type Page } from '@playwright/test';

/**
 * Admin role-based render + permission net. This is the safety net that makes
 * decomposing the giant admin components safe: it logs in as each role and asserts
 * the dashboard actually RENDERS (no blank screen, no fatal React error) — which is
 * exactly what a broken hook-extraction / context-refactor would cause.
 *
 * CI-safe: each role self-skips unless its TEST_<ROLE>_EMAIL/PASSWORD are provided.
 * Backend authorization itself is covered by api-contract.spec.ts; this covers the
 * UI render integrity per role.
 *
 * To establish a baseline / run a regression check:
 *   1. Run the admin against a real DB (npm run start:admin + the API).
 *   2. Create disposable test accounts (tools/seed-test-accounts.mjs) and export
 *      TEST_ADMIN_EMAIL/PASSWORD, TEST_SALES_EMAIL/PASSWORD, etc.
 *   3. npm --prefix e2e test admin-permissions
 */
const ADMIN = process.env.ADMIN_BASE_URL || 'http://127.0.0.1:4000';

const ROLES = [
  { role: 'admin',      email: process.env.TEST_ADMIN_EMAIL,      password: process.env.TEST_ADMIN_PASSWORD },
  { role: 'manager',    email: process.env.TEST_MANAGER_EMAIL,    password: process.env.TEST_MANAGER_PASSWORD },
  { role: 'sales',      email: process.env.TEST_SALES_EMAIL,      password: process.env.TEST_SALES_PASSWORD },
  { role: 'collection', email: process.env.TEST_COLLECTION_EMAIL, password: process.env.TEST_COLLECTION_PASSWORD },
  { role: 'daqqi',      email: process.env.TEST_DAQQI_EMAIL,      password: process.env.TEST_DAQQI_PASSWORD },
];

const FATAL = /Invalid hook call|Minified React error|Rendered (more|fewer) hooks|Maximum update depth|is not a function|Cannot read propert/i;

async function login(page: Page, email: string, password: string) {
  await page.goto(ADMIN);
  await page.locator('input[type="email"], input[name="email"]').first().fill(email);
  await page.locator('input[type="password"], input[name="password"]').first().fill(password);
  await page.getByRole('button', { name: /دخول|تسجيل|login|sign/i }).first().click();
  await page.waitForTimeout(2500);
}

test.describe('Admin role render + permission net', () => {
  for (const r of ROLES) {
    test(`${r.role}: dashboard renders with no fatal errors`, async ({ page }) => {
      test.skip(!r.email || !r.password, `set TEST_${r.role.toUpperCase()}_EMAIL / TEST_${r.role.toUpperCase()}_PASSWORD to run`);
      const fatal: string[] = [];
      page.on('console', (m) => { if (m.type() === 'error' && FATAL.test(m.text())) fatal.push(m.text()); });
      page.on('pageerror', (e) => { if (FATAL.test(e.message)) fatal.push(e.message); });

      await login(page, r.email!, r.password!);

      // The dashboard must render real content — not a blank white screen and not
      // the bare login form. A broken decomposition collapses this.
      const bodyText = (await page.locator('body').innerText().catch(() => '')) || '';
      expect(bodyText.length, `${r.role}: dashboard should render content, not a blank screen`).toBeGreaterThan(200);

      // No fatal React/runtime error in the console (catches bad hook extractions).
      expect(fatal, `${r.role}: fatal error after login → ${fatal[0] || ''}`).toHaveLength(0);
    });
  }
});
