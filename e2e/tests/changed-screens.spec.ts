import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { loginAdmin } from '../helpers/adminLogin';

/**
 * The screens the 4–6 Nov 2026 work rebuilt (what they ask the server for, and how often), opened as the admin.
 *
 * dashboard-screens.spec.ts asks only whether a screen draws something. These screens changed *where their numbers come from*
 * (the panel's bootstrap, the expenses and the register's pages, the revenue breakdown, the sales figures, the AI screen's counts,
 * crm-insights' halves, the course PDFs), so each is held to what the change promised:
 *   - no request answers 4xx/5xx and nothing logs a console error;
 *   - the request count stays under a budget set a little above what was measured (a screen that quietly goes back to
 *     downloading a table shows up as more requests);
 *   - the endpoint the screen is now built on is the one it calls, and the whole-table endpoint it left is not called.
 *
 * Budgets are for a signed-in admin on a lab-sized database; they are ceilings, not targets.
 */

const ADMIN = process.env.ADMIN_BASE_URL || 'http://127.0.0.1:4000';
const EMAIL = process.env.E2E_ADMIN_EMAIL;
const PASSWORD = process.env.E2E_ADMIN_PASSWORD;

type Call = { path: string; status: number };
type Screen = { name: string; url: string; budget: number; calls?: RegExp[]; notCalls?: RegExp[] };

const SCREENS: Screen[] = [
  { name: 'panel start-up', url: '/dashboard', budget: 8, calls: [/\/api\/admin\/bootstrap$/] },
  // 9: the eight it had, and the panel's presence beat (POST /api/staff/presence, once on opening and then once a minute — «مين فاتح السيستم دلوقتي»)
  { name: 'expenses page', url: '/dashboard/financial/expenses', budget: 9, calls: [/\/api\/admin\/expenses\/page$/] },
  { name: 'accounts overview', url: '/dashboard/financial/overview', budget: 8, notCalls: [/\/api\/admin\/orders$/] },
  { name: 'sales hub', url: '/dashboard/sales_hub', budget: 10, notCalls: [/\/api\/admin\/orders$/] },
  { name: 'staff performance', url: '/dashboard/staff_performance', budget: 10, notCalls: [/\/api\/admin\/orders$/] },
  { name: 'sales team', url: '/dashboard/sales_team', budget: 20, notCalls: [/\/api\/admin\/orders$/] },
  { name: 'ask the AI', url: '/dashboard/ask_ai', budget: 12, calls: [/\/api\/admin\/subscribers\/stats$/], notCalls: [/\/api\/admin\/orders$/, /\/api\/admin\/subscribers$/] },
  { name: 'activity', url: '/dashboard/activity', budget: 14, notCalls: [/\/api\/admin\/orders$/] },
  // the accounts screens and «إحصائيات الدقي» open with one bootstrap request of their own (GET /api/admin/bootstrap?set=accounting|dokki), eight requests at most
  { name: 'Dokki accounts', url: '/dashboard/daqqi_accounting', budget: 8 },
  { name: 'Tagamoa accounts', url: '/dashboard/tagamoa_accounting', budget: 8 },
  { name: 'Dokki statistics', url: '/dashboard/daqqi_stats', budget: 8 },
  { name: 'marketing segments', url: '/dashboard/marketing_hub/segmentation', budget: 14, calls: [/\/api\/admin\/leads\/segments$/], notCalls: [/\/api\/admin\/leads$/, /\/api\/admin\/subscribers$/] },
  { name: 'orders and payments', url: '/dashboard/orders', budget: 10, calls: [/\/api\/admin\/orders\/page$/], notCalls: [/\/api\/admin\/orders$/, /\/api\/admin\/subscribers$/] },
];

