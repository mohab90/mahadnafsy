'use strict';

// «صفحه إحصائياتي للسيلز … تفرح مع كل حجز … وتزعل لما التارجيت يكون بعيد …
// وتتفاعل معاه في كل حجز وكل عميل جديد» (8 Oct 2026). The page is built on
// these figures: the team report's own row for the rep, the target, the run of
// days with a booking, the best day, and the latest bookings and new clients.

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildSalesPulse, streakOf } = require('../lib/salesPulse');

function db() {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      const flat = String(sql).replace(/\s+/g, ' ');
      calls.push({ sql: flat, params });
      if (/FROM staff WHERE/.test(flat)) return [[{ id: 'st-sama', name: 'سما' }]];
      if (/FROM communications/.test(flat)) return [[{ rep: 'st-sama', calls: 7, whatsapp: 3, meetings: 0, contacts: 10, leadsContacted: 8 }]];
      if (/SUM\(created_at >= \? AND created_at < \?\) AS freshLeads/.test(flat)) return [[{ rep: 'st-sama', newLeads: 4, freshLeads: 2 }]];
      if (/SUM\(assigned_sales_id IS NULL/.test(flat)) return [[{ total: 30, unassigned: 0 }]];
      if (/followUpsDue/.test(flat)) return [[{ rep: 'st-sama', followUpsDue: 2, followUpsOverdue: 1 }]];
      if (/AS rep, SUM\(p\.is_installment=0\) AS bookings/.test(flat)) {
        const monthly = params[1] === '2026-10-01';
        return [[{ rep: 'st-sama', bookings: monthly ? 6 : 1, installments: 0, moneyEgp: monthly ? 21000 : 3500 }]];
      }
      if (/FROM sales_targets/.test(flat)) return [[{ revenueTarget: 60000, leadsTarget: 120 }]];
      if (/GROUP BY p\.date/.test(flat)) {
        return [[
          { day: '2026-10-08', bookings: 1, moneyEgp: 3500 },
          { day: '2026-10-07', bookings: 2, moneyEgp: 9000 },
          { day: '2026-10-06', bookings: 1, moneyEgp: 2500 },
          { day: '2026-10-04', bookings: 2, moneyEgp: 6000 },
          { day: '2026-09-30', bookings: 1, moneyEgp: 12000 },
        ]];
      }
      if (/ORDER BY p\.created_at DESC/.test(flat)) {
        return [[{ id: 'p9', day: '2026-10-08', at: '2026-10-08T09:30:00Z', installment: 0, amountEgp: 3500, item: 'العلاج المعرفي', name: 'منى' }]];
      }
      if (/FROM leads WHERE tenant_id=\? AND hidden=0 AND assigned_sales_id=\?/.test(flat)) {
        return [[{ id: 'L7', name: 'هاني', at: '2026-10-08T10:15:00Z' }]];
      }
      return [[]];
    },
  };
}

test('the rep reads their month and today as the team report counts them, against their target', async () => {
  const pulse = await buildSalesPulse({ tenantId: 't', staffId: 'st-sama', today: '2026-10-08' }, db());
  assert.equal(pulse.daysInMonth, 31);
  assert.equal(pulse.dayOfMonth, 8);
  assert.deepEqual(pulse.target, { revenue: 60000, leads: 120 });
  assert.equal(pulse.month.moneyEgp, 21000);
  assert.equal(pulse.month.bookings, 6);
  assert.equal(pulse.todayFigures.bookings, 1);
  assert.equal(pulse.month.contacts, 10);
  assert.equal(pulse.streak, 3, '6, 7 and 8 October; the 5th had none');
  assert.deepEqual(pulse.bestDay, { day: '2026-10-07', bookings: 2, moneyEgp: 9000 }, 'September is not this month');
});

test('the latest client and booking come newest first, each with an id the page remembers', async () => {
  const pulse = await buildSalesPulse({ tenantId: 't', staffId: 'st-sama', today: '2026-10-08' }, db());
  assert.deepEqual(pulse.recent.map(event => [event.kind, event.id, event.name]), [
    ['lead', 'lead:L7', 'هاني'],
    ['booking', 'pay:p9', 'منى'],
  ]);
  assert.equal(pulse.recent[1].amountEgp, 3500);
});

test('a run of days survives a day not yet over', () => {
  const days = new Set(['2026-10-07', '2026-10-06']);
  assert.equal(streakOf(days, '2026-10-08'), 2, 'today has no booking yet');
  assert.equal(streakOf(new Set(), '2026-10-08'), 0);
});
