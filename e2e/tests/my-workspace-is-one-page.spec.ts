import { test, expect } from '@playwright/test';
import { loginAdmin } from '../helpers/adminLogin';

/**
 * «ملفي الشخصي» is one page, and it is the person's own work.
 *
 * It used to stack two whole panels: «شغل النهاردة» with its greeting and
 * avatar, then the profile panel with a second greeting, a second avatar and
 * its own tab bar halfway down — two pages on top of each other, the same
 * links twice, and the tabs below the fold. Reported as «غير مرتب ومنسق ابدا
 * وتابات بتظهر تحت وترتيب غلط كان صفحتين ركبوا علي بعض».
 *
 * And it was the same page for everybody: the HR manager read «0 من 10
 * تحويلات» and «تقدمك نحو الهدف الشهري» about clients she does not close,
 * beside a lead desk that is not hers.
 */

const ADMIN = process.env.ADMIN_BASE_URL || 'http://127.0.0.1:4000';
const PASSWORD = process.env.UAT_PASSWORD || 'MahadUat#2026';
const EMAIL = process.env.E2E_ADMIN_EMAIL;

// The figures that belong to someone with a monthly target.
const TARGET_TALK = ['تحويلات الشهر', 'تقدمك نحو الهدف الشهري', 'نشاطك الأسبوعي'];

test.describe('ملفي الشخصي', () => {
  test.skip(!EMAIL, 'E2E_ADMIN_EMAIL not set');

  test('greets the person once, with the tabs at the top', async ({ page }) => {
    test.setTimeout(90_000);
    await loginAdmin(page, ADMIN, 'uat.sales@mahad.test', PASSWORD);
    await page.goto(`${ADMIN}/dashboard/staff_home`);
    await expect.poll(async () => (await page.locator('#root section').first().innerText()).length,
      { timeout: 15_000 }).toBeGreaterThan(20);

    const body = (await page.locator('#root section').first().innerText());
    const greetings = body.match(/صباح الخير|مساء الخير|مساء النور|مرحباً يا/g) || [];
    expect(greetings.length, `greeted ${greetings.length} times: ${greetings.join(', ')}`).toBeLessThanOrEqual(1);

    // The tabs are the first thing under the heading, not a second page's bar
    // somewhere below. Measured by position: above most of the content.
    const tab = page.getByRole('button', { name: 'سجلي ومراسلاتي' }).first();
    await expect(tab).toBeVisible();
    const box = await tab.boundingBox();
    expect(box!.y, 'the tab bar sits below the fold, where the second page used to start').toBeLessThan(500);

    // One tab bar, with its own tabs — read from the bar itself, since the top
    // nav and the quick row carry some of the same words.
    const bar = page.locator('div').filter({ has: page.getByRole('button', { name: 'شغل النهاردة' }) }).last();
    const barText = (await bar.innerText()).replace(/\s+/g, ' ');
    for (const label of ['شغل النهاردة', 'سجلي ومراسلاتي', 'الإعدادات']) {
      expect(barText, `the tab bar is missing «${label}»`).toContain(label);
    }
    // ملفي الوظيفي is a screen of its own; it was a tab here as well.
    expect(barText.includes('ملفي الوظيفي'), 'ملفي الوظيفي is a tab here and a screen of its own').toBe(false);
  });

  test('shows a salesperson their target and the HR manager none of it', async ({ page }) => {
    test.setTimeout(120_000);

    await loginAdmin(page, ADMIN, 'uat.sales@mahad.test', PASSWORD);
    await page.goto(`${ADMIN}/dashboard/staff_home`);
    await expect(page.getByRole('button', { name: 'أدائي' })).toHaveCount(1);
    await page.getByRole('button', { name: 'أدائي' }).click();
    await expect(page.locator('#root section').first()).toContainText('تحويلات الشهر');

    await page.context().clearCookies();
    await loginAdmin(page, ADMIN, 'uat.hr-manager@mahad.test', PASSWORD);
    await page.goto(`${ADMIN}/dashboard/staff_home`);
    await expect.poll(async () => (await page.locator('#root section').first().innerText()).length,
      { timeout: 15_000 }).toBeGreaterThan(20);
    const hrPage = await page.locator('#root section').first().innerText();
    for (const phrase of TARGET_TALK) {
      expect(hrPage.includes(phrase), `the HR manager is shown «${phrase}» — a salesperson's figure`).toBe(false);
    }
    await expect(page.getByRole('button', { name: 'أدائي' })).toHaveCount(0);
  });
});