test.describe('the screens the Nov 2026 work rebuilt', () => {
  test.skip(!EMAIL || !PASSWORD, 'E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD not set');

  let session: Awaited<ReturnType<BrowserContext['storageState']>>;
  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext();
    await loginAdmin(await context.newPage(), ADMIN, EMAIL!, PASSWORD!);
    session = await context.storageState();
    await context.close();
  });

  async function open(browser: import('@playwright/test').Browser, url: string) {
    const context = await browser.newContext({ storageState: session });
    const page: Page = await context.newPage();
    const calls: Call[] = [];
    const errors: string[] = [];
    page.on('response', r => {
      const u = new URL(r.url());
      if (u.pathname.startsWith('/api/')) calls.push({ path: u.pathname, status: r.status() });
    });
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
    await page.goto(`${ADMIN}${url}`);
    // The screen is done when the network has been quiet: nothing in flight for a moment.
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => undefined);
    await page.waitForTimeout(1_500);
    return { context, page, calls, errors };
  }

  // The API calls below sign in through the API itself and carry the token as a header: the session saved above is the panel's, which refreshes its own
  // short-lived token when a page loads, and a Secure cookie is not sent by the request client over plain http.
  async function apiSession(browser: import('@playwright/test').Browser) {
    const context = await browser.newContext();
    const login = await context.request.post(`${ADMIN}/api/auth/login`, { data: { email: EMAIL, password: PASSWORD } });
    expect(login.ok(), `the API login was refused: ${login.status()}`).toBeTruthy();
    const body = (await login.json().catch(() => ({}))) as { token?: string };
    const token = body.token || decodeURIComponent((/authToken=([^;]+)/.exec(login.headers()['set-cookie'] || '') || [])[1] || '');
    return { context, headers: token ? { Authorization: `Bearer ${token}` } : {} };
  }

  for (const screen of SCREENS) {
    test(screen.name, async ({ browser }) => {
      const { context, calls, errors } = await open(browser, screen.url);
      const refused = calls.filter(c => c.status >= 400);
      expect(refused, `${screen.name}: a request was refused`).toEqual([]);
      expect(errors, `${screen.name} logged console errors`).toEqual([]);
      expect(calls.length, `${screen.name} made ${calls.length} requests (budget ${screen.budget}): ${[...new Set(calls.map(c => c.path))].join(' ')}`)
        .toBeLessThanOrEqual(screen.budget);
      for (const wanted of screen.calls ?? []) {
        expect(calls.some(c => wanted.test(c.path)), `${screen.name} no longer calls ${wanted}`).toBe(true);
      }
      for (const left of screen.notCalls ?? []) {
        expect(calls.some(c => left.test(c.path)), `${screen.name} went back to calling ${left}`).toBe(false);
      }
      await context.close();
    });
  }

  test('the expenses page draws one page of rows, not the table', async ({ browser }) => {
    const { context, page } = await open(browser, '/dashboard/financial/expenses');
    const rows = await page.locator('tbody tr').count();
    expect(rows, 'the expenses table is longer than a page').toBeLessThanOrEqual(101);
    await context.close();
  });

  test('the orders desk draws one page of at most 100 rows, and a tab asks the server again', async ({ browser }) => {
    const { context, page, calls } = await open(browser, '/dashboard/orders');
    // 100 rows of the page, and the new-client requests a collection officer sent (their own rows above them)
    expect(await page.locator('tbody tr').count(), 'the orders table is longer than a page').toBeLessThanOrEqual(120);
    const before = calls.filter(c => c.path.endsWith('/orders/page')).length;
    await page.getByRole('button', { name: /مدفوعات مؤكدة/ }).first().click();
    await page.waitForTimeout(1_500);
    expect(calls.filter(c => c.path.endsWith('/orders/page')).length, 'a tab did not ask the server for its rows').toBeGreaterThan(before);
    expect(await page.locator('tbody tr').count()).toBeLessThanOrEqual(120);
    expect(calls.filter(c => c.status >= 400)).toEqual([]);
    await context.close();
  });

  test('a cash box opened from the overview keeps its filter in the register', async ({ browser }) => {
    const { context, page } = await open(browser, '/dashboard/financial/overview');
    const box = page.locator('button', { has: page.locator('p') }).filter({ hasText: /اضغط لعرض التفاصيل/ }).first();
    test.skip(!(await box.isVisible().catch(() => false)), 'no cash box with money this month on this environment');
    const requests: string[] = [];
    page.on('request', r => { if (r.url().includes('/finance/payments-register')) requests.push(r.url()); });
    await box.click();
    await page.waitForLoadState('networkidle').catch(() => undefined);
    await page.waitForTimeout(1_000);
    expect(requests.length, 'the register was never asked for').toBeGreaterThan(0);
    expect(requests[requests.length - 1], 'the register\'s last request lost the box and month that were clicked').toMatch(/method=|channel=/);
    expect(requests[requests.length - 1]).toMatch(/from=\d{4}-\d{2}-01/);
    await context.close();
  });

  test('crm-insights answers one half at a time', async ({ browser }) => {
    const { context, headers } = await apiSession(browser);
    const reminders = await context.request.get(`${ADMIN}/api/admin/leads/crm-insights?parts=reminders`, { headers });
    const ops = await context.request.get(`${ADMIN}/api/admin/leads/crm-insights?parts=ops`, { headers });
    expect(reminders.status()).toBe(200);
    expect(ops.status()).toBe(200);
    const reminderBody = await reminders.json();
    const opsBody = await ops.json();
    expect(JSON.stringify(opsBody).length, 'the ops half is heavier than the 615 KB the whole answer used to be').toBeLessThan(200_000);
    expect(JSON.stringify(reminderBody).length).toBeLessThan(600_000);
    await context.close();
  });

  test('a course PDF can be uploaded, listed and removed (the folder the server writes to exists)', async ({ browser }) => {
    const { context, headers } = await apiSession(browser);
    const courses = await context.request.get(`${ADMIN}/api/courses`);
    const list = (await courses.json().catch(() => [])) as Array<{ id: string }>;
    test.skip(!Array.isArray(list) || !list.length, 'no course on this environment');
    const id = list[0].id;
    const pdf = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');
    const put = await context.request.put(`${ADMIN}/api/admin/courses/${encodeURIComponent(id)}/documents/FREE`, {
      headers,
      multipart: { pdf: { name: 'e2e-check.pdf', mimeType: 'application/pdf', buffer: pdf }, title: 'e2e check' },
    });
    expect(put.status(), `the upload was refused: ${(await put.text()).slice(0, 200)}`).toBe(200);
    const listed = await context.request.get(`${ADMIN}/api/admin/courses/${encodeURIComponent(id)}/documents`, { headers });
    const docs = ((await listed.json()) as { documents: Array<{ tier: string }> }).documents;
    expect(docs.some(d => d.tier === 'FREE'), 'the uploaded PDF is not listed').toBe(true);
    const removed = await context.request.delete(`${ADMIN}/api/admin/courses/${encodeURIComponent(id)}/documents/FREE`, { headers });
    expect(removed.status()).toBe(200);
    await context.close();
  });
});
