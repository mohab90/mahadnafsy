'use strict';

// «تشغل الواتس اب الجديد في صندوق الرسايل وتبقى عامل اوبشن ان في كذا سيلز، كل واحدة هترد يظهرلها رسايلها فقط باسمها، واحنا بس اللي بنشوف كله، ودا على
// ماسنجر وانستجرام كمان كله متجمع في انبوكس واحد» (28 Oct 2026).

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-team-inbox-0123456789abcdef';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const visibility = require('../lib/teamInboxSettings');
const threads = require('../lib/inboxThreads');

const read = relative => fs.readFileSync(path.join(__dirname, '..', '..', relative), 'utf8');
const POOL = visibility.clean({});
const OWN = visibility.clean({ repVisibility: 'own' });

test('the default is the shared pool, and «own» always carries the automatic distribution', () => {
  assert.deepEqual(POOL, { repVisibility: 'pool', autoAssign: false, signReplies: false });
  assert.deepEqual(OWN, { repVisibility: 'own', autoAssign: true, signReplies: false }, 'a conversation nobody can see would be a lost customer');
  assert.deepEqual(visibility.clean({ repVisibility: 'own', autoAssign: false, signReplies: 1 }), { repVisibility: 'own', autoAssign: true, signReplies: true });
  assert.deepEqual(visibility.clean({ repVisibility: 'everything', autoAssign: 'yes' }), { repVisibility: 'pool', autoAssign: true, signReplies: false }, 'an unknown mode is the pool');
});

test('a rep opens her own conversations; in the pool also the ones nobody has taken; in «own» nobody else\'s; the people who see everything open all', () => {
  const mine = { assigned_staff_id: 'rep1' };
  const colleagues = { assigned_staff_id: 'rep2' };
  const nobodys = { assigned_staff_id: null };
  const may = (thread, settings, extra = {}) => visibility.mayOpenThread({ seesAll: false, me: 'rep1', thread, settings, ...extra });
  assert.equal(may(mine, POOL), true);
  assert.equal(may(nobodys, POOL), true);
  assert.equal(may(colleagues, POOL), false);
  assert.equal(may(mine, OWN), true);
  assert.equal(may(nobodys, OWN), false, 'in «own» the ones nobody has are not a rep\'s');
  assert.equal(may(colleagues, OWN), false);
  assert.equal(may(nobodys, OWN, { me: null }), false, 'an account with no staff row is nobody\'s rep');
  for (const thread of [mine, colleagues, nobodys]) {
    assert.equal(may(thread, OWN, { seesAll: true }), true, 'the owner and the sales manager see all');
    assert.equal(may(thread, POOL, { seesAll: true }), true);
  }
});

test('in «own» a rep has one list, whatever she asks for; managers keep all three', () => {
  const view = (seesAll, requested, settings) => visibility.allowedView({ seesAll, requested, settings });
  assert.equal(view(false, 'all', OWN), 'mine');
  assert.equal(view(false, 'unassigned', OWN), 'mine');
  assert.equal(view(false, 'all', POOL), 'all');
  assert.equal(view(false, 'unassigned', POOL), 'unassigned');
  assert.equal(view(true, 'unassigned', OWN), 'unassigned');
  assert.equal(view(true, 'all', OWN), 'all');
  assert.equal(view(true, 'nonsense', OWN), 'mine');
});

test('a reply carries the rep\'s first name only when the option is on', () => {
  const on = { ...POOL, signReplies: true };
  assert.equal(visibility.signed('أهلاً بيك', 'منى أحمد علي', on), 'أهلاً بيك\n— منى');
  assert.equal(visibility.signed('أهلاً بيك  ', 'منى', on), 'أهلاً بيك\n— منى');
  assert.equal(visibility.signed('أهلاً بيك', 'منى', POOL), 'أهلاً بيك');
  assert.equal(visibility.signed('أهلاً بيك', '', on), 'أهلاً بيك', 'no name, no signature');
  assert.equal(visibility.signed('', 'منى', on), '', 'a template has no text to sign');
});

function threadDb({ existing = { id: 'th1', assigned_staff_id: null } } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      const flat = sql.replace(/\s+/g, ' ');
      calls.push({ sql: flat, params });
      if (/^SELECT id, assigned_staff_id FROM inbox_threads/.test(flat)) return [[existing]];
      if (/^UPDATE inbox_threads SET assigned_staff_id=\?/.test(flat)) return [{ affectedRows: 1 }];
      if (/^SELECT id FROM inbox_threads/.test(flat)) return [[{ id: 'a' }, { id: 'b' }, { id: 'c' }]];
      return [{ affectedRows: 1 }];
    },
  };
}

