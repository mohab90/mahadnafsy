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

/**
 * Tab keys reachable from the nav, from admin/pages/dashboard/navigation.tsx.
 * Group headers are excluded — they expand a submenu rather than draw a screen.
 */
const SCREENS = [
  'overview', 'kpi_dashboard', 'activity', 'tasks_board', 'retention',
  'cohort_analysis', 'revenue_sources', 'expense_analytics', 'ask_ai',
  'leads', 'sales_hub', 'followup_reminders', 'lead_scoring', 'forecast', 'sales_goals',
  'online_clients', 'client', 'archived_clients', 'online_hub', 'installment_plans', 'subscriptions',
  'daqqi_schedule', 'daqqi_clients', 'daqqi_team', 'daqqi_accounting', 'daqqi_stats', 'waitlist',
  'customer_inbox', 'service_hub', 'refund_requests', 'consultations', 'cert_requests',
  'financial', 'orders', 'financial_reports', 'balance_sheet', 'cash_flow',
  'recurring_expenses', 'budget_tracker', 'revenue_forecast',
  'hr', 'hr_analytics', 'enps_dashboard', 'offboarding', 'instructors', 'join_us', 'interviews',
  'marketing_hub', 'messaging_hub', 'email_campaigns', 'sms_campaigns', 'drip_campaigns', 'notif_inbox',
  'content_hub', 'courses', 'lectures', 'bundles', 'quizzes', 'course_waitlist',
  'live_streams', 'community',
  'settings_hub', 'system_settings', 'payment_settings', 'lead_sources_settings',
  'otp_settings', 'sms_settings', 'branches_settings', 'branch_workspaces',
  'automation', 'ip_whitelist', 'messaging_agent', 'admin_ai_settings',
  'server_monitor', 'webhooks', 'security_dashboard', 'pg_migrate',
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
      // Polled on content rather than a fixed delay: a screen may take its
      // time, but it has to arrive.
      await expect
        .poll(async () => (await page.locator('body').innerText()).replace(/\s+/g, ' ').length,
              { timeout: 15_000, message: `${key} never rendered any content` })
        .toBeGreaterThan(CONTENT_FLOOR);

      expect(errors, `${key} logged console errors`).toEqual([]);
    });
  }
});
