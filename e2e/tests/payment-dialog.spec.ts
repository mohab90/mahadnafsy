import { test, expect, type Page } from '@playwright/test';
import { loginAdmin } from '../helpers/adminLogin';
import { apiCall } from '../helpers/adminApi';

/**
 * «تسجيل دفعة» on the client's page, the dialog the owner uses most — in a browser, against a real API and database (the CI seed: e2e/README.md).
 *
 * It stands in for the source-text rules that pinned this dialog (`oneAgreedPriceEverywhere`: the dialog hands the handler the price it shows, an instalment
 * only a price the desk changed; `financeSafetyContracts`: a client payment goes through the transactional payment API and the screens read the ledger back):
 * what they said in a regular expression is here done with a click.
 *
 *   • the dialog asks for what it needs — the course, the branch (whose price list is quoted), the real Arabic name, the confirmed phone, the box — and its button
 *     stays off, the server uncalled, until it has them;
 *   • picking the course and the branch shows the price of that branch's list, and the request carries exactly that price as the course's price;
 *   • a part payment is recorded once, for the amount the desk typed and under the reference typed, and the client has one more payment afterwards, listed
 *     with that number on the client's page;
 *   • an instalment pays towards the price already agreed: «كل المتبقي» is the remainder, and the agreed price is not sent again.
 *
 * It writes payments into its own seeded client («عميلة الدفعات», api/tools/e2e-seed.cjs) so the student the other journeys sign in as is left alone, each run (each with its own reference, so the duplicate-payment guard lets a rerun through), so what it compares
 * is before and after, not absolute figures.
 */

const ADMIN = process.env.ADMIN_BASE_URL || 'http://127.0.0.1:4000';
const EMAIL = process.env.E2E_ADMIN_EMAIL;
const PASSWORD = process.env.E2E_ADMIN_PASSWORD;
const CLIENT = process.env.E2E_PAYER_ID || 'e2e-payer-sub';
const COURSE_LABEL = 'كورس اختبار E2E للشراء';
const BRANCH_LABEL = 'أونلاين — مصريين';

const isPaymentPost = (url: string) => /\/api\/admin\/subscriber-payments(\?|$)/.test(url);

const paymentsOf = async (page: Page) => {
  const res = await apiCall<unknown[]>(page, 'GET', `/api/admin/subscribers/${CLIENT}/payments`);
  expect(res.status, 'the payments of the client can be read').toBe(200);
  return res.body ?? [];
};

const collect = (page: Page) => {
  const posted: { url: string; body: Record<string, any> }[] = [];
  page.on('request', request => {
    if (request.method() === 'POST' && isPaymentPost(request.url())) posted.push({ url: request.url(), body: JSON.parse(request.postData() || '{}') });
  });
  return posted;
};

