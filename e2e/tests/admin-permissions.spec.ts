import { test, expect, type Page } from '@playwright/test';

/**
 * Admin role-based render + permission net. This is the safety net that makes
 * decomposing the giant admin components safe: it logs in as each role and asserts
 * the dashboard actually RENDERS (no blank screen, no fatal React error) — which is
 * exactly what a broken hook-extraction / context-refactor would cause.
 *
 * Defaults to the local UAT seed accounts, while still allowing CI to override
 * each role through env vars.
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
const PASSWORD = process.env.UAT_PASSWORD || 'MahadUat#2026';

const ROLES = [
  { role: 'admin',          email: process.env.TEST_ADMIN_EMAIL || 'uat.admin@mahad.test', password: process.env.TEST_ADMIN_PASSWORD || PASSWORD },
  { role: 'manager',        email: process.env.TEST_MANAGER_EMAIL || 'uat.manager@mahad.test', password: process.env.TEST_MANAGER_PASSWORD || PASSWORD },
  { role: 'online_manager', email: process.env.TEST_ONLINE_MANAGER_EMAIL || 'uat.online-manager@mahad.test', password: process.env.TEST_ONLINE_MANAGER_PASSWORD || PASSWORD },
  { role: 'sales_manager',  email: process.env.TEST_SALES_MANAGER_EMAIL || 'uat.sales-manager@mahad.test', password: process.env.TEST_SALES_MANAGER_PASSWORD || PASSWORD },
  { role: 'sales',          email: process.env.TEST_SALES_EMAIL || 'uat.sales@mahad.test', password: process.env.TEST_SALES_PASSWORD || PASSWORD },
  { role: 'collection',     email: process.env.TEST_COLLECTION_EMAIL || 'uat.collection@mahad.test', password: process.env.TEST_COLLECTION_PASSWORD || PASSWORD },
  { role: 'support_online', email: process.env.TEST_SUPPORT_ONLINE_EMAIL || 'uat.support-online@mahad.test', password: process.env.TEST_SUPPORT_ONLINE_PASSWORD || PASSWORD },
  { role: 'support_daqqi',  email: process.env.TEST_SUPPORT_DAQQI_EMAIL || 'uat.support-daqqi@mahad.test', password: process.env.TEST_SUPPORT_DAQQI_PASSWORD || PASSWORD },
  { role: 'reception_daqqi', email: process.env.TEST_RECEPTION_DAQQI_EMAIL || 'uat.reception-daqqi@mahad.test', password: process.env.TEST_RECEPTION_DAQQI_PASSWORD || PASSWORD },
  { role: 'daqqi_manager',  email: process.env.TEST_DAQQI_MANAGER_EMAIL || 'uat.daqqi-manager@mahad.test', password: process.env.TEST_DAQQI_MANAGER_PASSWORD || PASSWORD },
  { role: 'hr_manager',     email: process.env.TEST_HR_MANAGER_EMAIL || 'uat.hr-manager@mahad.test', password: process.env.TEST_HR_MANAGER_PASSWORD || PASSWORD },
  { role: 'recruiter',      email: process.env.TEST_RECRUITER_EMAIL || 'uat.recruiter@mahad.test', password: process.env.TEST_RECRUITER_PASSWORD || PASSWORD },
  { role: 'accountant',     email: process.env.TEST_ACCOUNTANT_EMAIL || 'uat.accountant@mahad.test', password: process.env.TEST_ACCOUNTANT_PASSWORD || PASSWORD },
];

const FATAL = /Invalid hook call|Minified React error|Rendered (more|fewer) hooks|Maximum update depth|is not a function|Cannot read propert/i;

async function login(page: Page, email: string, password: string) {
  await page.goto(ADMIN, { waitUntil: 'domcontentloaded' });
  await page.locator('input[type="email"], input[name="email"]').first().fill(email);
  await page.locator('input[type="password"], input[name="password"]').first().fill(password);
  await page.getByRole('button', { name: /دخول|تسجيل|login|sign/i }).first().click();
  await expect
    .poll(async () => {
      const emailVisible = await page.locator('input[type="email"], input[name="email"]').first().isVisible().catch(() => false);
      const bodyText = ((await page.locator('body').innerText().catch(() => '')) || '').trim();
      if (!emailVisible && bodyText.length > 200) return 'dashboard';
      if (/تعذر|خطأ|فشل|invalid|failed|unauthorized/i.test(bodyText)) {
        return `login-error:${bodyText.slice(0, 240)}`;
      }
      if (!emailVisible && bodyText.length > 200) return 'dashboard';
      return 'waiting';
    }, {
      message: `dashboard should finish rendering after login for ${email}`,
      timeout: 45_000,
    })
    .toBe('dashboard');
}

test.describe('Admin role render + permission net', () => {
  test.describe.configure({ mode: 'serial' });

  for (const r of ROLES) {
    test(`${r.role}: dashboard renders with no fatal errors`, async ({ page }) => {
      test.setTimeout(60_000);
      const fatal: string[] = [];
      page.on('console', (m) => { if (m.type() === 'error' && FATAL.test(m.text())) fatal.push(m.text()); });
      page.on('pageerror', (e) => { if (FATAL.test(e.message)) fatal.push(e.message); });

      await login(page, r.email, r.password);

      // The dashboard must render real content — not a blank white screen and not
      // the bare login form. A broken decomposition collapses this.
      const bodyText = (await page.locator('body').innerText().catch(() => '')) || '';
      expect(bodyText.length, `${r.role}: dashboard should render content, not a blank screen`).toBeGreaterThan(200);

      // No fatal React/runtime error in the console (catches bad hook extractions).
      expect(fatal, `${r.role}: fatal error after login → ${fatal[0] || ''}`).toHaveLength(0);
    });
  }
});
