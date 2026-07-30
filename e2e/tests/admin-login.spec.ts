import { test, expect } from '@playwright/test';

/**
 * Admin login smoke. Defaults to the local UAT seed account, while still
 * allowing CI to override credentials through env vars.
 */
const ADMIN = process.env.ADMIN_BASE_URL || 'http://127.0.0.1:4000';
test.describe('Admin dashboard', () => {
  test('login page renders', async ({ page }) => {
    const resp = await page.goto(ADMIN);
    expect(resp?.status()).toBeLessThan(400);
    await expect(page.locator('input[type="email"], input[type="text"], input[name="email"]').first()).toBeVisible();
  });
});
