'use strict';

// Admin screens that showed their built-in defaults as if they were the saved
// settings when the load failed — and then saved those defaults over the real
// ones — plus the other quiet failures the 20 Oct review found on the staff
// side and the sign-in page. The route halves are exercised against MariaDB in
// tests/integration/settingsKeptAndReferralCredited.integration.test.js.

const test = require('node:test');
const assert = require('node:assert/strict');
const { dashboardSource } = require('./_adminSplitSource');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');

test('settings forms do not save until the saved settings have been read', () => {
  const sms = read('admin/pages/dashboard/tabs/SmsSettingsTab.tsx');
  assert.match(sms, /if \(!res\.ok\) throw new Error/, 'a refused load is a failure, not a quiet default');
  assert.match(sms, /setLoaded\(true\);/);
  assert.match(sms, /disabled=\{saving \|\| loading \|\| !loaded\}/);
  assert.match(sms, /if \(!loaded\) return;/);
  assert.ok(!/catch \{\}/.test(sms), 'no swallowed load');

  const mfa = read('admin/pages/dashboard/tabs/SecurityDashboardTab.tsx');
  assert.match(mfa, /disabled=\{mfaSaving \|\| mfaLoadError !== null\}/);
  const fb = read('admin/pages/dashboard/tabs/AutomationTab.tsx');
  assert.match(fb, /disabled=\{fbSaving \|\| fbLoadError !== null\}/);

  const ip = read('admin/pages/dashboard/tabs/IpWhitelistTab.tsx');
  assert.ok(ip.indexOf('{loadError ? (') < ip.indexOf('whitelist.length === 0 ? ('), 'a failed load is not shown as an empty list');
});

test('the SMS route keeps a key the form did not send', () => {
  const route = read('api/routes/misc/messaging.js');
  assert.match(route, /api_key=COALESCE\(\?, api_key\)/);
  assert.match(route, /api_secret=COALESCE\(\?, api_secret\)/);
});

test('the notifications bell says when it has stopped updating', () => {
  const hook = read('admin/pages/dashboard/useNotificationsBell.ts');
  assert.match(hook, /\.catch\(\(\) => setNotifError\(true\)\)/);
  assert.match(hook, /setNotifError\(false\)/);
  const bell = read('admin/pages/dashboard/NotificationsBell.tsx');
  assert.match(bell, /\{loadFailed && \(/);
  assert.match(bell, /onClick=\{onRetry\}/);
  const nav = read('admin/pages/dashboard/DashboardNavigation.tsx');
  assert.match(nav, /loadFailed: notifError, onRetry: refreshNotifs/, 'the role bars get it too');
  assert.match(nav, /loadFailed=\{notifError\}/);
});

test('«عملاء متصلون الآن» is fed from the presence endpoint', () => {
  const dashboard = dashboardSource();
  assert.match(dashboard, /const \[onlineUsers, setOnlineUsers\] = useState/);
  assert.match(dashboard, /mysqlAdmin\.getOnlineUsers\(\)/);
  assert.ok(dashboard.indexOf('const activeTab = ') < dashboard.indexOf('mysqlAdmin.getOnlineUsers()'), 'read after activeTab exists');
  assert.match(read('admin/lib/mysqlapi.ts'), /getOnlineUsers: .*'\/admin\/online-users'/);
});

test('a ticket contact whose follow-up step fails says which step did not happen', () => {
  const form = read('admin/pages/dashboard/tabs/TicketContact.tsx');
  const save = form.slice(form.indexOf('const save = async'), form.indexOf('const base = '));
  assert.match(save, /اتسجل التواصل، لكن «\$\{NEXT_LABEL\[effectiveNext\]\}» ما اتنفذش/);
  // The contact is already logged: the form closes so a retry cannot log it twice.
  const inner = save.slice(save.indexOf('} catch (error) {'));
  assert.ok(inner.indexOf('setChannel(null);') < inner.indexOf('onError('));
});

test('signing in lands on the customer\'s courses, and a referral survives the visit', () => {
  const auth = read('client/pages/Auth.tsx');
  assert.match(auth, /const landing = safeRedirect && safeRedirect !== '\/' \? safeRedirect : '\/my-account';/);
  assert.ok(!/navigate\('\/'\)/.test(auth), 'nobody is dropped on the home page after signing in');
  assert.match(auth, /sessionStorage\.setItem\(REFERRAL_KEY/);
  assert.match(auth, /verifyWaOtp\(waPhone\.trim\(\), waCode, waName\.trim\(\) \|\| undefined, referralCode \|\| undefined\)/);
  assert.match(read('api/routes/auth/whatsappLogin.js'), /ref: req\.body\?\.ref/);
});

test('every field of the contact form is named by its label', () => {
  const page = read('client/pages/Contact.tsx');
  for (const id of ['contact-name', 'contact-phone', 'contact-email', 'contact-subject', 'contact-message']) {
    assert.match(page, new RegExp(`htmlFor="${id}"`));
    assert.match(page, new RegExp(`id="${id}"`));
  }
});
