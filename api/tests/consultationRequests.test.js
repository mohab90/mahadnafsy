'use strict';

// «الاستشارات فيها مشاكل في الربط ومش قادر احدد اوفر الاستشارة اللى بيظهر في
// الموقع … وطلبات الاستشارات مش بتظهر ابدا».

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const {
  bookingRuleError, consultationSettings, expressPrice, openConsultationRequest, settleConsultationForOrder,
} = require('../lib/consultationRequests');

const ROOT = path.join(__dirname, '..', '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// Rows kept in memory; each statement this module issues is matched by its shape.
function fakeDb(consultations = []) {
  const calls = [];
  return {
    consultations, calls,
    async query(sql, params) {
      calls.push({ sql, params });
      if (/^SELECT id FROM consultations WHERE tenant_id=\? AND order_id=\?/.test(sql)) {
        const row = consultations.find(c => c.tenant_id === params[0] && c.order_id === params[1]);
        return [[row ? { id: row.id } : undefined]];
      }
      if (/^\s*INSERT INTO consultations/.test(sql)) {
        consultations.push({ id: params[0], tenant_id: params[1], order_id: params[17], source: params[18], status: 'PENDING', paid_at: null });
        return [{ affectedRows: 1 }];
      }
      if (/^\s*UPDATE consultations\s+SET paid_at/.test(sql)) {
        const row = consultations.find(c => c.id === params[4]);
        row.paid_at = 'now';
        if (params[3] && row.status === 'PENDING') row.status = 'CONFIRMED';
        return [{ affectedRows: 1 }];
      }
      if (/FROM therapist_slots/.test(sql)) return [[undefined]];
      return [{ affectedRows: 1 }];
    },
  };
}

test('the express price is the one the checkout charges, and the old EGP key still counts', () => {
  assert.equal(expressPrice({ 'express.price.EGP': '450' }, 'EGP'), 450);
  assert.equal(expressPrice({ 'consultation.price_egp': '500' }, 'EGP'), 500, 'the price the owner already saved');
  assert.equal(expressPrice({ 'consultation.price_egp': '500' }, 'SAR'), 0, 'no invented riyal price');
  assert.equal(expressPrice({}, 'USD'), 0);
});

test('booking rules come from the settings and are judged on the Cairo calendar', () => {
  const settings = consultationSettings({ 'consultation.booking_window_days': '10', 'consultation.min_notice_hours': '4' });
  const now = new Date('2026-09-30T09:00:00Z'); // 12:00 in Cairo, a Wednesday
  assert.equal(bookingRuleError({ sessionDate: '2026-09-29', settings, now }).code, 'SESSION_DATE_PAST');
  assert.equal(bookingRuleError({ sessionDate: '2026-10-11', settings, now }).code, 'SESSION_DATE_TOO_FAR');
  assert.equal(bookingRuleError({ sessionDate: '2026-10-10', settings, now }), null);
  assert.equal(bookingRuleError({ sessionDate: '2026-10-01', slot: { day: 'friday', start_time: '18:00' }, settings, now }).code,
    'SLOT_DAY_MISMATCH', 'a Thursday date on a Friday slot');
  assert.equal(bookingRuleError({ sessionDate: '2026-09-30', slot: { day: 'wednesday', start_time: '14:00' }, settings, now }).code,
    'SESSION_TOO_SOON', 'two hours ahead against four of notice');
  assert.equal(bookingRuleError({ sessionDate: '2026-09-30', slot: { day: 'wednesday', start_time: '17:00' }, settings, now }), null);
  assert.equal(consultationSettings({ 'consultation.auto_confirm': 'true' }).autoConfirm, true);
});

test('a booking opens one consultation per order, unpaid, on the desk\'s list', async () => {
  const db = fakeDb();
  const first = await openConsultationRequest(db, { tenantId: 't', orderId: 'o1', name: 'منى', sessionType: 'express', source: 'site_express' });
  const again = await openConsultationRequest(db, { tenantId: 't', orderId: 'o1', name: 'منى', source: 'site_express' });
  assert.equal(first.created, true);
  assert.equal(again.created, false, 'returning to the same pending order updates it');
  assert.equal(db.consultations.length, 1);
  assert.equal(db.consultations[0].status, 'PENDING');
  assert.equal(db.consultations[0].paid_at, null);
  const insert = db.calls.find(call => /INSERT INTO consultations/.test(call.sql));
  assert.equal(insert.params[7], 'INDIVIDUAL', '«express» is not a session type the column accepts');
  assert.equal(insert.params[6], null, 'no therapist is NULL — an empty id breaks the foreign key');
});

test('paying settles that same consultation, and an old order gets one opened first', async () => {
  const db = fakeDb([{ id: 'c1', tenant_id: 't', order_id: 'o1', status: 'PENDING', paid_at: null }]);
  await settleConsultationForOrder(db, { tenantId: 't', order: { id: 'o1', amount: 500, currency: 'EGP' }, autoConfirm: true });
  assert.equal(db.consultations[0].paid_at, 'now');
  assert.equal(db.consultations[0].status, 'CONFIRMED', '«تأكيد الحجز تلقائياً»');

  const legacy = fakeDb();
  const notes = JSON.stringify({ consultationData: { clientName: 'مروه', sessionType: 'express', sessionDate: '' } });
  await settleConsultationForOrder(legacy, { tenantId: 't', order: { id: 'o2', notes, amount: 300, currency: 'EGP' } });
  assert.equal(legacy.consultations.length, 1);
  assert.equal(legacy.consultations[0].source, 'site_express');
  assert.equal(legacy.consultations[0].status, 'PENDING', 'paid, waiting for the desk to confirm');
});

test('every way of paying goes through the same consultation', () => {
  const checkout = read('api/routes/lead-capture-crm.js');
  assert.match(checkout, /openedConsultation = await openConsultationRequest\(conn, \{/);
  assert.match(checkout, /slotId: req\.body\?\.slotId \|\| null,/, 'the chosen hour travels with the order');
  assert.ok(checkout.indexOf("=== 'express') {") < checkout.indexOf('} else if (therapistId) {'),
    'express is decided before the therapist branch');
  assert.match(checkout, /createNotification\('consultation', '🗓️ طلب استشارة جديد'/);
  assert.match(read('api/routes/payment-proofs.js'), /await settleConsultationForOrder\(conn, \{/);
  const paymob = read('api/routes/public-orders.js');
  assert.match(paymob, /if \(String\(order\.type \|\| ''\)\.toUpperCase\(\) === 'CONSULTATION'\) \{/);
  assert.ok(!paymob.includes('INSERT IGNORE INTO consultations'), 'the card path wrote its own row, from data the checkout never sent');
  assert.match(read('api/lib/notificationAudience.js'), /consultation: \{ perms: \['view_consultations', 'manage_consultations'\]/);
});

test('changing a booking\'s status keeps its notes and meeting link', () => {
  const route = read('api/routes/core/catalog.js');
  assert.ok(!route.includes("'UPDATE consultations SET status=?, notes=?, meeting_link=? WHERE id=? AND tenant_id=?'"));
  assert.match(route, /if \(notes !== undefined\) \{ sets\.push\('notes=\?'\)/);
});

test('the settings screen writes the keys the site reads', () => {
  const screen = read('admin/pages/dashboard/tabs/consultations/ConsultationSettingsTab.tsx');
  for (const key of ['express.price.EGP', 'express.price.SAR', 'express.price.USD', 'express.therapistId', 'home.express.title', 'consult.express.desc', 'consultation.show_on_home']) {
    assert.ok(screen.includes(`'${key}'`), key);
  }
  assert.ok(read('client/pages/Home.tsx').includes("content['consultation.show_on_home'] !== 'false'"));
  assert.ok(!read('client/pages/Home.tsx').includes("(currency==='EGP'?'500'"), 'a price nobody set');
  assert.ok(!read('client/pages/Consultations.tsx').includes("|| '300')"), 'a second price nobody set');
});
