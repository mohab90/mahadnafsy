'use strict';

// Four faults reported from the desk, all the same shape: a button that exists
// and an action behind it that refuses.
//
//   1. «تحويل لعميل» demanded an email address. 26,816 of the 27,236 live leads
//      do not have one — the institute takes almost every lead over WhatsApp.
//   2. Changing a customer's video count was gated on manage_courses, held by
//      the online manager alone, while the screen showed the buttons to the
//      collection manager too.
//   3. الرئيسية fetched the collection target for every role, but the endpoint
//      needs view_leads, so six roles got a red error on every dashboard open
//      about a number their screen never shows.
//   4. A booking taken at the Daqqi desk opened a different payment form from
//      the same booking taken online.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ROLE_PERMS } = require('../constants/permissions');

const ROOT = path.join(__dirname, '..', '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const exists = rel => fs.existsSync(path.join(ROOT, rel));

const codeOnly = source => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .map(line => line.replace(/(^|\s)\/\/[^\n]*/, '$1'))
  .join('\n');

/** Non-wildcard roles holding a permission. */
const holders = permission => Object.entries(ROLE_PERMS)
  .filter(([, perms]) => perms !== '*' && perms.includes(permission))
  .map(([role]) => role);

test('a lead with a phone and no email can be converted', () => {
  const route = codeOnly(read('api/routes/admin/leads.js'));
  const start = route.indexOf("'/api/admin/leads/:id/convert'");
  assert.ok(start > 0, 'the convert route moved');
  const body = route.slice(start, route.indexOf('\n});', start));

  // The refusal is gone.
  assert.ok(!body.includes('يجب أن يكون للليد بريد إلكتروني واسم قبل التحويل'),
    'conversion demands an email again, which 98% of leads do not have');
  assert.ok(!body.includes('if (!lead.email || !lead.name)'));

  // A name is still required, and so is *an* identity — one the customer can
  // actually be reached and sign in with.
  assert.ok(body.includes('if (!lead.name || !String(lead.name).trim())'));
  assert.ok(body.includes('const phoneForUser = await claimWhatsAppIdentity(conn, { tenantId, phone: lead.phone });'));
  assert.ok(body.includes('if (!normEmail && !phoneForUser)'));

  // The account it creates carries the number, and leaves email NULL rather
  // than empty — the unique key is on (tenant_id, email), so a second empty
  // string would collide with the first.
  assert.ok(body.includes('INSERT INTO users (id, tenant_id, email, phone, password_hash, name, role, is_active)'));
  assert.ok(body.includes('normEmail || null, phoneForUser,'));

  // And an existing customer is found by either identity, so converting a
  // returning lead does not create a second account for the same person.
  assert.ok(body.includes('existingUser = await findAccountByPhone(conn, { tenantId, phone: lead.phone })'));

  // Nothing is mailed to an address that is not there.
  assert.ok(body.includes('if (isNewUser && tempPass && normEmail)'));
});

test('signing in by phone is real, which is what makes the above safe', () => {
  // If login were email-only, a phone-only account would be one nobody could
  // ever enter — the conversion would succeed and lock the customer out.
  const auth = codeOnly(read('api/routes/auth.js'));
  assert.ok(auth.includes('const phoneIdentity = identifierIsEmail ? null : normalizeWhatsAppNumber(rawIdentifier);'),
    'the login route no longer accepts a phone as the identifier');
});

test('the video count is gated on the same permission the screen checks', () => {
  const route = codeOnly(read('api/routes/core/content.js'));

  // Both writes: setting a new enrolment's limit, and changing an existing one.
  assert.match(route, /router\.put\('\/api\/admin\/subscribers\/:id\/course-access\/:enrollmentId'[\s\S]{0,140}requirePermission\('manage_financial'\)/);
  assert.match(route, /router\.post\('\/api\/admin\/enrollments'[\s\S]{0,140}requirePermission\('manage_financial'\)/);
  assert.ok(!route.includes("requirePermission('manage_courses')"),
    'a client-account action is gated on the catalogue-authoring permission again');

  // The premise: manage_courses really is the online manager alone, which is
  // why gating a desk action on it refused everyone else.
  assert.deepEqual(holders('manage_courses'), ['online_manager']);

  // And the UI reads the permission rather than a list of role names.
  const ui = codeOnly(read('admin/pages/unified-client/useUnifiedClientPermissions.ts'));
  assert.ok(ui.includes("'manage_financial')"),
    'the screen decides with something other than the permission the server checks');
  assert.ok(!ui.includes("canManageCourseAccess: isAdmin || isOnlineManager || isCollectionManager"),
    'the button is back to three hardcoded roles, which is how it drifted from the route');

  // Everyone the old screen offered it to still has it.
  const financial = new Set(holders('manage_financial'));
  for (const role of ['online_manager', 'collection']) {
    assert.ok(financial.has(role), `${role} lost an action they had`);
  }
});

test('the collection target is only fetched by the roles whose screen shows it', () => {
  const overview = codeOnly(read('admin/pages/dashboard/tabs/OverviewTab.tsx'));

  assert.ok(overview.includes('const needsCollectionTarget = isCollectionRole || isAdmin || isOnlineManager;'));
  assert.ok(overview.includes('if (!needsCollectionTarget) return;'),
    'the fetch runs for every role again, and 403s for six of them');
  assert.ok(!overview.includes("notify('error', 'تعذر تحميل هدف التحصيل الشهري')"),
    'a permission the reader does not hold is reported to them as an error they cannot act on');

  // The premise: the endpoint really is behind view_leads, and the roles that
  // were seeing the error really do lack it.
  const sales = codeOnly(read('api/routes/analytics/sales.js'));
  assert.match(sales, /router\.get\('\/api\/admin\/sales-targets'[\s\S]{0,140}requirePermission\('view_leads'\)/);
  const canRead = new Set(holders('view_leads'));
  const affected = holders('view_dashboard').filter(role => !canRead.has(role));
  assert.deepEqual(affected.sort(), ['accountant', 'expert', 'hr', 'instructor', 'other', 'trainer']);
});

test('there is one payment screen, and every booking button opens it', () => {
  // A payment form is recognisable by its draft: the booking type is the field
  // that only a booking/payment form has. Exactly one module may declare it.
  const declaring = [];
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!/\.tsx?$/.test(entry.name)) continue;
      const rel = path.relative(ROOT, full).split(path.sep).join('/');
      if (/bookingType:\s*'new_booking'\s*\|\s*'installment'/.test(codeOnly(read(rel)))) declaring.push(rel);
    }
  };
  walk(path.join(ROOT, 'admin'));

  // One. There were four: this one, the Daqqi desk's copy of it, and two
  // "create the customer and take their first payment" forms — one at the desk
  // and one in عملاء الأونلاين — which were copies of each other. The three
  // copies are gone; creating a customer is PaymentModal's `new` mode.
  assert.deepEqual(declaring, ['admin/components/PaymentModal.tsx'],
    'another payment form exists, so the same booking looks different depending on where it was started');

  // The Daqqi desk's own copy is gone, along with its second receipt.
  assert.ok(!exists('admin/pages/dashboard/tabs/daqqi/DaqqiPayModal.tsx'));
  assert.ok(!exists('admin/pages/dashboard/tabs/daqqi/DaqqiPaymentReceiptModal.tsx'));

  const schedule = codeOnly(read('admin/pages/dashboard/tabs/DaqqiScheduleTab.tsx'));
  assert.ok(schedule.includes("import('../../../components/PaymentModal')"));
  assert.ok(schedule.includes('mode="subscriber"'));

  // PaymentModal closes itself, after the receipt. A parent that closed on
  // submit unmounted it before the receipt could render, so the Daqqi desk
  // would have lost the printed slip it takes for every cash payment.
  const modal = codeOnly(read('admin/components/PaymentModal.tsx'));
  assert.ok(modal.includes('if (printPayload) setPrintData(printPayload);'));
  assert.ok(modal.includes('else onClose();'));
  assert.ok(schedule.includes('onClose={() => { setDaqqiPayModal(null); resetDaqqiPayDraft(); }}'));

  // And the Daqqi draft is the shared one, not a copy that can drift again.
  const state = codeOnly(read('admin/pages/dashboard/tabs/daqqi/useDaqqiPaymentState.ts'));
  assert.ok(state.includes('...blankPaymentDraft(),'));
  assert.ok(!state.includes('bookingDiscount'), 'the dead field is back');
});

test('no second screen records a customer payment', () => {
  // The earlier test recognises a payment form by its booking type. That missed
  // two: «تسجيل دخل» in الحسابات and «مدفوع قديم» on the client page both used
  // `isInstallment: boolean` instead, so neither was caught while both wrote a
  // payment against a customer. This looks for the behaviour rather than a
  // field name: a component that lets someone set a payment method *and* an
  // amount is a payment form, whatever it calls its draft.
  const forms = [];
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!entry.name.endsWith('.tsx')) continue;
      const rel = path.relative(ROOT, full).split(path.sep).join('/');
      const source = codeOnly(read(rel));
      const setsMethod = /(paymentMethod|\bmethod):\s*(e|event)\.target\.value/.test(source)
        || /set\w*\(\{\s*paymentMethod/.test(source)
        || /\.\.\.\w+,\s*(paymentMethod|method):/.test(source);
      const setsAmount = /(amount|amountPaid):\s*(e|event)\.target\.value/.test(source)
        || /set\w*\(\{\s*amount/.test(source)
        || /\.\.\.\w+,\s*amount(Paid)?:/.test(source);
      if (setsMethod && setsAmount) forms.push(rel);
    }
  };
  walk(path.join(ROOT, 'admin'));

  assert.deepEqual(forms.sort(), [
    // The one screen every booking and every customer payment opens.
    'admin/components/PaymentModal.tsx',
    // «مشترك أونلاين جديد» — not a booking screen. It creates a *login*:
    // password, per-course access type and video count, referral, and an
    // optional first payment, all in one POST /admin/create-account that
    // inserts the payments row and posts the journal inside one transaction.
    // Its money is recorded correctly; splitting it to reuse PaymentModal
    // would turn one atomic call into two and drop those fields.
    'admin/pages/dashboard/tabs/OnlineClientsTab.tsx',
    // An incoming bank transfer, recorded as an order of type 'transfer' with a
    // free-text sender — «غير محدد» when blank. It is institute income with no
    // customer attached, which is why it is not this screen.
    'admin/pages/dashboard/tabs/OrdersTab.tsx',
  ], 'a second screen records customer payments, so the same money is entered two different ways');

  // The three that used to be here are gone, each folded into PaymentModal.
  for (const rel of [
    'admin/pages/dashboard/tabs/daqqi/DaqqiPayModal.tsx',
    'admin/pages/dashboard/tabs/daqqi/DaqqiNewClientModals.tsx',
    'admin/pages/dashboard/tabs/financial/IncomeModal.tsx',
    'admin/pages/unified-client/UnifiedClientLegacyPaymentModal.tsx',
  ]) {
    assert.ok(!exists(rel), rel + ' is back');
  }

  // الحسابات picks the customer inside the shared screen rather than in a
  // dialog of its own, and «مدفوع قديم» is that same screen with the note
  // filled in — its own dialog recorded no payment method at all and stamped
  // today as the date, for a payment that by definition was not made today.
  const financial = codeOnly(read('admin/pages/dashboard/tabs/FinancialTab.tsx'));
  assert.match(financial, /<PaymentModal/);
  assert.match(financial, /subjectOptions=\{incomeSubjectOptions\}/);
  const clientPayments = codeOnly(read('admin/pages/unified-client/useUnifiedClientPayments.ts'));
  assert.match(clientPayments, /openLegacyPaymentForm = \(\) => openSubscriberPaymentForm\(\{ note:/);

  // Nothing is valid until the screen knows whose payment it is.
  const modal = codeOnly(read('admin/components/PaymentModal.tsx'));
  assert.ok(modal.includes('const subjectChosen = !subjectOptions || !!subject.id;'));
  assert.ok(modal.includes('const isValid = !subjectChosen ? false'));
});

test('every booking and payment button opens that one screen', () => {
  // The user's actual requirement: whether the booking starts on the client
  // page, in the client database, from a lead, in عملاء الأونلاين, at the Daqqi
  // desk or in the accounts, it is the same form.
  //
  // Each of these renders PaymentModal. A screen that grew its own payment
  // fields instead would be caught by the single-form test above; this one
  // catches a screen that stopped opening it at all.
  const openers = [
    'admin/pages/dashboard/DashboardPaymentOverlays.tsx',        // قاعدة البيانات
    'admin/pages/dashboard/tabs/leads/LeadModalsHost.tsx',       // العملاء المحتملين
    'admin/pages/dashboard/tabs/RegistrationsTab.tsx',           // التسجيلات
    'admin/pages/unified-client/UnifiedClientModalsHost.tsx',    // صفحة العميل
    'admin/pages/unified-client/UnifiedClientSubscriberPaymentsPanel.tsx',
    'admin/pages/dashboard/tabs/DaqqiScheduleTab.tsx',           // الدقي
    'admin/pages/dashboard/tabs/OnlineClientsTab.tsx',           // الأونلاين
  ];
  for (const rel of openers) {
    const source = codeOnly(read(rel));
    assert.match(source, /<PaymentModal/, `${rel} no longer opens the shared payment screen`);
  }

  // The three modes it answers to, so a caller cannot invent a fourth.
  const modal = codeOnly(read('admin/components/PaymentModal.tsx'));
  assert.ok(modal.includes("mode: 'lead' | 'subscriber' | 'new';"));

  // Creating a customer and taking their first payment goes through the one
  // helper, and that helper goes through the endpoint that journals it.
  const helper = codeOnly(read('admin/lib/createClientWithPayment.ts'));
  assert.ok(helper.includes("'/admin/subscriber-payments'"),
    'the first payment bypasses the endpoint that records it in the books');

  // Payment methods come from one setting, read through one helper, on every
  // screen that offers them — so the list cannot differ by screen.
  for (const rel of ['admin/components/PaymentModal.tsx', 'admin/pages/dashboard/tabs/FinancialTab.tsx',
    'admin/pages/dashboard/tabs/OrdersTab.tsx', 'admin/pages/dashboard/tabs/financial/PaymentReviewPanel.tsx']) {
    const source = codeOnly(read(rel));
    assert.match(source, /parsePaymentMethods\(/, `${rel} builds its own payment-method list`);
    assert.ok(!/DEFAULT_PAYMENT_METHODS\s*=/.test(source), `${rel} carries its own hardcoded list`);
  }
});
