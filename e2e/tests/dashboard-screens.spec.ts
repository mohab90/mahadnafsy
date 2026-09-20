import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { loginAdmin } from '../helpers/adminLogin';

/**
 * Every dashboard screen opens and draws something.
 *
 * This exists because on 2026-08-26 a manual sweep of 77 screens found two that
 * rendered nothing at all — أرشيف العملاء and الفروع. Clicking them changed the
 * URL and produced no content, no network request, no console error, and never
 * even fetched the component's chunk. Their tab key was missing from the Set
 * gating the container that draws them.
 *
 * They had been dead for months and every gate passed the whole time:
 * TypeScript compiled, 856 unit tests passed, 63 quality checks passed, and the
 * code was present in the shipped bundle. All of that proves the code was
 * deployed. None of it proves a screen renders — no test in the suite mounts a
 * component.
 *
 * What is measured is the content section — the one element a screen draws
 * into; the header and the nav sit outside it. A working screen puts a heading,
 * a table or an empty-state message there; a dead one leaves it empty.
 *
 * It used to measure the whole page against 400 characters, calibrated on
 * production. Staging holds a handful of rows, so a screen correctly saying
 * «لا توجد بثوث مباشرة مضافة بعد» fell under the floor beside a dead one — and
 * nobody saw, because the suite had never run with a login. The first run that
 * did failed seventeen screens: thirteen empty-but-correct under the floor, one
 * on a phrase only the nav carries, and three on a real 403 — the panel read
 * live streams from the student's route (see liveStreamsAdminRead.test.js).
 *
 * Deliberately not asserting specific figures: those change as the desk works,
 * and a test that fails on real activity gets disabled. This asks only whether
 * the screen is alive.
 */

const ADMIN = process.env.ADMIN_BASE_URL || 'http://127.0.0.1:4000';
const EMAIL = process.env.E2E_ADMIN_EMAIL;
const PASSWORD = process.env.E2E_ADMIN_PASSWORD;

// Characters in the content section. The emptiest working screen on staging —
// a title and one button — carries 51; a dead one carries none.
const CONTENT_FLOOR = 20;
const contentLength = async (page: Page) =>
  ((await page.locator('#root section').first().innerText({ timeout: 1_000 }).catch(() => '')) || '')
    .replace(/\s+/g, ' ').trim().length;

/**
 * Tab keys reachable from the nav, from admin/pages/dashboard/navigation.tsx.
 * Group headers are excluded — they expand a submenu rather than draw a screen.
 */
// Five entries here hold what used to be twenty-three separate screens. The
// sections inside them are reached as /dashboard/<tab>/<section>, which is a
// second axis this list does not walk — opening the tab draws its first
// section, and the rest are one click away rather than one URL away.
const SCREENS = [
  'overview', 'kpi_dashboard', 'activity', 'tasks_board', 'analytics_hub', 'ask_ai',
  'leads', 'sales_hub', 'sales_planning', 'sales_reports', 'sales_team',
  'online_clients', 'client', 'archived_clients', 'online_hub', 'online_team', 'installment_plans', 'subscriptions',
  'daqqi_schedule', 'daqqi_clients', 'daqqi_team', 'daqqi_accounting', 'daqqi_stats', 'waitlist',
  'customer_inbox', 'cx_team', 'service_hub', 'refund_requests', 'consultations', 'cert_requests',
  'financial', 'orders', 'financial_reports', 'recurring_expenses',
  'hr', 'staff_performance', 'hr_analytics', 'enps_dashboard', 'offboarding', 'instructors', 'join_us', 'interviews',
  'marketing_hub', 'campaigns', 'notif_inbox',
  'content_hub', 'courses', 'lectures', 'bundles', 'quizzes', 'course_waitlist',
  'live_streams', 'community',
  'settings_hub', 'system_settings', 'integrations', 'lead_sources_settings',
  'branches_settings', 'branch_workspaces',
  'automation', 'security_center',
  // These four sit outside navigation.tsx — registrations in
  // DashboardNavigation.tsx, the three workspace tabs in
  // DashboardMyWorkspace.tsx — so the tab audit could not see them and this
  // list never carried them. staff_home was the cost: it renders an empty page
  // for any account with no staff record, which is what the owner account is,
  // and nothing was watching the screen that self-service registrations land
  // on either.
  'registrations', 'staff_home', 'staff_settings', 'my_hr',
];

test.describe('every dashboard screen renders', () => {
  // Skipped rather than failed without credentials: a developer running the
  // suite locally should not get a red run for not having an admin password,
  // and CI supplies them.
  test.skip(!EMAIL || !PASSWORD, 'E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD not set');

  // One sign-in for the whole list, carried into each test's own context.
  //
  // Each test used to sign in through the form and wait for /dashboard — which
  // the panel shows a signed-out visitor too, with the login form on it. So the
  // wait passed at once, the test navigated away with the sign-in still in
  // flight, and every screen was measured on the login form. And sixty-odd
  // sign-ins would be refused anyway: 15 per account per 15 minutes, one
  // session per account.
  let session: Awaited<ReturnType<BrowserContext['storageState']>>;
  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext();
    await loginAdmin(await context.newPage(), ADMIN, EMAIL!, PASSWORD!);
    session = await context.storageState();
    await context.close();
  });

  for (const key of SCREENS) {
    test(key, async ({ browser }) => {
      const context = await browser.newContext({ storageState: session });
      const page = await context.newPage();
      const errors: string[] = [];
      page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });

      await page.goto(`${ADMIN}/dashboard/${key}`);

      // Polled rather than a fixed delay: a screen may take its time, but it has
      // to arrive. The three workspace screens needed a branch of their own
      // under the old whole-page floor; measured where the screen draws, they
      // do not.
      await expect
        .poll(() => contentLength(page), { timeout: 15_000, message: `${key} never rendered any content` })
        .toBeGreaterThan(CONTENT_FLOOR);

      expect(errors, `${key} logged console errors`).toEqual([]);
      await context.close();
    });
  }

  // A key that is no screen.
  //
  // Found on production as the owner: /dashboard/staff — a name the panel has
  // never had; the staff list lives under الموارد البشرية — drew the chrome
  // and an empty page. No screen, no message, nothing to click, and every
  // mistyped or retired link did the same.
  test('a link to a screen that does not exist lands somewhere', async ({ browser }) => {
    const context = await browser.newContext({ storageState: session });
    const page = await context.newPage();
    await page.goto(`${ADMIN}/dashboard/staff`);
    await expect
      .poll(() => contentLength(page), { timeout: 15_000, message: 'an unknown screen key renders a blank page' })
      .toBeGreaterThan(CONTENT_FLOOR);
    await context.close();
  });
});
