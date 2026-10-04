'use strict';
/**
 * The linked-sheet lead sync (lib/sheets.js) against a real MariaDB, with the
 * sheet served from memory: a multi-line answer no longer breaks the rows after
 * it, rows older than the window are left for a person to decide on, a lead
 * already in the CRM is reported by where it stands and never imported twice.
 * Runs only with DB_* (or TEST_DB_*).
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
const skip = !ENABLED && 'no DB_* configured';
const TENANT = 'tenant-sheets-it';
let pool, sheets;

const iso = daysAgo => new Date(Date.now() - daysAgo * 86400000).toISOString().replace(/\.\d{3}Z$/, '+0000');
const CSV = [
  'id,created_time,full_name,phone_number,رسالة',
  // A free-text answer with a line break and an escaped quote in it. The old
  // reader split it into two rows and lost the row after it.
  `l:1,${iso(1)},منى سعيد,p:+201012000003,"عندي سؤال
عن مواعيد ""الدبلومة"""`,
  `l:2,${iso(2)},Ali Hassan,01012000004,`,
  `l:3,${iso(3)},مؤرشف,01012000001,`,
  `l:4,${iso(3)},محذوف,01012000002,`,
  `l:5,${iso(40)},قديم,01012000005,`,
].join('\n');
// The second, unticked sheet is empty: the sync tests count the first one's rows.
const fetchCsv = async url => (url.includes('B'.repeat(30)) ? 'name,phone\n' : CSV);

async function clean() {
  for (const table of ['lead_timeline', 'lead_interactions', 'communications', 'leads', 'tenant_settings']) {
    await pool.query(`DELETE FROM ${table} WHERE tenant_id=?`, [TENANT]).catch(() => {});
  }
}

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  sheets = require('../../lib/sheets');
  await clean();
  // Suspended, so the scheduled jobs that walk active tenants leave it alone.
  await pool.query("INSERT IGNORE INTO tenants (id, slug, name, status) VALUES (?, ?, 'Sheets IT', 'suspended')", [TENANT, TENANT]);
  const { setTenantSetting } = require('../../lib/tenantSettings');
  await setTenantSetting('crm_settings', {
    autoAssign: 'none', sheets: [
      { sheetId: 'A'.repeat(30), gid: '1', name: 'فيسبوك' },
      // Not ticked: the timers skip it, a report or a manual sync still reads it.
      { sheetId: 'B'.repeat(30), gid: '2', name: 'شيت مش متعلم', autoSync: false },
    ],
  }, { tenantId: TENANT });
  await pool.query(
    `INSERT INTO leads (id, tenant_id, name, phone, source, status, hidden, created_at) VALUES
       ('sh-it-archived', ?, 'مؤرشف', '1012000001', 'فيسبوك', 'archived', 0, NOW()),
       ('sh-it-hidden', ?, 'محذوف', '1012000002', 'فيسبوك', 'new', 1, NOW())`, [TENANT, TENANT]);
});
after(async () => {
  if (!ENABLED) return;
  await clean();
  await pool.query('DELETE FROM tenants WHERE id=?', [TENANT]).catch(() => {});
  await pool.end();
});

test('a report says what is missing and where the rest are, and writes nothing', { skip }, async () => {
  const report = await sheets.syncAllConfiguredSheets(TENANT, { windowDays: 14, dryRun: true, fetchCsv });
  const [tab] = report.sheets;
  assert.equal(tab.rows, 5, 'five rows — the line break inside an answer is not a row');
  assert.equal(tab.outsideWindow, 1);
  assert.equal(tab.imported, 2);
  assert.deepEqual(tab.importedRows.map(r => r.phone).sort(), ['1012000003', '1012000004']);
  assert.equal(tab.existing.archived, 1);
  assert.equal(tab.existing.hidden, 1);
  const [[{ n }]] = await pool.query("SELECT COUNT(*) n FROM leads WHERE tenant_id=? AND id LIKE 'lead-gs-%'", [TENANT]);
  assert.equal(Number(n), 0);
});

test('the sync imports the missing recent rows once, with the multi-line answer intact', { skip }, async () => {
  const first = await sheets.syncAllConfiguredSheets(TENANT, { fetchCsv });
  assert.equal(first.imported, 2);
  assert.equal(first.outsideWindow, 1, 'the 40-day-old row waits for a person, it is not a new lead tonight');
  const [rows] = await pool.query(
    "SELECT name, phone, notes FROM leads WHERE tenant_id=? AND id LIKE 'lead-gs-%' ORDER BY phone", [TENANT]);
  assert.deepEqual(rows.map(r => [r.name, r.phone]), [['منى سعيد', '1012000003'], ['Ali Hassan', '1012000004']]);
  assert.match(rows[0].notes, /عندي سؤال\nعن مواعيد "الدبلومة"/);
  const again = await sheets.syncAllConfiguredSheets(TENANT, { fetchCsv });
  assert.equal(again.imported, 0, 'nothing twice');
  // The deleted lead is not brought back.
  const [[hidden]] = await pool.query("SELECT COUNT(*) n FROM leads WHERE tenant_id=? AND phone='1012000002'", [TENANT]);
  assert.equal(Number(hidden.n), 1);
});

test('the timers read only the ticked sheets; --sheet picks one by name or gid', { skip }, async () => {
  const names = report => report.sheets.map(sheet => sheet.name);
  const all = await sheets.syncAllConfiguredSheets(TENANT, { dryRun: true, fetchCsv });
  assert.deepEqual(names(all), ['فيسبوك', 'شيت مش متعلم']);
  assert.deepEqual(names(await sheets.syncAllConfiguredSheets(TENANT, { dryRun: true, autoOnly: true, fetchCsv })), ['فيسبوك']);
  assert.deepEqual(names(await sheets.syncAllConfiguredSheets(TENANT, { dryRun: true, only: 'مش متعلم', fetchCsv })), ['شيت مش متعلم']);
  assert.deepEqual(names(await sheets.syncAllConfiguredSheets(TENANT, { dryRun: true, only: '1', fetchCsv })).includes('فيسبوك'), true);
});

test('dates: ISO is exact, an unambiguous slashed date is read, an ambiguous one is not guessed', () => {
  const { rowDate } = require('../../lib/sheets');
  assert.equal(rowDate('2026-09-25T10:12:33+0300').toISOString(), '2026-09-25T07:12:33.000Z');
  assert.equal(rowDate('25/9/2026').getDate(), 25);
  assert.equal(rowDate('9/25/2026').getDate(), 25);
  assert.equal(rowDate('3/9/2026'), null);
  assert.equal(rowDate(''), null);
});
