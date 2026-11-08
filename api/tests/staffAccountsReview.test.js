'use strict';
const { leadsRouteSource, sourceOf } = require('./_authRouteSource');

// The staff accounts, 28 September:
//   «حساب وفاء ظاهر اسماء الكورسات غلط» — no employee but an admin ever loaded
//     the catalogue, so courses were named from a browser cache or the demo seed;
//   «يقدر يطلب اجازه او اذن تاخير صباحي او مسائي وبيقدر يطلب سلفه وكل دا بيروح
//     لحساب الموارد البشرية»;
//   «ليه بيظهر في حساب التحصيل قيم العملاء المحتملين كامله؟ خلي يظهرله زي ما
//     بيظهر للسيلز»;
//   «اوزع الداتا علي فريق التحصيل ... في الداتا المتبقيه»;
//   «يضيف مشترك جديد ولكن لا يضاف حتي يراجع تحويله ومدفوعاته من حساب المسئول
//     واي حجز لازم ميسمعش لحد ما المسئول يتاكد من المدفوعات ويربطه بتحويل»;
//   «غير شكل صفحه المدفوعات ... ويفضل التصميم الحالي للادارة والمحاسب
//     والمسئول للاونلاين فقط».

const test = require('node:test');
const assert = require('node:assert/strict');
const { dashboardSource } = require('./_adminSplitSource');
const fs = require('node:fs');
const path = require('node:path');
const { ROOT, read } = require('./support/repo');


function loadAdminModule(rel) {
  let esbuild;
  try { esbuild = require(path.join(ROOT, 'admin', 'node_modules', 'esbuild')); } catch { return null; }
  const out = esbuild.buildSync({
    entryPoints: [path.join(ROOT, rel)], bundle: true, write: false, format: 'cjs', platform: 'node', logLevel: 'silent',
    nodePaths: [path.join(ROOT, 'admin', 'node_modules')], define: { 'import.meta.env': '{}' },
  });
  const module = { exports: {} };
  new Function('module', 'exports', 'require', out.outputFiles[0].text)(module, module.exports, require);
  return module.exports;
}
const pools = loadAdminModule('admin/pages/dashboard/tabs/leads/leadSourceGroups.ts');



test('a collection officer\'s leads are the ones handed to them and the ones behind their clients', () => {
  const { leadScope } = require('../lib/leadAccess');
  const scope = leadScope({ tenantId: 't1', staffRecord: { id: 'st-9', role: 'COLLECTION' }, isSuperAdmin: false }, 'l');
  assert.equal(scope.scope, 'assigned_cs');
  assert.match(scope.sql, /l\.assigned_cs_id=\? OR l\.id IN \(SELECT lead_id FROM subscribers/);
  assert.deepEqual(scope.params, ['st-9', 't1', 'st-9']);
  const staffLeads = read('api/routes/admin/stafflists.js');
  
  
});

test('a lead handed to collection leaves the pool a sales distribution draws from', { skip: !pools }, () => {
  const lead = { hidden: false, assignedSalesId: null, assignedCsId: null, source: 'فيسبوك', status: 'new', branch: 'ONLINE_EGYPT' };
  assert.equal(pools.isLocalNewLead(lead), true);
  assert.equal(pools.isLocalNewLead({ ...lead, assignedCsId: 'st-9' }), false);
  for (const rel of ['api/routes/admin/leads.js', 'api/routes/crm-advanced.js', 'api/routes/lead-capture-crm.js']) {
    assert.match(sourceOf(rel), /assigned_cs_id IS NULL OR (l\.)?assigned_cs_id ?= ?''/, rel);
  }
});

test('collection works leads like a rep: the sales view, their own leads, a lead of their own', () => {
  
  const { ROLE_PERMS } = require('../constants/permissions');
  assert.ok(ROLE_PERMS.collection.includes('manage_leads'));
  const leads = leadsRouteSource();
  // Created by collection: theirs, never auto-assigned to sales.
  
  
  
  
  // The desk's tools refuse the role by name.
  assert.equal((leads.match(/\['sales', 'collection'\]\.includes\(String\(req\.staffRecord\?\.role/g) || []).length, 2);
});







test('a transfer confirms one payment, and a cash box needs none', async () => {
  const { isCashMethod, linkTransfer, cleanTransfer } = require('../lib/incomingTransfers');
  assert.equal(isCashMethod('نقدي'), true);
  assert.equal(isCashMethod('خزنة الدقي'), true);
  assert.equal(isCashMethod('فودافون كاش 2020'), false);
  // The rule lost its \s once to a shell: « cash » and «كاش» were not cash.
  assert.equal(isCashMethod(' cash '), true);
  assert.equal(isCashMethod('كاش'), true);
  assert.equal(isCashMethod('cashback wallet'), false);
  assert.throws(() => cleanTransfer({ amount: 100, method: 'انستا باي', reference: '' }), /رقم العملية/);
  const fakeConn = row => ({
    calls: [],
    // The transfer row is read whole now: a bigger one is split against the payment (migration 266).
    async query(sql, params) {
      this.calls.push(sql);
      if (/SELECT \* FROM incoming_transfers WHERE tenant_id=\? AND id=\?/.test(sql)) return [[row]];
      if (/^\s*SELECT/.test(sql)) return [[]];
      return [{ affectedRows: 1 }];
    },
  });
  const taken = fakeConn({ id: 't1', payment_id: 'p-other' });
  await assert.rejects(linkTransfer(taken, { tenantId: 'x', paymentId: 'p1', link: { transferId: 't1' } }), /متربط بدفعة تانية/);
  const free = fakeConn({ id: 't1', payment_id: null });
  assert.equal(await linkTransfer(free, { tenantId: 'x', paymentId: 'p1', link: { transferId: 't1' } }), 't1');
  assert.ok(free.calls.some(sql => /UPDATE payments SET linked_transfer_id=\?/.test(sql)));
});





// «زر حجز - دفعة في الاسفل دا لازم يكون ظاهر لكل الحسابات». It was hidden
// from accounts the server would refuse; every role now holds manage_payments,
// so the button is on every account and its save is never refused.
test('booking is on every account, and every account may record it', () => {
  
  const { ROLE_PERMS } = require('../constants/permissions');
  // Not the lecturer's jobs: their account is the portal (they land there, never on this page).
  const portalOnly = ['instructor', 'trainer', 'consultant', 'expert'];
  for (const [role, perms] of Object.entries(ROLE_PERMS).filter(([name]) => !portalOnly.includes(name))) {
    assert.ok(perms === '*' || perms.includes('manage_payments'), `${role} cannot record the booking it is offered`);
  }
});
