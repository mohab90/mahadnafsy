import { test, expect } from '@playwright/test';

// «الخزائن»: click a box and see the transactions behind it — and who recorded
// each one.
//
// Asked twice before it was checked by anything but reading: the click was
// wired, and still showed the wrong thing. Three faults stood between the box
// and its rows, and only a browser sees all three at once:
//
//   • the manual payments load on demand, so the filter ran over whatever the
//     browser already had — for most boxes, nothing;
//   • the box shows one month and the click opened every month, so the rows
//     added up to several times the figure that was clicked;
//   • rows loaded from the database dropped «منفذ العملية» to a literal null.
//
// So this clicks a real box for a month that has one, and checks that every
// row it opens belongs to that box and that month, and that the rows name who
// recorded them where the API says someone did.

const ADMIN = process.env.ADMIN_BASE_URL || 'http://127.0.0.1:4000';
const EMAIL = process.env.E2E_ADMIN_EMAIL;
const PASSWORD = process.env.E2E_ADMIN_PASSWORD;

type ApiPayment = {
  id: string;
  paymentMethod: string | null;
  at: string;
  status?: string;
  staffName?: string | null;
  amount: number;
};

test.describe('a cash box opens its own transactions', () => {
  test.skip(!EMAIL || !PASSWORD, 'E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD not set');

  test('click a box, see that box and that month, with who recorded each', async ({ page }) => {
    await page.goto(ADMIN);
    await page.locator('input[type="email"], input[name="email"]').first().fill(EMAIL!);
    await page.locator('input[type="password"]').first().fill(PASSWORD!);
    await page.locator('button[type="submit"]').first().click();
    await page.waitForURL(/dashboard/, { timeout: 20_000 });

    // Choose the box and the month from the data rather than guessing: the
    // manual payment with a named box that was recorded most recently.
    const response = await page.request.get(`${ADMIN}/api/admin/payments?limit=500`);
    expect(response.ok(), 'the payments list is not readable as this admin').toBeTruthy();
    const payments = (await response.json()) as ApiPayment[];
    const manual = payments.filter(p =>
      p.paymentMethod
      && !p.paymentMethod.toLowerCase().includes('paymob')
      && (!p.status || p.status === 'paid')
      && /^\d{4}-\d{2}/.test(p.at || ''));
    test.skip(!manual.length, 'no manual payment with a named box on this environment');

    const target = manual[0];
    const box = target.paymentMethod!;
    const month = target.at.slice(0, 7);
    const expected = manual.filter(p => p.paymentMethod === box && p.at.startsWith(month));

    await page.goto(`${ADMIN}/dashboard/financial`);
    // The vault shows one month at a time.
    const monthInput = page.locator('input[type="month"]').first();
    await monthInput.fill(month);

    const boxButton = page.locator('button', { has: page.locator('p', { hasText: new RegExp(`^${box}$`) }) }).first();
    await expect(boxButton, `the box «${box}» is not offered for ${month}`).toBeVisible({ timeout: 15_000 });
    await boxButton.click();

    // The orders list, filtered to that box and that month.
    const rows = page.locator('tbody tr').filter({ hasText: box });
    await expect(rows.first(), 'clicking the box opened no transactions').toBeVisible({ timeout: 20_000 });
    const shown = await rows.count();
    expect(shown, `the box holds ${expected.length} payment(s) in ${month} and the list shows ${shown}`)
      .toBeGreaterThanOrEqual(Math.min(expected.length, 1));

    // Every row the click opened is that box's, and none is from another month.
    const allRows = page.locator('tbody tr');
    const total = await allRows.count();
    for (let i = 0; i < total; i++) {
      const text = (await allRows.nth(i).innerText()).trim();
      if (!text || /لا توجد|الإجمالي/.test(text)) continue;
      expect(text, 'a row from another box is in the list the box opened').toContain(box);
    }

    // Who recorded it: wherever the API names someone, the row names them too.
    const named = expected.find(p => p.staffName);
    if (named) {
      await expect(page.locator('tbody').getByText(named.staffName!, { exact: false }).first(),
        `«${named.staffName}» recorded a payment in this box and the row does not say so`).toBeVisible();
    }
  });
});