const openDialog = async (page: Page) => {
  await loginAdmin(page, ADMIN, EMAIL!, PASSWORD!);
  await page.goto(`${ADMIN}/client/${CLIENT}`);
  await page.getByRole('button', { name: 'تسجيل دفعة' }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  return dialog;
};

/** The reference field («رقم العملية»): a new one each run, or the guard against recording the same payment twice refuses a rerun. */
const referenceField = (dialog: ReturnType<Page['getByRole']>) => dialog.locator('label', { hasText: 'رقم العملية' }).locator('xpath=following::input[1]');

test.describe('the payment dialog on a client\'s page', () => {
  test.skip(!EMAIL || !PASSWORD, 'E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD not set');

  test('asks for what it needs, quotes the branch\'s price, and records exactly what was typed', async ({ page }) => {
    const dialog = await openDialog(page);
    const posted = collect(page);

    // Nothing is chosen yet: the button is off, and nothing was sent.
    const submit = dialog.getByRole('button', { name: 'تسجيل الدفعة', exact: true });
    await expect(submit).toBeDisabled();
    expect(posted, 'an empty dialog must not call the server').toHaveLength(0);

    // The course and the branch: the branch's price list is quoted.
    await dialog.locator('select').nth(1).selectOption({ label: COURSE_LABEL });
    await dialog.locator('select').nth(2).selectOption({ label: BRANCH_LABEL });
    const quoted = await dialog.getByText(/سعر الكورس في .*:/).first().locator('xpath=..').innerText();
    const price = Number((quoted.match(/([\d,]+)\s*جنيه/) || [])[1]?.replace(/,/g, ''));
    expect(price, `the price quoted for ${BRANCH_LABEL} (${quoted})`).toBeGreaterThan(0);

    // Without the real name, the confirmed phone and a box it still refuses.
    const amount = Math.floor(price / 2);
    await dialog.locator('input[type="number"]').first().fill(String(amount));
    await expect(submit, 'no name, no confirmed phone, no box: still off').toBeDisabled();

    await dialog.getByPlaceholder('مثال: أحمد محمد علي').fill('طالبة اختبار تجريبية');
    await dialog.getByRole('checkbox').first().check();
    await dialog.locator('select').last().selectOption({ label: 'كاش' });
    const reference = `E2E-BOOK-${Date.now()}`;
    await referenceField(dialog).fill(reference);
    await expect(submit).toBeEnabled();

    const before = (await paymentsOf(page)).length;
    const response = page.waitForResponse(r => r.request().method() === 'POST' && isPaymentPost(r.url()));
    await submit.click();
    const answered = await response;
    expect(answered.status(), await answered.text()).toBe(200);

    // One call, carrying what the desk typed and the price the dialog showed.
    expect(posted).toHaveLength(1);
    const payment = posted[0].body.payment ?? posted[0].body;
    expect(Number(payment.amount)).toBe(amount);
    expect(String(payment.currency || 'EGP').toUpperCase()).toBe('EGP');
    expect(Number(payment.courseExpected ?? payment.course_expected ?? payment.agreedPrice), 'the course\'s price is the one the dialog quoted').toBe(price);

    expect(payment.transactionId, 'the number typed in «رقم العملية» travels as the payment transaction number').toBe(reference);

    await expect(dialog).toBeHidden({ timeout: 15_000 });
    expect((await paymentsOf(page)).length, 'one more payment on the client').toBe(before + 1);
    await page.reload();
    await expect(page.getByRole('button', { name: /حجز \/ دفع \((\d+)\)/ })).toBeVisible();
  });

  test('an instalment pays towards the price already agreed: «كل المتبقي» is the remainder and the agreed price is not sent again', async ({ page }) => {
    const dialog = await openDialog(page);
    await dialog.getByRole('button', { name: /قسط/ }).first().click();

    // The course with something still owed (the booking test above leaves one).
    const owing = dialog.getByText(/متبقي: [\d,]+/).first();
    test.skip(!(await owing.isVisible().catch(() => false)), 'no part-paid course on this client: run the booking test first');
    const remaining = Number(((await owing.innerText()).match(/متبقي: ([\d,]+)/) || [])[1].replace(/,/g, ''));
    await owing.click();
    await dialog.getByRole('button', { name: /كل المتبقي/ }).click();
    await expect(dialog.locator('input[type="number"]').first()).toHaveValue(String(remaining));
    await expect(dialog.getByText(/السعر المتفق عليه: [\d,]+/)).toBeVisible();

    const posted = collect(page);
    await dialog.locator('select').last().selectOption({ label: 'كاش' });
    await referenceField(dialog).fill(`E2E-INST-${Date.now()}`);
    const response = page.waitForResponse(r => r.request().method() === 'POST' && isPaymentPost(r.url()));
    await dialog.getByRole('button', { name: 'تسجيل الدفعة', exact: true }).click();
    const answered = await response;
    expect(answered.status(), await answered.text()).toBe(200);

    expect(posted).toHaveLength(1);
    const payment = posted[0].body.payment ?? posted[0].body;
    expect(Number(payment.amount), 'the whole remainder, as shown').toBe(remaining);
    expect(payment.courseExpected ?? payment.course_expected, 'an instalment does not re-send the agreed price unless the desk changed it').toBeUndefined();
    await expect(dialog).toBeHidden({ timeout: 15_000 });
    await page.reload();
    await expect(page.getByText('✅ مكتمل').first()).toBeVisible();
  });
});
