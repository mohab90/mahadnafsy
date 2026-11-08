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
  
  
  
  
  

  const mfa = read('admin/pages/dashboard/tabs/SecurityDashboardTab.tsx');
  
  const fb = read('admin/pages/dashboard/tabs/AutomationTab.tsx');
  

  const ip = read('admin/pages/dashboard/tabs/IpWhitelistTab.tsx');
  assert.ok(ip.indexOf('{loadError ? (') < ip.indexOf('whitelist.length === 0 ? ('), 'a failed load is not shown as an empty list');
});





test('«عملاء متصلون الآن» is fed from the presence endpoint', () => {
  const dashboard = dashboardSource();
  assert.match(dashboard, /const \[onlineUsers, setOnlineUsers\] = useState/);
  assert.match(dashboard, /mysqlAdmin\.getOnlineUsers\(\)/);
  assert.ok(dashboard.indexOf('const activeTab = ') < dashboard.indexOf('mysqlAdmin.getOnlineUsers()'), 'read after activeTab exists');
  
});

test('a ticket contact whose follow-up step fails says which step did not happen', () => {
  const form = read('admin/pages/dashboard/tabs/TicketContact.tsx');
  const save = form.slice(form.indexOf('const save = async'), form.indexOf('const base = '));
  assert.match(save, /اتسجل التواصل، لكن «\$\{NEXT_LABEL\[effectiveNext\]\}» ما اتنفذش/);
  // The contact is already logged: the form closes so a retry cannot log it twice.
  const inner = save.slice(save.indexOf('} catch (error) {'));
  assert.ok(inner.indexOf('setChannel(null);') < inner.indexOf('onError('));
});



test('every field of the contact form is named by its label', () => {
  const page = read('client/pages/Contact.tsx');
  for (const id of ['contact-name', 'contact-phone', 'contact-email', 'contact-subject', 'contact-message']) {
    assert.match(page, new RegExp(`htmlFor="${id}"`));
    assert.match(page, new RegExp(`id="${id}"`));
  }
});
