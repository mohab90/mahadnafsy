import { test, expect } from '@playwright/test';

test.describe('E2E Authentication Flow', () => {
  test('User can log in to the dashboard', async ({ page }) => {
    await page.goto('/');

    // Assume there is a login button on the home page or it auto-redirects
    await page.goto('/auth');

    // Look for the email and password inputs
    const emailInput = page.getByPlaceholder('البريد الإلكتروني');
    const passwordInput = page.getByPlaceholder('كلمة المرور');
    
    // Fill in test credentials (these should be mock/test users in DB)
    await emailInput.fill('test@example.com');
    await passwordInput.fill('password123');

    // Click the login button
    const loginBtn = page.getByRole('button', { name: 'تسجيل الدخول' });
    await loginBtn.click();

    // Verify successful login by checking for the Dashboard header
    await expect(page).toHaveURL(/\/dashboard/);
    const dashboardHeader = page.getByRole('heading', { name: 'لوحة التحكم' });
    await expect(dashboardHeader).toBeVisible();
  });
});
