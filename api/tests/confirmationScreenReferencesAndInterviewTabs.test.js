'use strict';

// 19 Oct 2026 — the payments confirmation screen, the «0» reference, the client edit, and the interviews tabs.
//
// «رقم العملية ورقم المحول واسمه مش بيظهروا عند تأكيد الدفعة … ليه طلبات التأكيد بتظهر فوق وتحت … ليه الدفعات السعودية
// بتظهر فوق ومش تحت … الرقم المرجعي 0 متسجل قبل كده … لما بنعمل تعديل بيانات عميل بيقول الرقم مسجل … تاب محضروش الانترفيو
// وزر لم يحضر … والمرفوضين».

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = relative => fs.readFileSync(path.join(__dirname, '..', '..', relative), 'utf8');

test('a reference of zeros or dashes is no reference at all, so «0» can be used again and again', () => {
  const { cleanReference } = require('../lib/transactionReference');
  for (const nothing of ['0', ' 0 ', '00', '٠', '-', '--', '/', 'N/A', 'none', 'لا يوجد', 'مفيش', '', null, undefined]) {
    assert.equal(cleanReference(nothing), null, JSON.stringify(nothing));
  }
  assert.equal(cleanReference(' 1234AB '), '1234AB');
  assert.equal(cleanReference('0123'), '0123', 'a real number that starts with a zero is kept');
  assert.equal(cleanReference('x'.repeat(300)).length, 191);
  // Used at every door a typed reference goes in by.
  assert.match(read('api/routes/subscriber-payments.js'), /cleanReference\(sanitize\(payment\.transactionId \|\| payment\.transaction_id \|\| '', 191\)\)/);
  assert.match(read('api/lib/paymentCorrections.js'), /cleanReference\(changes\.transactionId\)/);
  assert.match(read('api/routes/auth/staffAccounts.js'), /cleanReference\(firstPayment\.transactionId\)/);
});

test('the confirmation list carries every payment waiting, with the transfer the desk typed', () => {
  const orders = read('api/routes/orders.js');
  assert.match(orders, /p\.from_account, p\.sender_name/);
  assert.match(orders, /from_account: p\.from_account \|\| null,\s+sender_name: p\.sender_name \|\| null/);
  // The newest 500 are not all there is: a payment waiting for review is added however old it is, and is never
  // dropped as «already covered by an order».
  assert.match(orders, /AND p\.status='pending'/);
  assert.match(orders, /o\.status='PENDING'/);
  assert.match(orders, /p\.status === 'pending' \|\| !\(cleanReference\(p\.transaction_id\)/);

  const normalise = read('admin/context/site-data-hooks/normalizeOrders.ts');
  assert.match(normalise, /senderName: \(row\.senderName \?\? row\.sender_name/);
  assert.match(normalise, /fromAccountNumber: \(row\.fromAccountNumber \?\? row\.from_account/);

  const table = read('admin/pages/dashboard/tabs/orders/OrdersAdminView.tsx');
  assert.match(table, /بيانات التحويل/);
  assert.match(table, /row\.senderName && /);
  assert.match(table, /row\.fromAccountNumber && /);
});

test('payments waiting for confirmation are in one place: the table — the new clients too, none in a box above it', () => {
  const finance = read('admin/pages/dashboard/DashboardFinanceTabs.tsx');
  assert.doesNotMatch(finance, /<CollectionBookingsReview/);
  const review = read('admin/pages/dashboard/tabs/orders/CollectionBookingsReview.tsx');
  assert.doesNotMatch(review, /requestsOnly/);
  assert.match(read('admin/pages/dashboard/tabs/orders/OrdersAdminView.tsx'), /clientRequests.rows/);
});

test('editing a client is not refused for the number the client already holds', () => {
  const route = read('api/routes/admin/subscribers.js');
  assert.match(route, /const alreadyHeld = new Set\(\[storedNumbers\?\.phone, storedNumbers\?\.phone2\]/);
  assert.match(route, /number && !alreadyHeld\.has\(String\(number\)\)/);
  assert.match(route, /const heldBy = numbersToCheck\.length/);
});

test('the interviews page has «محضروش الانترفيو» and «المرفوضون», fed by «لم يحضر» and «رفض»', () => {
  const migration = read('api/migrations/297_v26_interview_no_show_and_rejected.sql');
  assert.match(migration, /ADD COLUMN IF NOT EXISTS no_show_at DATETIME NULL/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS rejected_from_interview TINYINT\(1\)/);
  assert.match(read('api/schema.sql'), /`no_show_at` datetime DEFAULT NULL,\s+`rejected_from_interview` tinyint\(1\) NOT NULL DEFAULT 0,/);

  const server = read('api/routes/hr/recruiting.js');
  assert.match(server, /const rejectedList = req\.query\.view === 'rejected';/);
  assert.match(server, /const noShowList = !rejectedList && req\.query\.tab === 'no_show';/);
  assert.match(server, /a\.stage='interview' AND a\.no_show_at IS NOT NULL/);
  assert.match(server, /AND a\.no_show_at IS NULL AND \$\{past \? '' : 'NOT '\}\$\{held\}/, 'the other tabs leave the ones who did not come out');
  assert.match(server, /if \(noShow === true\) sets\.push\('no_show_at=NOW\(\)'\)/);
  assert.match(server, /else if \(noShow === false \|\| req\.body\.interview_at\) sets\.push\('no_show_at=NULL'\)/, 'a new appointment brings them back');
  assert.match(server, /NO_SHOW_NEEDS_INTERVIEW_STAGE/);
  assert.match(server, /req\.body\.stage === 'rejected' && \['interview', 'offer'\]\.includes\(current\.stage\)\) sets\.push\('rejected_from_interview=1'\)/);
  assert.match(server, /rejected: Number\(rejected\.n\) \|\| 0,/);

  const filters = read('admin/pages/dashboard/tabs/interviews-sections/InterviewFilters.tsx');
  assert.match(filters, /label: 'محضروش الانترفيو'/);
  assert.match(filters, /label: 'المرفوضون'/);
  const card = read('admin/pages/dashboard/tabs/interviews-sections/InterviewCard.tsx');
  assert.match(card, /<UserX size=\{13\} \/> لم يحضر/);
  assert.match(card, /actions\.onNoShow\(row\)/);
  assert.match(card, /رجّعه للمقابلات/);
  const screen = read('admin/pages/dashboard/tabs/InterviewsTab.tsx');
  assert.match(screen, /updateHrApplicant\(row\.id, \{ no_show \}\)/);
});
