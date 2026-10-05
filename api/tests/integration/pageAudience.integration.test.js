'use strict';
/**
 * Reaching the page's customers again (lib/pageAudience.js): the history import
 * against a stand-in Graph API, numbers picked out of chats, and a message to
 * everyone whose window is open. Real MariaDB; runs only with DB_*.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
const skip = !ENABLED && 'no DB_* configured';
const TENANT = 'tenant-pageaud-it';
const PAGE = 'page-777';
let pool; let audience;
const credentials = { pageId: PAGE, pageAccessToken: 'tok' };

async function clean() {
  for (const table of ['communications', 'inbox_threads', 'leads', 'notifications']) {
    await pool.query(`DELETE FROM ${table} WHERE tenant_id=?`, [TENANT]).catch(() => {});
  }
}

const graph = pages => {
  let call = 0;
  return async url => {
    // The first page is asked for by page id; later ones follow Meta's paging.next as given.
    if (call === 0) assert.match(String(url), new RegExp(`/${PAGE}/conversations\\?platform=messenger`));
    const body = pages[call++];
    return { ok: true, status: 200, json: async () => body };
  };
};
const ago = hours => new Date(Date.now() - hours * 3600000).toISOString();

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  audience = require('../../lib/pageAudience');
  await clean();
});
after(async () => {
  if (!ENABLED) return;
  await clean();
  await pool.end();
});

test('past conversations become leads with their messages, a name and the number they wrote', { skip }, async () => {
  const fetch = graph([
    { data: [{
      participants: { data: [{ id: PAGE, name: 'المعهد' }, { id: 'psid-1', name: 'منى سامي' }] },
      messages: { data: [
        { id: 'm3', message: 'تمام، رقمي 01011112222', from: { id: 'psid-1' }, created_time: ago(30) },
        { id: 'm2', message: 'أهلاً بحضرتك، السعر 3000', from: { id: PAGE }, created_time: ago(40) },
        { id: 'm1', message: 'سعر الدبلومة كام؟', from: { id: 'psid-1' }, created_time: ago(50) },
      ] },
    }], paging: { next: 'https://graph.facebook.com/next' } },
    { data: [{
      participants: { data: [{ id: 'psid-2', name: 'Karim' }, { id: PAGE }] },
      messages: { data: [{ id: 'm4', message: 'مواعيد الكورس؟', from: { id: 'psid-2' }, created_time: ago(2) }] },
    }] },
  ]);
  const stats = await audience.importPageHistory({ tenantId: TENANT, platform: 'messenger' }, { fetch, credentials });
  assert.deepEqual(stats, { conversations: 2, newLeads: 2, messages: 4, phones: 1 });
  const [[mona]] = await pool.query("SELECT name, phone, source FROM leads WHERE tenant_id=? AND messenger_psid='psid-1'", [TENANT]);
  assert.deepEqual([mona.name, mona.phone, mona.source], ['منى سامي', '201011112222', 'messenger_inbound']);
  const [[thread]] = await pool.query("SELECT last_direction, unread_count FROM inbox_threads WHERE tenant_id=? AND contact_key='psid-1'", [TENANT]);
  assert.deepEqual([thread.last_direction, thread.unread_count], ['IN', 0]);
  const [[notified]] = await pool.query('SELECT COUNT(*) AS n FROM notifications WHERE tenant_id=?', [TENANT]);
  assert.equal(Number(notified.n), 0);

  const again = await audience.importPageHistory({ tenantId: TENANT, platform: 'messenger' }, { fetch: graph([{ data: [] }]), credentials });
  assert.equal(again.newLeads, 0);
});

test('the summary counts who wrote, who left a number, and whose window is open', { skip }, async () => {
  const summary = await audience.audienceSummary(TENANT);
  assert.deepEqual([summary.messenger.contacts, summary.messenger.withPhone, summary.messenger.windowOpen], [2, 1, 1]);
});

test('numbers in older chats are found and put on the lead', { skip }, async () => {
  const [[karim]] = await pool.query("SELECT id FROM leads WHERE tenant_id=? AND messenger_psid='psid-2'", [TENANT]);
  await pool.query(
    `INSERT INTO communications (id, tenant_id, lead_id, type, direction, date, notes, created_at)
     VALUES (UUID(), ?, ?, 'MESSENGER', 'IN', NOW(), 'كلمني واتس +966 55 000 1122', NOW())`, [TENANT, karim.id]);
  assert.deepEqual(await audience.backfillPhones(TENANT), { scanned: 2, found: 1 });
  const [[row]] = await pool.query('SELECT phone FROM leads WHERE id=?', [karim.id]);
  assert.equal(row.phone, '966550001122');
});

test('a message reaches only the people whose window is open, by name', { skip }, async () => {
  const sent = [];
  const result = await audience.messageOpenWindow(
    { tenantId: TENANT, platform: 'messenger', text: 'أهلاً {name}، الدفعة الجديدة السبت!' },
    { credentials, noPause: true, send: async (psid, text) => { sent.push([psid, text]); return { ok: true, idMessage: `mid.${sent.length}` }; } });
  assert.deepEqual(result, { audience: 1, sent: 1, failed: 0 });
  assert.deepEqual(sent, [['psid-2', 'أهلاً Karim، الدفعة الجديدة السبت!']]);
  const [[row]] = await pool.query("SELECT outcome FROM communications WHERE tenant_id=? AND direction='OUT' AND notes LIKE 'أهلاً Karim%'", [TENANT]);
  assert.equal(row.outcome, 'BROADCAST');
});
