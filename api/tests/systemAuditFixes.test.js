'use strict';

// What the full audit of 1 Oct 2026 found in the production log and on the
// screens, beside the purchase path (purchaseWithoutEmail.test.js):
//   · 27 of 32 signups ended at «رقم الهاتف مستخدم بالفعل», a dead end;
//   · the finance screen sent 177 requests in a minute after one was refused;
//   · a role that may not see leads was refused the leads list on every load;
//   · on a phone the two floating buttons sat on the course's price and «احجز»;
//   · the not-found page kept the last page's title.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const read = rel => fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8');

test('a number that already has an account is told how to get in', () => {
  const auth = read('api/routes/auth.js');
  const message = auth.match(/const PHONE_TAKEN_MESSAGE = '([^']+)';/);
  assert.ok(message, 'one wording for both signup routes');
  assert.match(message[1], /الدخول برقم الواتساب/);
  assert.equal(auth.split("{ error: PHONE_TAKEN_MESSAGE, code: 'PHONE_ALREADY_REGISTERED' }").length - 1, 2);
  assert.doesNotMatch(auth, /error: 'رقم الهاتف مستخدم بالفعل'/);
});

test('the finance screen hands its panels one notify for the life of the screen', () => {
  const tab = read('admin/pages/dashboard/tabs/FinancialTab.tsx');
  assert.match(tab, /const notifyRef = useRef\(notify\);\s+notifyRef\.current = notify;/);
  assert.match(tab, /const notifyLegacy = useCallback\(\(msg: string, type\?: 'success' \| 'error'\) => notifyRef\.current\(type \|\| 'info', msg\), \[\]\);/);
  // The panels reload when their notify changes — which is why it must not.
  assert.match(read('admin/pages/dashboard/tabs/financial/FinancialCockpitPanel.tsx'), /\}, \[branch, notify\]\);/);
  assert.match(read('admin/pages/dashboard/tabs/financial/FinancialBudgetPanel.tsx'), /\}, \[branch, month, notify\]\);/);
});

test('an employee\'s own lists are asked for only where the role may see them', () => {
  const own = read('admin/pages/dashboard/useStaffOwnData.ts');
  assert.match(own, /hasPermission\(staffRef, 'view_subscribers'\)\s+\? \(async \(\) => \{[\s\S]{0,200}mysqlAdmin\.streamSubscribers\(\{ staff: true \}/);
  assert.match(own, /hasPermission\(staffRef, 'view_leads'\)\s+\? mysqlAdmin\.listStaffLeads\(\)/);
  assert.match(read('api/routes/admin/stafflists.js'), /router\.get\('\/api\/staff\/leads', requireAuth, requireAdminOrStaff, requirePermission\('view_leads'\)/);
});

test('on a phone the floating buttons ride above a bar pinned to the foot of the screen', () => {
  const app = read('client/App.tsx');
  assert.equal(app.split('className="floating-action fixed bottom-6').length - 1, 2, 'WhatsApp and «استفسر الآن»');
  assert.match(read('client/pages/course-details-sections/MobileStickyCta.tsx'), /<div data-sticky-cta="lg" className="lg:hidden fixed bottom-0/);
  assert.match(read('client/pages/UserDashboard.tsx'), /<div data-sticky-cta="md" className="md:hidden fixed bottom-0/);
  const css = read('client/index.css');
  assert.match(css, /@media \(max-width: 1023px\) \{\s+body:has\(\[data-sticky-cta="lg"\]\) \.floating-action \{ bottom: [\d.]+rem; \}/);
  assert.match(css, /@media \(max-width: 767px\) \{\s+body:has\(\[data-sticky-cta="md"\]\) \.floating-action \{ bottom: [\d.]+rem; \}/);
});

test('the not-found page has a title of its own', () => {
  assert.match(read('client/App.tsx'), /const NotFound: React\.FC = \(\) => \{[\s\S]{0,160}useSeo\(\{ title: 'الصفحة غير موجودة \| معهد الدراسات النفسية' \}\);/);
});
