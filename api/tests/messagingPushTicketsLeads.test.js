'use strict';

// The system report of 1 Oct («محتاجين نوصل 9,5 بحد ادني لاقل قسم»): every
// WhatsApp message carrying its kind, and the owner's switch for the kinds that
// stay closed; a health card and a resend bounded to recent messages; staff
// phones that receive the bell; tickets no queue saw, and tickets that never
// closed; a call logged as it is placed; the owner's payments credited to an
// employee; leads left waiting under the day's caps;
// confirmations that say what they confirm; schema.sql as production has it;
// and a course page a search engine reads as a course.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const read = rel => fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-messaging-push-secret-0123456789-abcdefghij';

// One pool for every module this file loads; each test sets its answers.
const db = {
  calls: [],
  answers: [],
  async query(sql, params = []) {
    const flat = sql.replace(/\s+/g, ' ');
    this.calls.push({ sql: flat, params });
    for (const [pattern, answer] of this.answers) {
      if (pattern.test(flat)) return typeof answer === 'function' ? answer(params) : answer;
    }
    return [{ affectedRows: 0 }];
  },
  reset(answers = []) { this.calls = []; this.answers = answers; },
  find(pattern) { return this.calls.find(call => pattern.test(call.sql)); },
};
const stub = (rel, exports) => {
  const file = require.resolve(rel);
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
};
stub('../lib/db', {
  pool: db,
  cached: async (_key, _ttl, fn) => fn(),
  cacheInvalidate() {},
  dbQuery: (...args) => db.query(...args),
  dbExecute: (...args) => db.query(...args),
  getStaffIdByEmail: async () => null,
  requireDb: (_req, _res, next) => next(),
  isDbDown: () => false,
});
const settings = new Map();
stub('../lib/tenantSettings', {
  ...require('../lib/tenantSettings'),
  getTenantSetting: async (key, { fallback = null } = {}) => (settings.has(key) ? settings.get(key) : fallback),
  setTenantSetting: async (key, value) => { settings.set(key, value); },
});
const pushed = [];
let pushFailure = null;
stub('../lib/push', {
  ...require('../lib/push'),
  sendPushNotification: async (subscription, payload) => {
    if (pushFailure) throw pushFailure;
    pushed.push({ subscription, payload });
    return true;
  },
});
const backlogCalls = { assigned: [], flushed: 0, branches: [] };
stub('../lib/leadAssignment', {
  ...require('../lib/leadAssignment'),
  createBatchAssigner: async (_tenantId, _db, { branch }) => {
    backlogCalls.branches.push(branch);
    let room = branch === 'ONLINE_EGYPT' ? 2 : 0;
    return {
      exhausted: () => room <= 0,
      next(lead) { if (room <= 0) return null; room -= 1; return { id: `rep-for-${lead.id}`, seen: lead }; },
      async flush() { backlogCalls.flushed += 1; },
    };
  },
  assignLead: async args => { backlogCalls.assigned.push(args); return { changed: true }; },
});

const ORIGINAL_ALLOWLIST = process.env.WHATSAPP_OUTBOUND_CATEGORIES;
process.env.WHATSAPP_OUTBOUND_CATEGORIES = 'otp';
for (const rel of ['../lib/whatsapp', '../lib/staffPush', '../lib/leadBacklog']) delete require.cache[require.resolve(rel)];
const whatsapp = require('../lib/whatsapp');
const { pushToStaff } = require('../lib/staffPush');
const { assignLeadBacklog, runLeadBacklog } = require('../lib/leadBacklog');
const { EVENT_CATEGORY } = require('../lib/lifecycle');
const support = require('../routes/support');
if (ORIGINAL_ALLOWLIST === undefined) delete process.env.WHATSAPP_OUTBOUND_CATEGORIES;
else process.env.WHATSAPP_OUTBOUND_CATEGORIES = ORIGINAL_ALLOWLIST;

// ── Messages ────────────────────────────────────────────────────────────────

