'use strict';
/**
 * «اتاكد ان مفيش مشكله لما بنرفع حجز عميل دولي او سعودي» (10 Oct 2026). A riyal
 * or dollar payment needs a rate younger than FX_MAX_AGE_HOURS; with an old one
 * every Saudi and international booking answered «Internal server error». The
 * payment now fetches today's rate itself, and says why when it cannot.
 * Real MariaDB; the rate provider is a stub.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
const skip = !ENABLED && 'no DB_* configured';
const TENANT = 'tenant-fxbooking-it';
let pool; let payments; let settings; let finance;
const realFetch = global.fetch;
let providerUp = false;

async function record(id) {
  const layer = payments.stack.find(item => item.route?.path === '/api/admin/subscriber-payments' && item.route.methods.post);
  const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(payload) { this.body = payload; return this; }, set() { return this; } };
  const req = {
    params: {}, query: {}, headers: {}, tenantId: TENANT, user: { uid: 'u', email: 'boss@example.test' }, staffRecord: null, isSuperAdmin: true, ip: '1', get: () => undefined,
    body: { subscriber_id: 'sub-fx-1', payment: { id, amount: 100, currency: 'SAR', paymentType: 'course', courseId: 'co-fx-1', paymentMethod: 'كاش', status: 'paid' } },
  };
  for (const handle of layer.route.stack.map(entry => entry.handle).filter(fn => !['requireAuth', 'requireAdminOrStaff'].includes(fn.name))) {
    let advanced = false;
    await handle(req, res, () => { advanced = true; });
    if (!advanced) break;
  }
  return res;
}

async function staleRates() {
  await settings.setTenantSetting('content', {
    'exchange.sar_to_egp': '12', 'exchange.usd_to_egp': '45', 'exchange.source': 'open.er-api.com',
    'exchange.updated_at': new Date(Date.now() - 5 * 86400000).toISOString(),
  }, { tenantId: TENANT });
  finance.invalidateFxCache(TENANT);
}

async function clean() {
  await pool.query('DELETE FROM journal_entry_lines WHERE entry_id IN (SELECT id FROM journal_entries WHERE tenant_id=?)', [TENANT]).catch(() => {});
  for (const table of ['journal_entries', 'payment_audit_log', 'financial_audit_log', 'crm_commissions', 'instructor_fees', 'financial_documents',
    'entitlement_events', 'enrollments', 'payments', 'subscribers', 'courses', 'tenant_settings', 'outbox']) {
    await pool.query(`DELETE FROM ${table} WHERE tenant_id=?`, [TENANT]).catch(() => {});
  }
}

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  settings = require('../../lib/tenantSettings');
  finance = require('../../lib/finance');
  payments = require('../../routes/subscriber-payments');
  await clean();
  await pool.query("INSERT IGNORE INTO tenants (id, slug, name, status) VALUES (?, ?, 'IT', 'active')", [TENANT, TENANT]);
  await pool.query(
    `INSERT INTO courses (id, tenant_id, title, description, short_description, instructor, thumbnail, category, type, price_egp)
     VALUES ('co-fx-1', ?, 'كورس', '', '', '', '', 'GENERAL', 'RECORDED', 3000)`, [TENANT]);
  await pool.query("INSERT INTO subscribers (id, tenant_id, name, phone, branch) VALUES ('sub-fx-1', ?, 'عميل سعودي', '966501234567', 'ONLINE_SAUDI')", [TENANT]);
  global.fetch = async url => {
    if (!String(url).includes('open.er-api.com')) return realFetch(url);
    if (!providerUp) throw new Error('fetch failed');
    return { ok: true, json: async () => ({ rates: { SAR: 0.0769, USD: 0.0205 } }) };
  };
});
after(async () => {
  global.fetch = realFetch;
  if (!ENABLED) return;
  await clean();
  await pool.end();
});

test('a stale rate and no provider: the desk is told why, nothing is written', { skip }, async () => {
  await staleRates();
  const res = await record('pay-fx-1');
  assert.equal(res.statusCode, 409, JSON.stringify(res.body));
  assert.equal(res.body.code, 'FX_STALE');
  assert.match(res.body.error, /سعر الريال/);
  const [rows] = await pool.query('SELECT id FROM payments WHERE tenant_id=?', [TENANT]);
  assert.equal(rows.length, 0);
});

test('a stale rate and the provider up: today\'s rate is fetched and the booking goes through', { skip }, async () => {
  await staleRates();
  providerUp = true;
  // The failure above is not retried for five minutes.
  require('../../lib/fxRefresh').resetFxBackoff();
  const res = await record('pay-fx-2');
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const content = await settings.getTenantSetting('content', { tenantId: TENANT, fallback: {} });
  assert.equal(content['exchange.sar_to_egp'], String(Number((1 / 0.0769).toFixed(4))));
  assert.ok(Date.now() - new Date(content['exchange.updated_at']).getTime() < 60000);
  const [[journal]] = await pool.query(
    `SELECT SUM(jel.debit) AS egp FROM journal_entries je JOIN journal_entry_lines jel ON jel.entry_id=je.id
      WHERE je.tenant_id=? AND jel.account_code='1100'`, [TENANT]);
  assert.equal(Number(journal.egp), Number((100 * Number((1 / 0.0769).toFixed(4))).toFixed(2)));
});

test('rates typed by hand in the settings are dated when saved', () => {
  const { stampManualRates } = require('../../lib/fxRefresh');
  const before = { 'exchange.sar_to_egp': '12', 'exchange.updated_at': '2026-01-01T00:00:00.000Z' };
  const after = stampManualRates(before, { ...before, 'exchange.sar_to_egp': '13.1' });
  assert.equal(after['exchange.source'], 'manual');
  assert.ok(Date.now() - new Date(after['exchange.updated_at']).getTime() < 60000);
  assert.equal(stampManualRates(before, { ...before, other: 'x' })['exchange.updated_at'], before['exchange.updated_at'], 'other edits leave the date');
});
