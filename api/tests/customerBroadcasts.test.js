'use strict';
// A customer opening the site was served the staff feed. /api/notifications/
// broadcasts reads a JSON blob of "broadcasts" and, until this test existed,
// returned every entry in it that was still active. On production that blob
// held 100 entries and not one was a broadcast: 53 announcing each new
// subscriber by name, 47 naming the salesperson a lead had been assigned to.
// Every signed-in customer could read both.
//
// The blob is filled by an admin screen that once mirrored the internal feed
// into it (NOT-01, since rewired). The filter is the boundary regardless of
// what refills it, so it is what this test holds down.
//
// The real function is lifted out of the route and run, rather than restated
// here — a restated copy passes forever while the shipped one rots.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'routes', 'config.js'), 'utf8');

function loadFilter() {
  const set = source.match(/const CUSTOMER_BROADCAST_TYPES = new Set\(\[[^\]]*\]\);/);
  const fn = source.match(/function activeBroadcasts\(items\) \{[\s\S]*?\n\}/);
  assert.ok(set, 'CUSTOMER_BROADCAST_TYPES declaration not found in routes/config.js');
  assert.ok(fn, 'activeBroadcasts not found in routes/config.js');
  // eslint-disable-next-line no-new-func
  return new Function(`${set[0]}\n${fn[0]}\nreturn activeBroadcasts;`)();
}

const activeBroadcasts = loadFilter();
const titles = items => activeBroadcasts(items).map(item => item.title);

test('the staff feed that leaked is withheld from customers', () => {
  const leaked = [
    { id: 'a', type: 'subscriber', title: 'مشترك جديد', active: true },
    { id: 'b', type: 'lead', title: 'تعيين ليد', active: true },
    { id: 'c', type: 'payment', title: 'دفعة جديدة', active: true },
    { id: 'd', type: 'hr', title: 'طلب إجازة', active: true },
    { id: 'e', type: 'ticket', title: 'تذكرة دعم', active: true },
    { id: 'f', type: 'refund', title: 'طلب استرداد', active: true },
    { id: 'g', type: 'certificate', title: 'شهادة', active: true },
    { id: 'h', type: 'system', title: 'إعداد النظام', active: true },
    { id: 'i', type: 'alert', title: 'تنبيه أمني', active: true },
  ];
  assert.deepEqual(activeBroadcasts(leaked), []);
});

test('genuine announcements still reach customers', () => {
  const real = [
    { id: 'a', type: 'info', title: 'موعد المحاضرة', active: true },
    { id: 'b', type: 'offer', title: 'خصم الدفعة الجديدة', active: true },
    { id: 'c', type: 'update', title: 'تحديث المنصة', active: true },
  ];
  assert.deepEqual(titles(real), ['موعد المحاضرة', 'خصم الدفعة الجديدة', 'تحديث المنصة']);
});

test('an unclassified entry is withheld, not shown', () => {
  // A blocklist would have to name every internal type in advance and would
  // serve anything a later feature invents. Absent and unknown both stay in.
  assert.deepEqual(activeBroadcasts([
    { id: 'a', title: 'no type at all', active: true },
    { id: 'b', type: '', title: 'empty type', active: true },
    { id: 'c', type: 'whatever_comes_next', title: 'unknown type', active: true },
  ]), []);
});

test('active and expiry still apply to a customer broadcast', () => {
  const past = new Date(Date.now() - 86400000).toISOString();
  const future = new Date(Date.now() + 86400000).toISOString();
  assert.deepEqual(titles([
    { id: 'a', type: 'info', title: 'switched off', active: false },
    { id: 'b', type: 'info', title: 'expired', active: true, expiresAt: past },
    { id: 'c', type: 'info', title: 'live', active: true, expiresAt: future },
    { id: 'd', type: 'info', title: 'no expiry', active: true },
  ]), ['live', 'no expiry']);
});

test('the type check is case-insensitive and survives a non-array blob', () => {
  assert.deepEqual(titles([{ id: 'a', type: 'INFO', title: 'shouty', active: true }]), ['shouty']);
  for (const notAList of [null, undefined, {}, 'notifications', 7]) {
    assert.deepEqual(activeBroadcasts(notAList), []);
  }
});

test('the admin write path stores only customer broadcasts', () => {
  // Filtering on read leaves the internal notices sitting in the row, where the
  // next reader of that blob finds them again.
  const put = source.slice(source.indexOf("router.put('/api/admin/notification-settings'"));
  const handler = put.slice(0, put.indexOf('\n});'));
  assert.match(handler, /CUSTOMER_BROADCAST_TYPES\.has/);
  assert.match(handler, /setTenantSetting\('notifications', broadcasts/);
});
