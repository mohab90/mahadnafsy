import { test, expect, type Page } from '@playwright/test';
import { loginAdmin } from '../helpers/adminLogin';

/**
 * The journeys a customer and the desk take, in a real browser against the
 * built site and admin served beside a real API — run in CI on the rows
 * api/tools/e2e-seed.cjs files (a paid student, a published course with a
 * lecture, a course to buy, two leads, an administrator).
 *
 * The checkout stops at the redirect to Paymob: the call that would ask Paymob
 * for a payment page is answered here, so nothing leaves the machine, and the
 * order the site created on the way is real.
 *
 * Needs the seed; against any other deployment it is skipped.
 */
const ADMIN = process.env.ADMIN_BASE_URL || 'http://127.0.0.1:4000';
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL || 'e2e.admin@mahad.test';
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD || 'MahadE2e#Admin2026';
const STUDENT_EMAIL = process.env.TEST_STUDENT_EMAIL || 'uat.student@mahad.test';
const STUDENT_PASSWORD = process.env.TEST_STUDENT_PASSWORD || 'MahadUat#2026';
const PAID_COURSE = 'e2e-course-paid';
const CHECKOUT_COURSE = 'e2e-course-checkout';

test.skip(process.env.E2E_SEEDED !== '1', 'needs the rows api/tools/e2e-seed.cjs files (set E2E_SEEDED=1 once seeded)');

// Video hosts answer with a blank page: the spec checks the lecture is handed
// to the player, not that a third party is up.
async function stubVideoHosts(page: Page) {
  await page.route(/https:\/\/(www\.)?(youtube(-nocookie)?\.com|youtu\.be|i\.ytimg\.com)\//, route =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>video</title>' }));
}

async function signInStudent(page: Page) {
  await page.goto('/auth');
  const identifier = page.getByPlaceholder(/example@domain\.com/).first();
  await identifier.waitFor({ state: 'visible', timeout: 20_000 });
  await identifier.fill(STUDENT_EMAIL);
  await page.locator('input[type="password"]').first().fill(STUDENT_PASSWORD);
  await page.getByRole('button', { name: /^دخول$/ }).first().click();
  await expect.poll(async () => (await page.context().cookies()).some(c => c.name === 'authToken' && !!c.value),
    { timeout: 20_000, message: 'no session cookie after signing in' }).toBe(true);
  await expect(page).not.toHaveURL(/\/auth(\?|$)/, { timeout: 20_000 });
}

test('a course page shows the course and its price', async ({ page }) => {
  const resp = await page.goto(`/course/${CHECKOUT_COURSE}`);
  expect(resp?.status()).toBeLessThan(400);
  await expect(page.getByRole('heading', { name: /كورس اختبار E2E للشراء/ }).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/2[,٬]?400/).first()).toBeVisible();
});

test('checkout reserves the order at the catalogue price and hands the customer to Paymob', async ({ page }) => {
  await signInStudent(page);
  let intent: { orderId?: string; amount?: number } = {};
  page.on('response', async (r) => {
    if (r.url().includes('/api/public/checkout-intent') && r.request().method() === 'POST') {
      intent = await r.json().catch(() => ({}));
    }
  });
  let initBody: Record<string, unknown> | null = null;
  await page.route('**/api/payments/paymob-init', async (route) => {
    initBody = route.request().postDataJSON();
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ ok: true, iframeUrl: 'https://accept.paymob.com/api/acceptance/iframes/1?payment_token=e2e' }),
    });
  });
  await page.route('https://accept.paymob.com/**', route =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Paymob</title><h1>Paymob</h1>' }));

  await page.goto(`/checkout?type=course&id=${CHECKOUT_COURSE}`);
  await page.locator('#checkout-customer-name').fill('طالبة الاختبار');
  await page.locator('#checkout-customer-email').fill(STUDENT_EMAIL);
  await page.locator('#checkout-customer-phone').fill('01099990000');
  await page.getByRole('button', { name: /ادفع الآن/ }).click();

  await expect(page).toHaveURL(/accept\.paymob\.com\/api\/acceptance\/iframes\/1/, { timeout: 30_000 });
  expect(intent.orderId, 'the site created an order before leaving').toBeTruthy();
  expect(Number(intent.amount)).toBeGreaterThan(0);
  expect(Number(intent.amount)).toBeLessThanOrEqual(2400);
  expect(initBody).toMatchObject({ orderId: intent.orderId, paymentMethod: 'paymob', customerEmail: STUDENT_EMAIL });
  expect(Number((initBody as unknown as { amount: number }).amount)).toBe(Number(intent.amount));
});

test('a paid student opens their course and its paid lecture is handed to the player', async ({ page }) => {
  await stubVideoHosts(page);
  await signInStudent(page);
  await page.goto('/my-account');
  await page.getByRole('button', { name: /كورساتي/ }).first().click();
  await expect(page.getByText(/كورس اختبار E2E المدفوع/).first()).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: /متابعة التعلم/ }).first().click();
  await expect(page.getByText(/المحاضرة الأولى في الاختبار/).first()).toBeVisible({ timeout: 20_000 });
  // The paid lecture's address is not in the catalogue: the player asks the
  // enrolment-checked endpoint for a signed one.
  const access = page.waitForResponse(r => /\/api\/me\/lectures\/e2e-lecture-2\/access/.test(r.url()), { timeout: 30_000 });
  await page.getByText(/المحاضرة الثانية المدفوعة/).first().click();
  const answer = await access;
  expect(answer.status()).toBe(200);
  const body = await answer.json();
  expect(body.accessible, JSON.stringify(body)).toBe(true);
  expect(body.video_url).toContain('/api/media/lectures/e2e-lecture-2?ticket=');
  await expect(page.locator('iframe[src*="/api/media/lectures/e2e-lecture-2"]').first()).toBeAttached({ timeout: 20_000 });
});

test('an administrator signs in and sees the leads list', async ({ page }) => {
  await loginAdmin(page, ADMIN, ADMIN_EMAIL, ADMIN_PASSWORD);
  await page.goto(`${ADMIN}/dashboard/leads`);
  await expect(page.getByText('عميل اختبار E2E 1').first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('عميل اختبار E2E 2').first()).toBeVisible();
});

test('the paid course page loads the signed-in student\'s own record', async ({ page }) => {
  await signInStudent(page);
  const subscriber = page.waitForResponse(r => r.url().includes('/api/me/subscriber'), { timeout: 30_000 });
  await page.goto(`/course/${PAID_COURSE}`);
  expect((await subscriber).status()).toBe(200);
  await expect(page.getByRole('heading', { name: /كورس اختبار E2E المدفوع/ }).first()).toBeVisible({ timeout: 20_000 });
});