test('every journey message names a kind the owner can switch', async () => {
  const { switchable } = await whatsapp.outboundState('tenant-a');
  for (const [event, category] of Object.entries(EVENT_CATEGORY)) {
    assert.ok(switchable.includes(category), `${event} → ${category}`);
  }
  const lifecycle = read('api/lib/lifecycle.js');
  assert.match(lifecycle, /const category = step\.category \|\| EVENT_CATEGORY\[event\] \|\| 'crm';/);
  assert.match(lifecycle, /\{ message: content, category \}/);
});

test('the drain passes each message\'s own kind, and every enqueuer gives one', () => {
  assert.match(read('api/lib/backgroundScheduler.js'),
    /sendWhatsApp\(recipient, message \|\| '', \{ tenantId, channelId, staffId, category: category \|\| 'broadcast' \}\)/);
  const kinds = {
    'api/lib/crmSla.js': 'staff_alert',
    'api/lib/leadInteractions.js': 'crm',
    'api/lib/whatsappCampaigns.js': 'broadcast',
    'api/routes/support.js': 'inbox_reply',
    'api/routes/lms.js': 'reminder',
  };
  for (const [file, kind] of Object.entries(kinds)) {
    assert.ok(read(file).includes(`category: '${kind}'`), `${file} enqueues ${kind}`);
  }
  // A lead gone quiet is told to the team, never held behind the customer switch.
  assert.equal(read('api/lib/crmSla.js').split("category: 'staff_alert'").length - 1, 2);
});

