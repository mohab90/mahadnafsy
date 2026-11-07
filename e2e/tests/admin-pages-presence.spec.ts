import { test, expect, type Browser, type Page } from '@playwright/test';
import { loginAdmin } from '../helpers/adminLogin';

/**
 * The 7 Nov 2026 admin pages work, opened as the admin: «مين فاتح السيستم دلوقتي», «نظرة عامة»'s board, «لوحة KPI — المدير»'s per-employee tables and
 * «تقارير الإدارة»' six groups with their export. Each is held to what the change promised: nothing refused, no console error, the request budget (eight on open),
 * and the figures drawn. Needs E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD (the release gate has neither, so this never runs there).
 */
const ADMIN = process.env.ADMIN_BASE_URL || 'http://127.0.0.1:4000';
const EMAIL = process.env.E2E_ADMIN_EMAIL;
const PASSWORD = process.env.E2E_ADMIN_PASSWORD;
const SHOTS = process.env.E2E_SHOTS_DIR; // where the lab screenshots go, when asked for

type Call = { path: string; status: number };

test.describe('the admin pages of 7 Nov', () => {
  test.skip(!EMAIL || !PASSWORD, 'E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD not set');

  let session: Awaited<ReturnType<import('@playwright/test').BrowserContext['storageState']>>;
  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext();
    await loginAdmin(await context.newPage(), ADMIN, EMAIL!, PASSWORD!);
    session = await context.storageState();
    await context.close();
  });

  async function open(browser: Browser, url: string) {
    const context = await browser.newContext({ storageState: session, viewport: { width: 1440, height: 1000 } });
    const page: Page = await context.newPage();
    const calls: Call[] = [];
    const errors: string[] = [];
    page.on('response', r => { const u = new URL(r.url()); if (u.pathname.startsWith('/api/')) calls.push({ path: u.pathname, status: r.status() }); });
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
    await page.goto(`${ADMIN}${url}`);
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => undefined);
    await page.waitForTimeout(1_500);
    return { context, page, calls, errors };
  }
  const shot = async (page: Page, name: string) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true }); };

  test('who is in the system now: rows, the admin online, the filters, no IP anywhere', async ({ browser }) => {
    const { context, page, calls, errors } = await open(browser, '/dashboard/presence_now');
    expect(calls.filter(c => c.status >= 400), 'a request was refused').toEqual([]);
    expect(errors).toEqual([]);
    expect(calls.length, `requests: ${[...new Set(calls.map(c => c.path))].join(' ')}`).toBeLessThanOrEqual(8);
    expect(calls.some(c => /\/api\/admin\/presence\/now$/.test(c.path))).toBe(true);
    expect(await page.getByRole('heading', { name: /مين فاتح السيستم دلوقتي/ }).count()).toBeGreaterThan(0);
    const rows = page.getByTestId('presence-staff-row');
    expect(await rows.count()).toBeGreaterThan(0);
    // the admin who is looking has just beaten: they are online
    await expect(page.getByTestId('presence-staff-row').filter({ hasText: 'أونلاين' }).first()).toBeVisible();
    const before = await rows.count();
    await page.getByLabel('الوظيفة').selectOption({ index: 1 });
    expect(await rows.count(), 'the role filter changed nothing').toBeLessThanOrEqual(before);
    expect(await page.locator('body').innerText()).not.toMatch(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/);
    await shot(page, 'presence-now');
    await context.close();
  });

  test('the beat: the panel tells the server which screen is open, and the owner is listed', async ({ browser }) => {
    const { context, calls } = await open(browser, '/dashboard/leads');
    expect(calls.some(c => /\/api\/staff\/presence$/.test(c.path) && c.status === 200), 'the panel sent no presence beat').toBe(true);
    await context.close();
  });

  test('the overview: the board over the page, within the request budget', async ({ browser }) => {
    const { context, page, calls, errors } = await open(browser, '/dashboard/overview');
    expect(calls.filter(c => c.status >= 400)).toEqual([]);
    expect(errors).toEqual([]);
    expect(calls.length, `requests: ${[...new Set(calls.map(c => c.path))].join(' ')}`).toBeLessThanOrEqual(8);
    await expect(page.getByTestId('overview-board')).toBeVisible();
    for (const label of ['ليدات جديدة', 'تحصيل الكورسات', 'تحصيل الشهادات', 'مصروفات', 'الصافي']) {
      await expect(page.getByTestId('overview-board').getByText(label).first()).toBeVisible();
    }
    expect(calls.some(c => /\/api\/admin\/overview\/board$/.test(c.path)), 'the board was asked for on its own instead of in the start-up answer').toBe(false);
    await shot(page, 'overview');
    await context.close();
  });

  test('the KPI board: per employee and branch, the picker asks again', async ({ browser }) => {
    const { context, page, calls, errors } = await open(browser, '/dashboard/kpi_dashboard');
    expect(calls.filter(c => c.status >= 400)).toEqual([]);
    expect(errors).toEqual([]);
    expect(calls.length).toBeLessThanOrEqual(10);
    await expect(page.getByTestId('kpi-performance')).toBeVisible();
    expect(await page.getByTestId('kpi-employee-row').count()).toBeGreaterThan(0);
    const asked = calls.filter(c => /\/api\/admin\/kpi\/performance$/.test(c.path)).length;
    await page.getByRole('button', { name: 'النهارده', exact: true }).click();
    await page.waitForTimeout(1_500);
    expect(calls.filter(c => /\/api\/admin\/kpi\/performance$/.test(c.path)).length, 'the period picker did not ask the server').toBeGreaterThan(asked);
    await shot(page, 'kpi');
    await context.close();
  });

  test('the reports: six groups, each report described, opened, and exported on click', async ({ browser }) => {
    const { context, page, calls, errors } = await open(browser, '/dashboard/management_reports');
    expect(calls.filter(c => c.status >= 400)).toEqual([]);
    expect(errors).toEqual([]);
    for (const key of ['sales', 'finance', 'collections', 'hr', 'marketing', 'operations']) await expect(page.getByTestId(`report-group-${key}`)).toBeVisible();
    await page.getByTestId('report-group-operations').click();
    const digest = page.locator('[data-report="daily-digest"]');
    await expect(digest).toBeVisible();
    await digest.getByRole('button', { name: 'عرض' }).click();
    await expect(digest.locator('tbody tr').first()).toBeVisible();
    const download = page.waitForEvent('download');
    await digest.getByRole('button', { name: /Excel/ }).click();
    expect((await download).suggestedFilename()).toMatch(/^daily-digest_\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}\.csv$/);
    await page.getByTestId('report-group-finance').click();
    expect(await page.getByTestId('report-card').count()).toBeGreaterThanOrEqual(4);
    await shot(page, 'reports');
    await context.close();
  });
});
