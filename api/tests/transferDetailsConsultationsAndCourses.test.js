'use strict';

// 19 Oct 2026 — «الموظف بيضيف رقم العملية واسم المحول ورقم التليفون اللي حول منه … لازم يظهر كل التفاصيل دي في صفحة
// المدفوعات», «مسئول تحصيل بيحاول يضيف مشترك جديد … بيقوله العميل مع موظف تاني برغم إنه مش موجود», the consultations
// clients table and its controls, and the public courses page's filter row.

const test = require('node:test');
const assert = require('node:assert/strict');
const { paymentModalSource } = require('./_adminSplitSource');
const fs = require('node:fs');
const path = require('node:path');

const read = relative => fs.readFileSync(path.join(__dirname, '..', '..', relative), 'utf8');

// Stored on the payment and found by it in the payments register: over HTTP in
// tests/integration/deskPaymentsAndOrders.integration.test.js. A collection
// officer's request keeps it too, and every payments screen reads it back.
test('the sender of a transfer is read back by every payments screen', () => {
  const booking = read('api/routes/subscriber-payments.js');
  assert.match(booking, /senderName: body\.payment\?\.senderName/, 'a collection officer\'s request keeps it too');
  for (const screen of [
    'admin/pages/dashboard/tabs/financial/PaymentsRegister.tsx',
    'admin/pages/dashboard/tabs/financial/PaymentReviewPanel.tsx',
    'admin/pages/dashboard/tabs/staff-payments/StaffPaymentsTab.tsx',
    'admin/pages/dashboard/tabs/orders/CollectionBookingsReview.tsx',
    'admin/pages/unified-client/UnifiedClientSubscriberPaymentsPanel.tsx',
  ]) assert.match(read(screen), /senderName/, screen);
});

test('the operation number, sender and number are optional — typed, they travel with the payment', () => {
  const modal = paymentModalSource();
  assert.doesNotMatch(modal, /transferNeedsDetails|transferProblem/, 'never a reason to refuse a booking');
  assert.match(modal, /const isValid = !subjectChosen/);
  assert.match(modal, /field\.label\} <span className="text-gray-400 font-normal">\(اختياري\)<\/span>/);
  // The three fields reach the server from every booking path.
  for (const file of [
    'admin/pages/dashboard/dashboardPaymentHandlers.ts', 'admin/lib/createClientWithPayment.ts', 'admin/pages/dashboard/tabs/FinancialTab.tsx',
    'admin/pages/unified-client/useUnifiedClientPayments.ts', 'admin/pages/dashboard/tabs/DaqqiScheduleTab.tsx',
  ]) assert.match(read(file), /senderName: \w+\.senderName \|\| undefined|senderName: txnFields\.senderName/, file);
});

test('a client being registered by the booking belongs to nobody, so the ownership rule cannot refuse it', () => {
  const booking = read('api/routes/subscriber-payments.js');
  assert.match(booking, /if \(!createFromDraft && !bookAny && !financialRecordMatches\(scope, subRow\)\)/);
});

test('every consultation booking, old or new, has its controls', () => {
  const tab = read('admin/pages/dashboard/tabs/consultations/ConsultationBookingsTab.tsx');
  assert.ok(!tab.includes('min-w-[900px]'), 'no sideways-scrolling table');
  assert.match(tab, /aria-label="حالة الحجز"/, 'any status to any status');
  assert.match(tab, /إعادة فتح الحجز/, 'a finished or cancelled booking can be reopened');
  for (const label of ['ملاحظات الجلسة', 'رابط الجلسة', 'اتصال', 'واتساب']) assert.ok(tab.includes(label), label);
  assert.match(read('admin/lib/mysqlapi.ts'), /updateConsultation: \(id: string, fields: \{ status\?: string; notes\?: string; meeting_link\?: string \| null \}\)/);
});

test('the public courses page is a search and a fields filter on one centred row', () => {
  const page = read('client/pages/Courses.tsx');
  assert.ok(!page.includes('selectedType'), 'the study-system filter is gone');
  assert.ok(!page.includes("<Pill value=\"Recorded\""), 'no study-system pills');
  assert.match(page, /role="group" aria-label="المجال"/);
  assert.match(page, /lg:justify-center/);
});
