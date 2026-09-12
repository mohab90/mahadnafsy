'use strict';

// Values the customer-facing app had more than one copy of, and two screens
// that told the customer something that was not true.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const walk = (dir, out = []) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
};

const codeOnly = source => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .map(line => line.replace(/(^|\s)\/\/[^\n]*/, '$1'))
  .join('\n');

test("the institute's WhatsApp number is written once", () => {
  const files = walk(path.join(ROOT, 'client'));
  assert.ok(files.length > 50, `expected to walk the client app, saw ${files.length} files`);

  const carriers = [];
  for (const file of files) {
    const rel = path.relative(ROOT, file).split(path.sep).join('/');
    if (!codeOnly(fs.readFileSync(file, 'utf8')).includes('201096203090')) continue;
    carriers.push(rel);
  }
  // content['footer.whatsapp'] already seeds this default, so every
  // `|| '201096203090'` at a call site was a second copy that could never fire
  // and would be missed the day the institute changes its number. One left: the
  // seed itself.
  assert.deepEqual(carriers, ['client/context/SiteDataContext.tsx']);
});

test('every WhatsApp link on the site resolves the number through one helper', () => {
  const helper = codeOnly(read('client/lib/whatsappLink.ts'));
  assert.match(helper, /export function instituteWhatsApp/);
  // It returns a dialable number, so callers must not re-strip or re-convert.
  assert.match(helper, /return toDialable\(content\['footer\.whatsapp'\]\)/);

  for (const rel of [
    'client/App.tsx',
    'client/components/Footer.tsx',
    'client/pages/Checkout.tsx',
    'client/pages/Contact.tsx',
    'client/pages/Enrollment.tsx',
    'client/pages/PaymentSuccess.tsx',
    'client/pages/StandalonePayment.tsx',
    'client/pages/UserDashboard.tsx',
    'client/pages/InstructorDetails.tsx',
    'client/pages/course-details-sections/CourseHeroSection.tsx',
  ]) {
    assert.match(codeOnly(read(rel)), /instituteWhatsApp\(/, `${rel} still resolves the number itself`);
  }
});

test('the enrolment page charges what shared/enrollmentPricing says', () => {
  const page = codeOnly(read('client/pages/Enrollment.tsx'));
  assert.match(page, /amountDueNow\(getBasePrice\(item\), payType\)/);
  assert.match(page, /installmentTotal\(getBasePrice\(item\)\)/);
  // The two formulas it used to re-derive from the raw constants. That module
  // exists precisely so a rate change cannot reach one side and not the other,
  // and a private second copy defeats it.
  assert.ok(!page.includes('(1 - CASH_DISCOUNT)'), 'the cash rate is derived here again');
  assert.ok(!page.includes('INSTALL_FIRST_PCT)'), 'the instalment share is derived here again');
});

test('signing in as staff leaves this router instead of bouncing off it', () => {
  const auth = codeOnly(read('client/pages/Auth.tsx'));
  const app = codeOnly(read('client/App.tsx'));
  // The client app registers /dashboard as a redirect to home, so navigating
  // there in-router silently dropped every staff member on the home page.
  assert.match(app, /<Route path="\/dashboard" element=\{<Navigate to="\/" replace \/>\}/);
  assert.ok(!/navigate\('\/dashboard'\)/.test(auth), 'still routes staff to a redirect-to-home');
  assert.match(auth, /window\.location\.assign\(adminDashboardUrl\(\)\)/);
});

test('the 2FA panel does not claim a code was sent', () => {
  // codeOnly, not the raw file: the comment recording this fix quotes the very
  // string being asserted absent, and would satisfy the check on its own.
  const auth = codeOnly(read('client/pages/Auth.tsx'));
  // TOTP: POST /api/auth/login answers totpRequired and sends nothing at all.
  const api = read('api/routes/auth.js');
  assert.match(api, /totpRequired: true, pendingToken/);
  assert.ok(!auth.includes('تم إرسال رمز التحقق إلى'),
    'the 2FA step tells the user to wait for a code that is never sent');
  assert.match(auth, /هذا الحساب محمي بالتحقق الثنائي/);
});

test('the new-password field asks the browser for the same minimum the code enforces', () => {
  const auth = codeOnly(read('client/pages/Auth.tsx'));
  assert.match(auth, /newPassword\.length < 8/);
  assert.ok(!auth.includes('minLength={6}'), 'the field still accepts 6 characters the handler will reject');
});

test('/success tells a card payer, a declined card and a transfer apart', () => {
  const page = codeOnly(read('client/pages/PaymentSuccess.tsx'));
  // /success is Paymob's redirection_url.
  assert.match(codeOnly(read('api/lib/saasSettings.js')), /callback_url: '\/success'/);
  assert.match(page, /searchParams\.get\('success'\)/);
  assert.match(page, /'transfer'|'card'|'declined'/);
  // A declined card used to get the same green tick and the same «تم استلام طلبك».
  assert.match(page, /لم تتم عملية الدفع/);
});
