#!/usr/bin/env node
'use strict';
/**
 * Every role over every screen, in a real browser, counting the refusals (7 Nov 2026, plan 9.5 item 2.3).
 *
 *   node tools/lab/sweep-roles.cjs [adminOrigin] [role ...]
 *
 * Signs in as each lab account (the lab's accounts are `<role>@perf.test`, password Perf!Local1; never aim this at production), opens /dashboard/<screen> for every screen
 * the panel has, and records the API answers that were 401/403. A screen the panel does not let the role open asks for nothing, so any 403 found is a screen the panel
 * opened for a role whose data the server then refused: the gap «الشاشة ← الصلاحية» has to close. The accounts are signed in side by side (one session each).
 * Exit 1 when any refusal is found. Needs e2e/node_modules (Playwright) and the lab API and a built admin on `adminOrigin` (default http://127.0.0.1:4021).
 */
const path = require('path');
const { chromium } = require(path.join(__dirname, '..', '..', 'e2e', 'node_modules', '@playwright', 'test'));

const ORIGIN = process.argv[2] && /^https?:/.test(process.argv[2]) ? process.argv[2] : 'http://127.0.0.1:4021';
if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(ORIGIN)) { console.error('The sweep signs in with the lab\'s password: local origins only.'); process.exit(2); }
const ROLES = process.argv.slice(2).filter(arg => !/^https?:/.test(arg));
const ALL = ['admin', 'manager', 'sales1', 'collection1', 'support1', 'reception1', 'accountant1', 'hr1', 'instructor1', 'onlinemgr1'];
const SCREENS = [
  'overview', 'management_reports', 'kpi_dashboard', 'activity', 'tasks_board', 'ask_ai', 'leads', 'sales_hub', 'sales_daqqi_schedule', 'sales_team', 'online_clients', 'client',
  'online_hub', 'subscriptions', 'daqqi_schedule', 'daqqi_clients', 'daqqi_team', 'daqqi_accounting', 'daqqi_stats', 'waitlist', 'tagamoa_schedule', 'tagamoa_clients', 'tagamoa_team',
  'tagamoa_accounting', 'tagamoa_stats', 'tagamoa_waitlist', 'customer_inbox', 'whatsapp_web', 'team_inbox', 'cx_team', 'ratings', 'branch_hr', 'service_hub', 'refund_requests',
  'consultations', 'cert_requests', 'financial', 'orders', 'financial_reports', 'recurring_expenses', 'hr', 'staff_performance', 'offboarding', 'instructors', 'join_us',
  'lecturer_applications', 'interviews', 'marketing_hub', 'campaigns', 'notif_inbox', 'staff_announcements', 'content_hub', 'courses', 'lectures', 'bundles', 'quizzes', 'course_waitlist',
  'live_streams', 'community', 'settings_hub', 'system_settings', 'integrations', 'lead_sources_settings', 'branches_settings', 'branch_workspaces', 'automation', 'security_center',
  'registrations', 'staff_home', 'staff_settings', 'my_hr',
];

async function sweep(browser, role) {
  const context = await browser.newContext();
  const login = await context.request.post(`${ORIGIN}/api/auth/login`, { data: { email: `${role}@perf.test`, password: 'Perf!Local1' } });
  if (!login.ok()) return { role, error: `sign-in refused (${login.status()})`, refused: [], opened: 0 };
  const refused = [];
  let opened = 0;
  for (const screen of SCREENS) {
    const page = await context.newPage();
    const seen = [];
    page.on('response', response => {
      const url = new URL(response.url());
      if (url.pathname.startsWith('/api/') && (response.status() === 401 || response.status() === 403)) seen.push(`${response.status()} ${url.pathname}${url.search}`);
    });
    await page.goto(`${ORIGIN}/dashboard/${screen}`).catch(() => undefined);
    await page.waitForLoadState('networkidle', { timeout: 12_000 }).catch(() => undefined);
    await page.waitForTimeout(700);
    const text = ((await page.locator('#root').innerText().catch(() => '')) || '');
    if (!/ليس لديك صلاحية|غير مصرح/.test(text) && text.trim().length > 40) opened += 1;
    for (const line of new Set(seen)) refused.push({ screen, line });
    await page.close();
  }
  await context.close();
  return { role, refused, opened };
}

(async () => {
  const browser = await chromium.launch();
  const roles = ROLES.length ? ROLES : ALL;
  const results = await Promise.all(roles.map(role => sweep(browser, role)));
  await browser.close();
  let total = 0;
  for (const result of results) {
    if (result.error) { console.log(`${result.role}: ${result.error}`); continue; }
    total += result.refused.length;
    console.log(`${result.role.padEnd(12)} opened ${String(result.opened).padStart(2)} of ${SCREENS.length}, ${result.refused.length} refusal(s)`);
    for (const { screen, line } of result.refused) console.log(`    ${screen}: ${line}`);
  }
  console.log(`\n${total} refusal(s) across ${results.length} roles`);
  process.exit(total ? 1 : 0);
})();
