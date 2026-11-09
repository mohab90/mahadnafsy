import { test, expect, type Page } from '@playwright/test';
import { loginAdmin } from '../helpers/adminLogin';
import { apiCall } from '../helpers/adminApi';

/**
 * The client's page, in a browser against a real API and database (the CI seed: e2e/README.md).
 *
 * It stands in for source-text rules that pinned this page (`backGoesBack`: no exit of the client page is a fixed trip to the overview; `systemLogCertificatesRefundsTracks`:
 * for a contact a result is enough; `criticalFrontendContracts`: the page waits for the server before it reports success, and shared CRM state is not kept in the browser):
 *
 *   • «رجوع» returns to the screen the client was opened from, not to the overview;
 *   • «تسجيل تواصل» stays off until there is a result (or a note), then a result alone is enough, the server is called once with it, and the contact is still there after the
 *     page is loaded again — it lives on the server, not in this browser;
 *   • the hero's figures are the payments the server holds.
 *
 * It uses the client the payment-dialog spec uses (its own seeded one), and adds a contact to it each run, so it compares before and after.
 */

const ADMIN = process.env.ADMIN_BASE_URL || 'http://127.0.0.1:4000';
const EMAIL = process.env.E2E_ADMIN_EMAIL;
const PASSWORD = process.env.E2E_ADMIN_PASSWORD;
const CLIENT = process.env.E2E_PAYER_ID || 'e2e-payer-sub';

const communicationsOf = async (page: Page) => {
  const res = await apiCall<unknown[]>(page, 'GET', `/api/staff/subscribers/${CLIENT}/communications`);
  expect(res.status, 'the contacts of the client can be read').toBe(200);
  return res.body ?? [];
};

test.describe('the client\'s page', () => {
  test.skip(!EMAIL || !PASSWORD, 'E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD not set');

  test('«رجوع» goes back to the screen the client was opened from, not to the overview', async ({ page }) => {
    await loginAdmin(page, ADMIN, EMAIL!, PASSWORD!);
    await page.goto(`${ADMIN}/dashboard/my_clients`);
    await expect(page).toHaveURL(/\/dashboard\/my_clients/);
    await page.locator('tr', { hasText: '01099990001' }).getByRole('button').first().click();
    await expect(page).toHaveURL(/\/client\//, { timeout: 15_000 });
    await page.getByRole('button', { name: 'رجوع' }).first().click();
    await expect(page, 'back to the clients list it came from').toHaveURL(/\/dashboard\/my_clients/, { timeout: 15_000 });
  });

  test('a contact needs a result or a note, a result alone is enough, and the contact lives on the server', async ({ page }) => {
    await loginAdmin(page, ADMIN, EMAIL!, PASSWORD!);
    await page.goto(`${ADMIN}/client/${CLIENT}`);
    const before = (await communicationsOf(page)).length;
    await page.getByRole('button', { name: 'تسجيل تواصل' }).first().click();
    const dialog = page.getByRole('dialog');
    const save = dialog.getByRole('button', { name: 'سجّل التواصل', exact: true });
    await expect(save, 'no result, no note: nothing to save').toBeDisabled();

    const posted: Record<string, any>[] = [];
    page.on('request', request => {
      if (request.method() === 'POST' && /\/api\/staff\/subscribers\/[^/]+\/communications$/.test(request.url())) posted.push(JSON.parse(request.postData() || '{}'));
    });
    await dialog.getByRole('button', { name: 'مردش' }).click();
    await expect(save, 'a result alone is enough').toBeEnabled();
    const answered = page.waitForResponse(r => r.request().method() === 'POST' && /\/communications$/.test(r.url()));
    await save.click();
    expect((await answered).status()).toBe(200);

    expect(posted).toHaveLength(1);
    expect(posted[0].outcome).toBe('مردش');
    expect(String(posted[0].notes || '')).toBe('');
    expect(posted[0].type).toBe('call');

    // Without reloading anything, the page already knows: the hero's «آخر تواصل» and the tab's count follow the contact just saved.
    const lastContact = page.locator('p', { hasText: 'آخر تواصل' }).locator('xpath=preceding-sibling::p[1]').first();
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
    await expect(lastContact, 'the last contact is the one just saved (today, Cairo), not «لا يوجد» or an older day').toHaveText(today, { timeout: 10_000 });
    await expect(page.getByRole('button', { name: `التواصل (${before + 1})` }), 'and the tab counts it, without a reload').toBeVisible({ timeout: 10_000 });

    // Loaded again, the contact is still there: it is the server's, not this browser's.
    await page.reload();
    await expect(page.getByRole('button', { name: /التواصل \((\d+)\)/ })).toBeVisible();
    expect((await communicationsOf(page)).length, 'one more contact on the client').toBe(before + 1);
  });
});
