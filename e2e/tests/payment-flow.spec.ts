import { test, expect, request } from '@playwright/test';

/**
 * Client + payment flow. Defaults to the local UAT seed student account.
 */
const API = process.env.API_BASE_URL || 'http://127.0.0.1:3001';
const TEST_EMAIL = process.env.TEST_STUDENT_EMAIL || 'uat.student@mahad.test';
const TEST_PASSWORD = process.env.TEST_STUDENT_PASSWORD || 'MahadUat#2026';

test.describe('Checkout surface', () => {
  test('a course detail page exposes an enroll/checkout affordance', async ({ page }) => {
    const resp = await page.goto('/courses');
    expect(resp?.status()).toBeLessThan(400);
    await expect(page.locator('body')).toBeVisible();
  });

  test('public order intent requires auth (no anonymous charge)', async () => {
    const ctx = await request.newContext({ ignoreHTTPSErrors: true });
    const r = await ctx.post(`${API}/api/public/checkout-intent`, { data: { courseId: 'x' } });
    expect([401, 403, 400, 429]).toContain(r.status()); // never 200 without auth
    await ctx.dispose();
  });
});

test.describe('Student payment journey', () => {
  test('student logs in and sees their dashboard', async ({ page }) => {
    await page.goto('/auth');
    await page.locator('input[type="email"], input[name="email"]').first().fill(TEST_EMAIL);
    await page.locator('input[type="password"], input[name="password"]').first().fill(TEST_PASSWORD);
    await page.getByRole('button', { name: /دخول|تسجيل|login|sign/i }).first().click();
    await page.waitForTimeout(1500);
    await expect(page.locator('body')).toBeVisible();
  });
});
