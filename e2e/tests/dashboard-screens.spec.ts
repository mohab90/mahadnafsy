import { test, expect } from '@playwright/test';

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
 * A content floor is the whole assertion. A working screen puts a heading, a
 * table or an empty-state message on the page; a broken one leaves the nav
 * chrome alone. The two dead screens measured 129 characters against 4,440 and
 * 951 once fixed, so the boundary is not delicate.
 *
 * Deliberately not asserting specific figures: those change as the desk works,
 * and a test that fails on real activity gets disabled. This asks only whether
 * the screen is alive.
 */

const ADMIN = process.env.ADMIN_BASE_URL || 'http://127.0.0.1:4000';
const EMAIL = process.env.E2E_ADMIN_EMAIL;
const PASSWORD = process.env.E2E_ADMIN_PASSWORD;

// Nav chrome alone measured 129 characters on the dead screens. 400 clears that
// with room to spare while still catching a screen that draws only a header.
const CONTENT_FLOOR = 400;

// Screens whose correct output depends on whether the signed-in account has a
// staff record. See the branch in the test body.
const WORKSPACE_TABS = new Set(['staff_home', 'staff_settings', 'my_hr']);

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
  'customer_inbox', 'service_hub', 'refund_requests', 'consultations', 'cert_requests',
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

  test.beforeEach(async ({ page }) => {
    await page.goto(ADMIN);
    await page.locator('input[type="email"], input[name="email"]').first().fill(EMAIL!);
    await page.locator('input[type="password"]').first().fill(PASSWORD!);
    await page.locator('button[type="submit"]').first().click();
    await page.waitForURL(/dashboard/, { timeout: 20_000 });
  });

  for (const key of SCREENS) {
    test(key, async ({ page }) => {
      const errors: string[] = [];
      page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });

      await page.goto(`${ADMIN}/dashboard/${key}`);

      // The workspace tabs have two correct outcomes, and which one appears
      // depends on the account the suite signs in as. With a staff record they
      // draw a full profile; without one — the owner account has no staff row —
      // they draw a short explanation of why. That explanation is ~319
      // characters of body text, under the floor, so holding these three to it
      // would fail a screen that is behaving exactly as intended.
      //
      // They are held to the thing that actually matters instead: never
      // silently blank. Before this was fixed they rendered nothing at all —
      // no message, no spinner, no error — and that is the regression worth
      // catching.
      if (WORKSPACE_TABS.has(key)) {
        await expect
          .poll(async () => (await page.locator('body').innerText()).replace(/\s+/g, ' '),
                { timeout: 15_000, message: `${key} never rendered anything` })
          // Both alternatives are phrases only these screens produce. Bare
          // «الرئيسية» and «ملفي» were in here first and had to go: they are
          // short enough to appear in a nav bar, and an assertion the chrome
          // can satisfy would pass on the blank page it exists to catch.
          .toMatch(/مساحة الموظف غير متاحة لحسابك|ملفي الشخصي|ملفي الوظيفي/);
      } else {
        // Polled on content rather than a fixed delay: a screen may take its
        // time, but it has to arrive.
        await expect
          .poll(async () => (await page.locator('body').innerText()).replace(/\s+/g, ' ').length,
                { timeout: 15_000, message: `${key} never rendered any content` })
          .toBeGreaterThan(CONTENT_FLOOR);
      }

      expect(errors, `${key} logged console errors`).toEqual([]);
    });
  }
});
