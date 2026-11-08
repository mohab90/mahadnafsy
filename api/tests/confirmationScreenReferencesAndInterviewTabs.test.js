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








