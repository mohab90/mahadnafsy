'use strict';
/**
 * A lead's status and its merge, as they behave on a real MariaDB (these were regular expressions over lib/leadState.js, lib/leadMerge.js and the migration):
 * a status change and its timeline row are one transaction; the same status twice is no change and no row; an unknown status or another institute's lead
 * is refused; a merge moves the sources' relations to the target, hides the sources, writes the audit and the timeline row, leaves another institute's
 * leads out, and an unmerge puts everything back. Runs only with DB_* (or TEST_DB_*).
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
const skip = !ENABLED && 'no DB_* configured';
const T = 'tenant-leadstate-it'; const OTHER = 'tenant-leadstate-other';
let pool;

async function clean() {
  for (const tenant of [T, OTHER]) {
    for (const table of ['lead_merge_audit', 'lead_timeline', 'tasks', 'communications', 'leads']) await pool.query(`DELETE FROM ${table} WHERE tenant_id=?`, [tenant]).catch(() => {});
  }
}
const lead = (id, tenant, extra = {}) => pool.query(
  'INSERT INTO leads (id, tenant_id, name, phone, email, source, status, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  [id, tenant, extra.name || id, extra.phone ?? null, extra.email ?? null, 'test', extra.status || 'new', extra.notes || null]);
const row = async id => (await pool.query('SELECT status, hidden, merged_into_lead_id, phone FROM leads WHERE id=?', [id]))[0][0];
const timeline = async id => (await pool.query('SELECT event_type FROM lead_timeline WHERE tenant_id=? AND lead_id=? ORDER BY at, id', [T, id]))[0].map(item => item.event_type);

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  await clean();
  await pool.query("INSERT IGNORE INTO tenants (id, slug, name, status) VALUES (?, ?, 'IT', 'active'), (?, ?, 'IT2', 'active')", [T, T, OTHER, OTHER]);
});
after(async () => {
  if (!ENABLED) return;
  await clean();
  await pool.end();
});

test('a status change and its timeline row are written together; the same status again changes nothing', { skip }, async () => {
  const { transitionLead } = require('../../lib/leadState');
  await lead('ld-ls-1', T);
  const first = await transitionLead({ tenantId: T, leadId: 'ld-ls-1', toStatus: 'interested', actor: 'rep' });
  assert.equal(first.changed, true);
  assert.equal((await row('ld-ls-1')).status, 'interested');
  assert.equal((await timeline('ld-ls-1')).length, 1, 'one timeline row for the one change');
  const again = await transitionLead({ tenantId: T, leadId: 'ld-ls-1', toStatus: ' Interested ', actor: 'rep' });
  assert.equal(again.changed, false);
  assert.equal((await timeline('ld-ls-1')).length, 1, 'and none for the no-change');
});

test('an unknown status, a missing lead and another institute\'s lead are refused and change nothing', { skip }, async () => {
  const { transitionLead } = require('../../lib/leadState');
  await lead('ld-ls-2', T); await lead('ld-ls-foreign', OTHER);
  await assert.rejects(transitionLead({ tenantId: T, leadId: 'ld-ls-2', toStatus: 'sql-status' }), /Invalid lead status/);
  await assert.rejects(transitionLead({ tenantId: T, leadId: 'ld-ls-missing', toStatus: 'interested' }), /Lead not found/);
  await assert.rejects(transitionLead({ tenantId: T, leadId: 'ld-ls-foreign', toStatus: 'interested' }), /Lead not found/);
  assert.equal((await row('ld-ls-2')).status, 'new');
  assert.equal((await row('ld-ls-foreign')).status, 'new', 'the other institute\'s lead is untouched');
  assert.deepEqual(await timeline('ld-ls-2'), []);
});

test('a merge moves the relations to the target, hides the sources and can be reversed', { skip }, async () => {
  const { mergeLeads, unmergeLead } = require('../../lib/leadMerge');
  await lead('ld-m-target', T, { phone: '01010000001', notes: 'الأصل' });
  await lead('ld-m-source', T, { phone: '01010000002', notes: 'المكرر' });
  await lead('ld-m-foreign', OTHER);
  await pool.query("INSERT INTO tasks (id, tenant_id, title, related_lead_id) VALUES ('tk-m-1', ?, 'اتصال', 'ld-m-source')", [T]);

  await assert.rejects(mergeLeads({ tenantId: T, targetId: 'ld-m-target', sourceIds: ['ld-m-foreign'] }), /do not belong to this tenant/);
  assert.equal((await row('ld-m-foreign')).hidden, 0, 'another institute\'s lead is never merged');

  const done = await mergeLeads({ tenantId: T, targetId: 'ld-m-target', sourceIds: ['ld-m-source'], actor: 'boss' });
  assert.equal(done.merged, 1);
  const source = await row('ld-m-source');
  assert.deepEqual([Number(source.hidden), source.merged_into_lead_id, source.phone], [1, 'ld-m-target', null], 'hidden, pointing at the target, its phone given up');
  assert.equal((await pool.query("SELECT related_lead_id FROM tasks WHERE id='tk-m-1'"))[0][0].related_lead_id, 'ld-m-target', 'the task follows the target');
  const [[audit]] = await pool.query("SELECT actor, reverted_at FROM lead_merge_audit WHERE tenant_id=? AND source_lead_id='ld-m-source'", [T]);
  assert.deepEqual([audit.actor, audit.reverted_at], ['boss', null]);
  assert.ok((await timeline('ld-m-target')).includes('merged'));
  assert.match((await pool.query("SELECT notes FROM leads WHERE id='ld-m-target'"))[0][0].notes, /الأصل[\s\S]*المكرر/, 'both notes are kept');

  const undone = await unmergeLead({ tenantId: T, sourceId: 'ld-m-source', actor: 'boss' });
  assert.equal(undone.reverted, true);
  const back = await row('ld-m-source');
  assert.deepEqual([Number(back.hidden), back.merged_into_lead_id, back.phone], [0, null, '01010000002'], 'visible again with its phone');
  assert.equal((await pool.query("SELECT related_lead_id FROM tasks WHERE id='tk-m-1'"))[0][0].related_lead_id, 'ld-m-source', 'and its task');
  await assert.rejects(unmergeLead({ tenantId: T, sourceId: 'ld-m-source' }), /Active merge audit not found/, 'a merge is reversed once');
});
