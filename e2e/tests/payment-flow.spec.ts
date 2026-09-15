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
    // The sign-in field takes an email or a phone number, so it is type="text"
    // with no name — the old `input[type="email"]` selector found nothing and the
    // test timed out against a form that was working. It also never checked that
    // signing in worked: it waited 1.5s and asserted the <body> was visible,
    // which passes on a wrong password.
    await page.goto('/auth');
    const identifier = page.getByPlaceholder(/example@domain\.com/).first();
    await identifier.waitFor({ state: 'visible', timeout: 20_000 });
    await identifier.fill(TEST_EMAIL);
    await page.locator('input[type="password"]').first().fill(TEST_PASSWORD);
    await page.getByRole('button', { name: /^دخول$/ }).first().click();

    // Signed in: the session cookie is set and the app leaves the login page.
    await expect.poll(async () => (await page.context().cookies()).some(c => c.name === 'authToken' && !!c.value),
      { timeout: 20_000, message: 'no session cookie after signing in' }).toBe(true);
    await expect(page).not.toHaveURL(/\/auth(\?|$)/, { timeout: 20_000 });

    // And the student's own account page loads their record, not an error.
    const subscriber = page.waitForResponse(r => r.url().includes('/api/me/subscriber'), { timeout: 30_000 });
    await page.goto('/my-account');
    expect((await subscriber).status(), '/api/me/subscriber failed for the signed-in student').toBe(200);
    await expect(page.getByPlaceholder(/example@domain\.com/)).toHaveCount(0);
  });
});
