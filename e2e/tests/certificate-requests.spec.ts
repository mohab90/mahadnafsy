import { test, expect } from '@playwright/test';
import { loginAdmin } from '../helpers/adminLogin';
import { apiCall } from '../helpers/adminApi';

/**
 * «طلبات الشهادات», in a browser against a real API and database (the CI seed: e2e/README.md).
 *
 * It stands in for source-text rules that pinned this screen (`systemLogCertificatesRefundsTracks`: the list is read from the server, the names of the stages, a certificate is paid
 * before the system is paid; `financeSafetyContracts`: the certificate screens keep payments in the ledger-backed workflow):
 *
 *   • a request made on the server is on the screen with its price, what was paid, what is left, the stage it waits at, and what is missing from the client's data;
 *   • the screen's «دفع» opens the payment dialog on that certificate with the remainder, and the payment it records is a certificate payment tied to that request;
 *   • afterwards the request is paid in full (nothing left) and has moved to the review stage, and the stage counters follow.
 *
 * It makes one request each run for the seeded student (a type that has none open), so it works from a freshly seeded database.
 */

const ADMIN = process.env.ADMIN_BASE_URL || 'http://127.0.0.1:4000';
const EMAIL = process.env.E2E_ADMIN_EMAIL;
const PASSWORD = process.env.E2E_ADMIN_PASSWORD;
// Clients who finished a course (the seed): a second open request of one type for one course is refused, so each run takes the first that is free.
const HOLDERS = [['e2e-student-sub', 'e2e-course-paid'], ['e2e-payer-sub', 'e2e-course-checkout']];
// A price of its own each run, so the button « دفع <price> » is this run's request and no earlier one.
const PRICE = 300 + (Date.now() % 90) + 1;

test.describe('the certificate requests screen', () => {
  test.skip(!EMAIL || !PASSWORD, 'E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD not set');

  test('a request is listed with its price and remainder, is paid from the screen, and moves to review', async ({ page }) => {
    await loginAdmin(page, ADMIN, EMAIL!, PASSWORD!);

    // One open request of a type this client has none of (a second one of the same type is refused by the server).
    let requestId: string | null = null;
    search: for (const [subscriberId, courseId] of HOLDERS) {
      for (const type of ['EXPERIENCE_EXTERNAL', 'PRACTICE_EXTERNAL', 'NATIONAL_COUNCIL', 'AMERICAN_BOARD', 'AIN_SHAMS', 'SOCIAL_SOLIDARITY', 'OTHER']) {
        const made = await apiCall<{ id: string }>(page, 'POST', '/api/admin/certificate-requests', { subscriberId, courseId, type, price: PRICE });
        if (made.status === 201) { requestId = made.body!.id; break search; }
      }
    }
    expect(requestId, 'a request could be made for the seeded student').not.toBeNull();

    await page.goto(`${ADMIN}/dashboard/cert_requests`);
    await expect(page.getByRole('button', { name: `دفع ${PRICE}` }).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/ناقص: .*الاسم بالإنجليزي/).first(), 'what is missing from the client\'s data is said').toBeVisible();
    const card = page.locator('div', { has: page.getByRole('button', { name: `دفع ${PRICE}` }) }).last();
    await expect(card.getByText('في انتظار تأكيد الدفعة').first()).toBeVisible();

    // «دفع»: the payment dialog opens on this certificate, with what is left.
    await page.getByRole('button', { name: `دفع ${PRICE}` }).first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText(new RegExp(`متبقي: ${PRICE}`))).toBeVisible();
    await dialog.locator('input[type="number"]').first().fill(String(PRICE));
    await dialog.locator('select').last().selectOption({ label: 'كاش' });
    await dialog.locator('label', { hasText: 'رقم العملية' }).locator('xpath=following::input[1]').fill(`E2E-CERT-${Date.now()}`);

    const posted: Record<string, any>[] = [];
    page.on('request', request => {
      if (request.method() === 'POST' && /\/api\/admin\/subscriber-payments(\?|$)/.test(request.url())) posted.push(JSON.parse(request.postData() || '{}'));
    });
    const answered = page.waitForResponse(r => r.request().method() === 'POST' && /\/api\/admin\/subscriber-payments(\?|$)/.test(r.url()));
    await dialog.getByRole('button', { name: 'تسجيل الدفعة', exact: true }).click();
    const response = await answered;
    expect(response.status(), await response.text()).toBe(200);

    expect(posted).toHaveLength(1);
    const payment = posted[0].payment ?? posted[0];
    expect(String(payment.paymentType).toLowerCase()).toBe('certificate');
    expect(payment.certId ?? payment.certReqId ?? payment.certificate_request_id, 'tied to the request it pays').toBe(requestId);
    expect(Number(payment.amount)).toBe(PRICE);
    await expect(dialog).toBeHidden({ timeout: 15_000 });

    // Paid in full: the server holds it, and the screen after a fresh load shows nothing left and the review stage.
    const server = await apiCall<{ id: string; paid: number; remaining: number | null; complete: boolean }[]>(page, 'GET', '/api/admin/certificate-requests');
    const mine = (server.body || []).find((item: any) => item.id === requestId) as any;
    expect([Number(mine.paid), Number(mine.remaining), mine.complete], 'the request holds what was paid, with nothing left').toEqual([PRICE, 0, true]);
    await page.goto(`${ADMIN}/dashboard/cert_requests`);
    await expect(page.getByRole('button', { name: `دفع ${PRICE}` }), 'nothing left to pay on it').toHaveCount(0);
    await expect(page.getByText(/[1-9][0-9]* [/] [0-9]+ طلب/), 'the list has loaded').toBeVisible({ timeout: 20_000 });
    const reviewOption = page.locator('option', { hasText: 'تحت المراجعة' }).first();
    await reviewOption.waitFor({ state: 'attached', timeout: 20_000 });
    const review = await reviewOption.textContent();
    expect(Number((review || '').match(/[(]([0-9]+)[)]/)?.[1]), 'the review-stage counter follows').toBeGreaterThan(0);
  });
});