test('with the distribution on, a new conversation is given to the next rep and she is told; with it off, it waits to be taken', async () => {
  const assignment = require('../lib/leadAssignment');
  const notification = require('../lib/notification');
  const original = { rep: assignment.getNextSalesRep, notify: notification.createNotification };
  const told = [];
  assignment.getNextSalesRep = async () => ({ id: 'rep7', name: 'منى' });
  notification.createNotification = async (...args) => { told.push(args); };
  try {
    visibility._cache.set('t1', { value: OWN, at: Date.now() });
    const db = threadDb();
    const made = await threads.upsertThread(db, { tenantId: 't1', platform: 'instagram', contactKey: 'ig:123' });
    assert.equal(made.assigned_staff_id, 'rep7');
    const update = db.calls.find(call => /^UPDATE inbox_threads SET assigned_staff_id=\?, assigned_at=NOW\(\) WHERE tenant_id=\? AND id=\? AND assigned_staff_id IS NULL/.test(call.sql));
    assert.deepEqual(update.params, ['rep7', 't1', 'th1'], 'only a conversation still nobody\'s, and only in this tenant');
    assert.equal(told[0][5], 'rep7');
    assert.match(told[0][2], /انستجرام/);

    visibility._cache.set('t1', { value: POOL, at: Date.now() });
    const waiting = await threads.upsertThread(threadDb(), { tenantId: 't1', platform: 'messenger', contactKey: 'm1' });
    assert.equal(waiting.assigned_staff_id, null);

    // already owned: left alone, nobody asked
    visibility._cache.set('t1', { value: OWN, at: Date.now() });
    told.length = 0;
    const owned = await threads.upsertThread(threadDb({ existing: { id: 'th2', assigned_staff_id: 'rep1' } }), { tenantId: 't1', platform: 'whatsapp', contactKey: '2010' });
    assert.equal(owned.assigned_staff_id, 'rep1');
    assert.equal(told.length, 0);
  } finally {
    assignment.getNextSalesRep = original.rep;
    notification.createNotification = original.notify;
    visibility._cache.clear();
  }
});

test('switching the distribution on gives out the open conversations nobody has, and stops when there is no rep to give them to', async () => {
  const assignment = require('../lib/leadAssignment');
  const original = assignment.getNextSalesRep;
  let turn = 0;
  assignment.getNextSalesRep = async () => (turn++ < 2 ? { id: `rep${turn}`, name: 'x' } : null);
  try {
    const db = threadDb();
    assert.equal(await threads.distributeWaiting(db, 't1'), 2);
    const select = db.calls.find(call => /^SELECT id FROM inbox_threads/.test(call.sql));
    assert.match(select.sql, /status='open' AND assigned_staff_id IS NULL/);
    assert.deepEqual(select.params, ['t1', 500]);
  } finally { assignment.getNextSalesRep = original; }
});

test('the inbox routes and the screen follow the setting, and only the people who see everything change it', () => {
  const route = read('api/routes/team-inbox.js');
  assert.match(route, /if \(!mayOpenThread\(\{ seesAll: seesAll\(req\), me: me\(req\), thread, settings \}\)\) \{/);
  assert.match(route, /const view = allowedView\(\{ seesAll: seesAll\(req\), requested: req\.query\.view, settings \}\);/);
  assert.match(route, /unassigned: ownOnly \? 0 : Number\(row\.unassigned\) \|\| 0/);
  assert.match(route, /'AUTO_ASSIGNED'/);
  assert.match(route, /const outgoing = signed\(text, req\.staffRecord\?\.name, await teamInboxSettings\(req\.tenantId\)\);/);
  assert.match(route, /sendWhatsApp\(thread\.contact_key, outgoing,/);
  assert.match(route, /sendMessengerMessage\(thread\.contact_key, outgoing,/);
  const put = route.slice(route.indexOf("router.put('/api/admin/team-inbox/settings'"));
  assert.match(put.slice(0, 400), /if \(!seesAll\(req\)\) throw refuse\(403, 'إعدادات الصندوق للإدارة بس', 'MANAGERS_ONLY'\);/);
  assert.match(put, /distributeWaiting\(pool, req\.tenantId\)/);

  const screen = read('admin/pages/dashboard/tabs/whatsapp/TeamInboxTab.tsx');
  assert.match(screen, /\{\(seesAll \|\| repVisibility !== 'own'\) && tab\('unassigned'/);
  assert.match(screen, /\{\(seesAll \|\| repVisibility !== 'own'\) && tab\('all'/);
  assert.match(screen, /\{showSettings && seesAll && <InboxVisibilitySettings/);
  const inboxLib = read('api/lib/inboxThreads.js');
  assert.match(inboxLib, /if \(settings\?\.autoAssign\) \{\s*const rep = await assignUnowned\(db, tenantId, thread\.id\);/);
});

test('every platform in the inbox reaches the same thread table, so one setting covers WhatsApp, Messenger and Instagram', () => {
  assert.deepEqual(threads.PLATFORMS, ['whatsapp', 'messenger', 'instagram']);
  const inbound = read('api/lib/whatsappInbound.js');
  const social = read('api/lib/messenger.js');
  assert.match(inbound, /upsertThread\(/);
  assert.match(social, /upsertThread\(/);
});

test('the screen says which platforms can really bring messages in: Wapilot only sends', () => {
  const route = read('api/routes/team-inbox.js');
  assert.match(route, /router\.get\('\/api\/admin\/team-inbox\/readiness', \.\.\.guard,/);
  assert.match(route, /\['meta', 'green-api'\]\.includes\(whatsapp\.provider\)/);
  assert.match(route, /WHATSAPP_APP_SECRET'\) && has\('WHATSAPP_WEBHOOK_VERIFY_TOKEN'\)/);
  // the claim the hint makes is true: no inbound route exists for Wapilot
  const webhooks = read('api/routes/whatsapp-webhook.js');
  assert.match(webhooks, /\/api\/webhooks\/whatsapp\/meta/);
  assert.match(webhooks, /\/api\/webhooks\/whatsapp\/green-api/);
  assert.doesNotMatch(webhooks, /wapilot/i);
  const panel = read('admin/pages/dashboard/tabs/whatsapp/InboxVisibilitySettings.tsx');
  assert.match(panel, /'\/admin\/team-inbox\/readiness'/);
});
