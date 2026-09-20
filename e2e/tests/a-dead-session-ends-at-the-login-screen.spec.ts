import { test, expect } from '@playwright/test';
import { loginAdmin } from '../helpers/adminLogin';

/**
 * A session that is over ends at the login screen.
 *
 * Measured on production, signed in as the HR manager: the session had
 * expired, /api/auth/me answered 401, and the panel went on drawing the whole
 * dashboard. Every screen it drew asked for its data and every request came
 * back 401 — 101 of them on one page — and the failures surfaced as toasts
 * about the thing that had failed rather than about the session: «تعذر تحميل
 * تفضيلات حساب الموظف». Clicking «تسجيل الخروج» in that state posted a logout
 * that was itself refused, and left the dashboard on screen.
 *
 * So: when a request comes back 401, the panel signs out and shows the login
 * form. Once — not a redirect per failed request.
 */

const ADMIN = process.env.ADMIN_BASE_URL || 'http://127.0.0.1:4000';
const EMAIL = process.env.E2E_ADMIN_EMAIL;
const PASSWORD = process.env.E2E_ADMIN_PASSWORD;

test.describe('a session that has ended', () => {
  test.skip(!EMAIL || !PASSWORD, 'E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD not set');

  test('takes the panel to the login screen rather than a wall of refusals', async ({ page }) => {
    test.setTimeout(90_000);
    await loginAdmin(page, ADMIN, EMAIL!, PASSWORD!);

    // The session dies underneath the open panel — an expiry, a sign-in
    // elsewhere (one session per account), or the logout below.
    await page.context().clearCookies();

    const refused: string[] = [];
    page.on('response', r => { if (r.status() === 401 && r.url().includes('/api/')) refused.push(r.url()); });

    await page.goto(`${ADMIN}/dashboard/leads`);

    // The login form, not the dashboard.
    await expect(page.locator('input[type="email"], input[name="email"]').first())
      .toBeVisible({ timeout: 20_000 });
    const body = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
    expect(body.includes('تعذر تحميل تفضيلات حساب الموظف'), 'the session is what failed, not the preferences').toBe(false);

    // And it gave up quickly rather than asking for everything first. The
    // measured failure was 101 refusals on a single page.
    await page.waitForTimeout(3000);
    expect(refused.length, `${refused.length} refused requests after the session ended: ${refused.slice(0, 6).join(', ')}`)
      .toBeLessThan(12);
  });

  test('signing out shows the login screen', async ({ page }) => {
    test.setTimeout(90_000);
    await loginAdmin(page, ADMIN, EMAIL!, PASSWORD!);
    await page.getByRole('button', { name: 'تسجيل الخروج' }).first().click({ timeout: 20_000 });
    await expect(page.locator('input[type="email"], input[name="email"]').first())
      .toBeVisible({ timeout: 20_000 });
    const stillInside = (await page.locator('body').innerText()).includes('شغل النهاردة');
    expect(stillInside, 'the dashboard is still on screen after signing out').toBe(false);
  });
});
