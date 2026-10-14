'use strict';

// 11 Oct 2026: a disk at 80% or more WhatsApps the owner-report numbers, once a
// week per disk, as a staff_alert through the outbox — and the health output
// carries the figure (lib/diskUsage.js).

const test = require('node:test');
const assert = require('node:assert/strict');

const stub = (rel, exports) => {
  const file = require.resolve(rel);
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
};
const queued = [];
stub('../lib/ownerDailyReport', {
  SECTION: 'owner_reports',
  ownerReportSettings: async tenantId => ({ phones: tenantId === 'tenant-default' ? ['201000000001', '201000000002'] : [] }),
});
stub('../lib/outbox', {
  enqueue: async row => {
    // The unique (tenant_id, dedupe_key) index, as the table enforces it.
    if (queued.some(other => other.tenantId === row.tenantId && other.dedupeKey === row.dedupeKey)) return null;
    queued.push(row);
    return `id-${queued.length}`;
  },
});

const { alertOnFullDisks, diskUsage, weekStart } = require('../lib/diskUsage');
const pool = { query: async () => [[{ tenant_id: 'tenant-default' }, { tenant_id: 'tenant-other' }]] };

test('a full disk is one staff_alert per owner number, and only one a week', async () => {
  queued.length = 0;
  const disks = [{ path: '/', usedPercent: 86.4, freeGb: 5.1 }, { path: '/data', usedPercent: 40, freeGb: 300 }];
  assert.equal(await alertOnFullDisks({ pool, disks, today: '2026-10-11' }), 2);
  assert.equal(queued.length, 2);
  for (const row of queued) {
    assert.equal(row.channel, 'whatsapp');
    assert.equal(row.payload.category, 'staff_alert');
    assert.match(row.payload.message, /86\.4%/);
    assert.ok(row.dedupeKey.length <= 150, 'message_outbox.dedupe_key is VARCHAR(150)');
  }
  assert.deepEqual(queued.map(row => row.recipient), ['201000000001', '201000000002']);

  // Later the same week: nothing new. The next week: again.
  assert.equal(await alertOnFullDisks({ pool, disks, today: '2026-10-08' }), 0);
  assert.equal(await alertOnFullDisks({ pool, disks, today: '2026-10-12' }), 2);
});

test('below the threshold nothing is sent', async () => {
  queued.length = 0;
  assert.equal(await alertOnFullDisks({ pool, disks: [{ path: '/', usedPercent: 79.9, freeGb: 20 }] }), 0);
  assert.equal(queued.length, 0);
});

test('weeks start on Monday, Cairo date', () => {
  assert.equal(weekStart('2026-10-11'), '2026-10-05'); // a Sunday
  assert.equal(weekStart('2026-10-12'), '2026-10-12'); // a Monday
});

test('the real disks are measured, each filesystem once', () => {
  const disks = diskUsage([__dirname, __dirname, '/no/such/path']);
  if (!disks.length) return; // a Node without fs.statfsSync
  assert.equal(disks.length, 1);
  assert.ok(disks[0].usedPercent >= 0 && disks[0].usedPercent <= 100);
});