test('the gate opens what the server allows, staff alerts, and what the owner switched on', async () => {
  settings.set('whatsapp_outbound', { categories: ['welcome', 'not_a_kind'] });
  whatsapp.invalidateOutbound();
  assert.equal(await whatsapp.isCategoryOpen('otp', 'tenant-a'), true);
  assert.equal(await whatsapp.isCategoryOpen('staff_alert', 'tenant-a'), true);
  assert.equal(await whatsapp.isCategoryOpen('owner_report', 'tenant-a'), true);
  assert.equal(await whatsapp.isCategoryOpen('welcome', 'tenant-a'), true);
  assert.equal(await whatsapp.isCategoryOpen('broadcast', 'tenant-a'), false);
  assert.equal(await whatsapp.isCategoryOpen('not_a_kind', 'tenant-a'), false);
  assert.equal(await whatsapp.isCategoryOpen('', 'tenant-a'), false);
  assert.deepEqual((await whatsapp.outboundState('tenant-a')).panel, ['welcome']);

  // Closed again from the panel: the next read sees it, not a minute later.
  settings.set('whatsapp_outbound', { categories: [] });
  whatsapp.invalidateOutbound('tenant-a');
  assert.equal(await whatsapp.isCategoryOpen('welcome', 'tenant-a'), false);
  assert.match(read('api/lib/whatsapp.js'), /if \(!await isCategoryOpen\(opts\.category, tenantId\)\) \{/);
});

test('the switches are the owner\'s and managers\' to change, on screen and on the server', () => {
  const routes = read('api/routes/messaging-channels.js');
  assert.match(routes, /router\.get\('\/api\/admin\/messaging\/outbound', \.\.\.view,/);
  assert.match(routes, /router\.put\('\/api\/admin\/messaging\/outbound', requireAuth, requireAdmin,/);
  assert.match(routes, /\.filter\(name => state\.switchable\.includes\(name\)\)/);
  assert.match(routes, /invalidateOutbound\(req\.tenantId\);/);
  const panel = read('admin/pages/dashboard/tabs/messaging/MessagesHealthPanel.tsx');
  assert.match(panel, /const canSwitch = isAdmin \|\| \['admin', 'manager'\]\.includes/);
  assert.match(read('admin/pages/dashboard/tabs/MessagingHubTab.tsx'), /MessagesHealthPanel/);
});

test('a resend reaches back three days at most and skips what would only die again', () => {
  const routes = read('api/routes/messaging-channels.js');
  assert.match(routes, /Math\.min\(168, Math\.max\(1, Number\.parseInt\(req\.body\?\.hours \|\| '72', 10\)\)\)/);
  assert.ok(routes.includes("'AND created_at > DATE_SUB(NOW(), INTERVAL ? HOUR)'"));
  assert.ok(routes.includes("if (/invalid_number/.test(String(row.last_error || ''))) continue;"));
  assert.ok(routes.includes("if (row.channel === 'whatsapp' && !await isCategoryOpen(row.category, req.tenantId)) continue;"));
  assert.match(routes, /skipped: candidates\.length - ids\.length/);
  // Nothing goes out until the caller has seen the preview and said yes.
  assert.match(routes, /if \(!req\.body\?\.confirm\) \{/);
});

// ── Staff phones ────────────────────────────────────────────────────────────

const subscriptions = [
  { id: 'p-owner', subscription_json: '{"endpoint":"owner"}', is_admin: 1, staff_id: null, role: null, permissions_json: null, tenant_id: null },
  { id: 'p-sales', subscription_json: '{"endpoint":"sales"}', is_admin: 0, staff_id: 's-sales', role: 'sales', permissions_json: null, tenant_id: 'tenant-a' },
  { id: 'p-acct', subscription_json: '{"endpoint":"acct"}', is_admin: 0, staff_id: 's-acct', role: 'accountant', permissions_json: null, tenant_id: 'tenant-a' },
  // An employee since switched off: the join finds no one.
  { id: 'p-gone', subscription_json: '{"endpoint":"gone"}', is_admin: 0, staff_id: null, role: null, permissions_json: null, tenant_id: null },
];

test('a notification reaches the phones of the people its bell is for', async () => {
  db.reset([[/FROM push_subscriptions ps/, [subscriptions]]]);
  pushed.length = 0;
  pushFailure = null;
  const sent = await pushToStaff({ tenantId: 'tenant-a', type: 'payment', title: 'دفعة', message: 'دفعة جديدة' });
  assert.deepEqual(pushed.map(entry => entry.subscription.endpoint).sort(), ['acct', 'owner']);
  assert.equal(sent, 2);
  assert.equal(pushed[0].payload.tag, 'payment');

  pushed.length = 0;
  await pushToStaff({ tenantId: 'tenant-a', type: 'lead', title: 'ليد', message: 'ليد', recipientStaffId: 's-sales' });
  assert.deepEqual(pushed.map(entry => entry.subscription.endpoint), ['sales']);
});

test('a phone that dropped its subscription stops being sent to', async () => {
  db.reset([[/FROM push_subscriptions ps/, [[subscriptions[0]]]]]);
  pushFailure = Object.assign(new Error('gone'), { statusCode: 410 });
  assert.equal(await pushToStaff({ tenantId: 'tenant-a', type: 'system', title: 't', message: 'm' }), 0);
  const update = db.find(/SET last_error=\?, is_active=IF\(\?, 0, is_active\)/);
  assert.deepEqual(update.params.slice(1), [1, 'p-owner', 'tenant-a']);
  pushFailure = null;
});

test('the bell offers the phone, and the server keeps one key pair of its own', () => {
  const notification = read('api/lib/notification.js');
  assert.match(notification, /if \(process\.env\.NODE_ENV === 'production'\) setImmediate\(\(\) => \{/);
  assert.match(notification, /require\('\.\/staffPush'\)\.pushToStaff\(\{ tenantId, type, title, message, recipientStaffId \}\)/);
  const push = read('api/lib/push.js');
  assert.match(push, /privateSealed: seal\(made\.privateKey\)/);
  assert.doesNotMatch(push, /privateKey: made\.privateKey \}/);
  const route = read('api/routes/push.js');
  assert.match(route, /staff_id = VALUES\(staff_id\)/);
  assert.match(route, /is_admin = VALUES\(is_admin\)/);
  assert.match(read('admin/lib/devicePush.ts'), /register\('\/sw-push\.js'\)/);
  const worker = read('admin/public/sw-push.js');
  assert.match(worker, /addEventListener\('push'/);
  assert.match(worker, /addEventListener\('notificationclick'/);
  assert.match(read('admin/pages/dashboard/NotificationsBell.tsx'), /enableDevicePush/);
  assert.match(read('api/migrations/230_v26_staff_push.sql'), /ADD COLUMN IF NOT EXISTS staff_id varchar\(36\) DEFAULT NULL/);
});

// ── Tickets ─────────────────────────────────────────────────────────────────

test('customer service sees the tickets no queue held, and its own once escalated', () => {
  const service = { staffRecord: { id: 'cs-1', role: 'support' } };
  const collector = { staffRecord: { id: 'col-1', role: 'collection' } };
  assert.equal(support.canAccessTicket(service, { department: null }), true);
  assert.equal(support.canAccessTicket(collector, { department: null }), false);
  // Escalated before 1 Oct: moved to management, still a support category.
  assert.equal(support.canAccessTicket(service, { department: 'management', escalated_at: '2026-09-20', category: 'technical' }), true);
  assert.equal(support.canAccessTicket(service, { department: 'management', escalated_at: null, category: 'complaint' }), false);
  assert.equal(support.canAccessTicket(collector, { department: 'management', escalated_at: '2026-09-20', category: 'billing' }), true);

  const scope = support.ticketScope(service);
  assert.match(scope.sql, /OR t\.department IS NULL/);
  assert.match(scope.sql, /OR \(t\.escalated_at IS NOT NULL AND t\.category IN \(/);
  assert.ok(scope.params.includes('technical'));
  assert.doesNotMatch(support.ticketScope(collector).sql, /department IS NULL/);
  assert.equal(support.ticketScope({ staffRecord: { role: 'manager' } }).sql, '1=1');
});

test('a late ticket the sweep escalates keeps its department; «رفع للإدارة» hands it over', () => {
  const routes = read('api/routes/support.js');
  const sweep = routes.slice(routes.indexOf('async function slaSweep'), routes.indexOf('async function autoResolveSweep'));
  assert.match(sweep, /UPDATE support_tickets SET priority='high', escalated_at=NOW\(\), updated_at=NOW\(\)/);
  assert.doesNotMatch(sweep, /department='management'/);
  const manual = routes.slice(routes.indexOf("router.post('/api/admin/tickets/:id/escalate'"));
  assert.match(manual, /SET department='management', priority='high'/);
});

test('a ticket the team answered and the client left for a week is resolved, on its timeline', async () => {
  db.reset([
    [/FROM support_tickets t WHERE t\.deleted_at IS NULL AND t\.status='in_progress'/,
      [[{ id: 'tk-1', tenant_id: 'tenant-a', assigned_to: 'cs-1', subject: 'مش قادر أدخل' }]]],
    [/UPDATE support_tickets SET status='resolved'/, [{ affectedRows: 1 }]],
  ]);
  await support.autoResolveSweep();
  const pick = db.find(/FROM support_tickets t WHERE/);
  assert.deepEqual(pick.params, [7]);
  // The client's word after the team's last reply keeps it open.
  assert.match(pick.sql, /NOT EXISTS \(SELECT 1 FROM ticket_replies tr WHERE .*UPPER\(tr\.author_type\)<>'STAFF'/);
  const update = db.find(/UPDATE support_tickets SET status='resolved'/);
  assert.match(update.sql, /AND status='in_progress'/);
  assert.deepEqual(update.params, ['tk-1', 'tenant-a']);
  const event = db.find(/INSERT INTO ticket_events/);
  assert.ok(event.params.some(value => String(value).includes('اتقفلت تلقائياً')));
});

// ── Leads waiting under the caps ────────────────────────────────────────────

test('waiting leads take the room left under the caps, newest first, by each branch\'s rules', async () => {
  const leads = [
    { id: 'l3', branch: 'online_egypt', source: 'facebook', interested_course_ids_json: '["c1"]', crm_json: null },
    { id: 'l2', branch: null, source: 'site', interested_course_ids_json: null, crm_json: '{"interestedCourseIds":["c2"]}' },
    { id: 'l1', branch: 'ONLINE_EGYPT', source: 'site', interested_course_ids_json: null, crm_json: null },
    { id: 'd1', branch: 'DAQQI', source: 'site', interested_course_ids_json: null, crm_json: null },
  ];
  db.reset([[/SELECT id, branch, source, interested_course_ids_json, crm_json FROM leads/, [leads]]]);
  Object.assign(backlogCalls, { assigned: [], flushed: 0, branches: [] });
  const result = await assignLeadBacklog('tenant-a');
  const pick = db.find(/FROM leads/);
  assert.match(pick.sql, /status='new' AND assigned_sales_id IS NULL/);
  assert.match(pick.sql, /ORDER BY created_at DESC/);
  assert.deepEqual(backlogCalls.branches.sort(), ['DAQQI', 'ONLINE_EGYPT']);
  // Two places left online: the two newest, never a third past the cap.
  assert.deepEqual(backlogCalls.assigned.map(call => call.leadId), ['l3', 'l2']);
  assert.equal(backlogCalls.assigned[0].salesId, 'rep-for-l3');
  assert.equal(backlogCalls.assigned[0].actor, 'التوزيع التلقائي');
  assert.deepEqual(result, { waiting: 4, assigned: 2 });
  assert.equal(backlogCalls.flushed, 2);
});

test('the hourly pass runs in the working day only, and is scheduled', async () => {
  db.reset([[/SELECT DISTINCT tenant_id FROM leads/, [[]]]]);
  await runLeadBacklog(new Date('2026-10-01T02:00:00Z')); // 05:00 in Cairo
  assert.equal(db.calls.length, 0);
  await runLeadBacklog(new Date('2026-10-01T09:00:00Z')); // 12:00 in Cairo
  assert.ok(db.find(/SELECT DISTINCT tenant_id FROM leads/));
  const scheduler = read('api/lib/backgroundScheduler.js');
  assert.match(scheduler, /require\('\.\/leadBacklog'\)\.runLeadBacklog\(\)/);
  assert.match(scheduler, /repeat\(backlog, 60 \* 60 \* 1000\);/);
});

// ── Admin screens ───────────────────────────────────────────────────────────

test('a call or a WhatsApp opened from the clients table opens its log', () => {
  const table = read('admin/pages/dashboard/tabs/online-clients-sections/ClientsTable.tsx');
  assert.match(table, /onClick=\{\(\) => logContact\(row, 'whatsapp'\)\}/);
  assert.match(table, /onCall=\{\(\) => logContact\(row, 'call'\)\}/);
  assert.match(table, /initialType=\{contactType\}/);
  assert.match(read('admin/pages/dashboard/tabs/online-clients-sections/ClientNameCell.tsx'), /href=\{`tel:\$\{row\.phone\}`\} onClick=\{onCall\}/);
  assert.match(read('admin/pages/unified-client/ClientContactLog.tsx'), /\{ type: initialType, date: cairoDateTimeInput\(\)/);
});

test('the owner names who brought a payment, the name rides on that payment only, and a slip of the finger is asked about', () => {
  const attribution = read('admin/lib/paymentAttribution.ts');
  assert.match(attribution, /const value = pending;\s+pending = null;\s+return value;/);
  const api = read('admin/lib/mysqlapi.ts');
  assert.equal(api.split('const staffId = takePaymentAttribution();').length - 1, 2);
  assert.match(api, /staffId && !payment\.staffId \? \{ \.\.\.payment, staffId \} : payment/);
  const modal = read('admin/components/PaymentModal.tsx');
  assert.match(modal, /if \(asksWhoBroughtIt\) attributeNextPayment\(broughtBy\);/);
  assert.match(modal, /attributeNextPayment\(null\);/);
  // A payment past what is left on the course is asked about before it is sent.
  // A course's own money only — a carnet names the course without paying for it (8 Oct 2026).
  assert.match(modal, /const left = d\.paymentType === 'course' && chosen && _effPx > 0 \? Math\.max\(0, _effPx - chosen\.paid\) : null;/);
  assert.match(modal, /if \(!upgrading && left !== null && _amtPaid > left && !await confirmDialog\(\{/);
  assert.ok(modal.indexOf('_amtPaid > left') < modal.indexOf('setSubmitting(true);'));
  // The dialog reads the narrow slices, not the whole site's data.
  assert.doesNotMatch(modal, /useSiteData\(\)/);
  // The server keeps the name it is given only from someone who may approve.
  assert.match(read('api/routes/subscriber-payments.js'), /: \(requestedStaffId \|\| req\.staffRecord\?\.id \|\| null\);/);
});

test('a confirmation says what it confirms, not «delete» by default', () => {
  const dialog = read('shared/ui/confirmDialog.tsx');
  assert.doesNotMatch(dialog, /'تأكيد الحذف'/);
  const panel = read('admin/pages/dashboard/tabs/messaging/MessagesHealthPanel.tsx');
  assert.match(panel, /title: 'إعادة إرسال',/);
  assert.match(panel, /confirmLabel: 'افتحها',/);
});

// ── Schema and search ───────────────────────────────────────────────────────

test('no table in schema.sql names a column or a key twice', () => {
  // `uq_subs_tenant_phone` stood twice on subscribers: MySQL refuses the whole
  // CREATE TABLE («Duplicate key name»), so a fresh database had no clients table.
  const schema = read('api/schema.sql').split('\r\n').join('\n');
  const tick = String.fromCharCode(96);
  const table = new RegExp('CREATE TABLE ' + tick + '([a-z0-9_]+)' + tick + ' \\(\\n([\\s\\S]*?)\\n\\) ENGINE', 'g');
  const column = new RegExp('^\\s*' + tick + '([A-Za-z0-9_]+)' + tick + ' ');
  const key = new RegExp('^\\s*(?:UNIQUE |FULLTEXT )?KEY ' + tick + '([A-Za-z0-9_]+)' + tick);
  const twice = [];
  let match, tables = 0;
  while ((match = table.exec(schema))) {
    tables += 1;
    const seen = new Set();
    for (const line of match[2].split('\n')) {
      const name = (line.match(key) || [])[1] ? `key ${line.match(key)[1]}` : (line.match(column) || [])[1] ? `column ${line.match(column)[1]}` : null;
      if (!name) continue;
      if (seen.has(name)) twice.push(`${match[1]}: ${name}`);
      seen.add(name);
    }
  }
  assert.ok(tables > 100, `read ${tables} tables`);
  assert.deepEqual(twice, []);
});

test('schema.sql has what production has', () => {
  const schema = read('api/schema.sql');
  for (const table of ['community_event_registrations', 'customer_devices', 'incoming_transfers', 'subscriber_requests']) {
    assert.ok(schema.includes('CREATE TABLE `' + table + '` ('), table);
  }
  const push = schema.slice(schema.indexOf('CREATE TABLE `push_subscriptions`'));
  const block = push.slice(0, push.indexOf(') ENGINE'));
  assert.ok(block.includes('`staff_id` varchar(36) DEFAULT NULL'));
  assert.ok(block.includes('`is_admin` tinyint(1) NOT NULL DEFAULT 0'));
  assert.ok(block.includes('KEY `idx_push_tenant_staff` (`tenant_id`,`staff_id`,`is_active`)'));
  assert.ok(schema.includes('`intake_limit`'));
  assert.ok(schema.includes('`linked_transfer_id`'));
});

test('a course page tells a search engine it is a course, with no price and nothing that closes the script', () => {
  const seo = read('tools/generate-seo.mjs');
  assert.match(seo, /'@type': 'Course'/);
  assert.match(seo, /provider: \{ '@type': 'EducationalOrganization'/);
  assert.ok(seo.includes(".replace(/<\\//g, '<\\\\/')"));
  assert.doesNotMatch(seo.slice(seo.indexOf('function courseJsonLd'), seo.indexOf('function render')), /offers|price:/);
  assert.equal(seo.split('jsonLd: courseJsonLd(').length - 1, 2);
});
