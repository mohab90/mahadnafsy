#!/usr/bin/env node
'use strict';
/**
 * Time the screens that read the whole CRM, against a database filled by
 * tools/load-test-seed.cjs. Each route handler runs as it does in production
 * (the real SQL, the real mapping), called directly — no HTTP, no auth — once
 * to warm, then three times; the median is reported with the rows and bytes
 * it answered.
 *
 *   DB_HOST=… DB_USER=… DB_PASSWORD=… DB_NAME=… node tools/load-test-bench.cjs [--tenant tenant-load] [--only leads]
 */
process.env.JWT_SECRET = process.env.JWT_SECRET || 'load-test-bench-secret-0123456789abcdef';
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
const arg = (name, fallback) => { const at = process.argv.indexOf(`--${name}`); return at > 0 ? process.argv[at + 1] : fallback; };
const TENANT = arg('tenant', 'tenant-load');
const ONLY = arg('only', '');

const routers = {
  leads: require('../routes/admin/leads'),
  lists: require('../routes/admin/stafflists'),
  payments: require('../routes/payments'),
  crmTools: require('../routes/crm-tools'),
  dashboard: require('../routes/analytics/dashboard'),
  orders: require('../routes/orders'),
};
const { pool } = require('../lib/db');

const handlerOf = (router, method, path) => {
  const layer = router.stack.find(item => item.route?.path === path && item.route.methods[method]);
  if (!layer) throw new Error(`no route ${method} ${path}`);
  return layer.route.stack.at(-1).handle;
};
async function run(router, path, { query = {}, staff = null }) {
  let body = null; let statusCode = 200;
  const res = {
    statusCode, headers: {}, set(k, v) { this.headers[k] = v; return this; }, setHeader() { return this; },
    status(code) { statusCode = code; return this; }, json(payload) { body = payload; return this; }, send(payload) { body = payload; return this; },
  };
  const req = {
    params: {}, query, body: {}, headers: {}, tenantId: TENANT, user: { uid: staff?.id || 'admin', email: 'bench@load.test' },
    staffRecord: staff, isSuperAdmin: !staff, ip: '127.0.0.1', get: () => undefined,
  };
  const started = process.hrtime.bigint();
  await handlerOf(router, 'get', path)(req, res);
  const ms = Number(process.hrtime.bigint() - started) / 1e6;
  const rows = Array.isArray(body) ? body.length : Array.isArray(body?.rows) ? body.rows.length : Array.isArray(body?.items) ? body.items.length : null;
  return { ms, statusCode, rows, bytes: Buffer.byteLength(JSON.stringify(body ?? null)) };
}

async function main() {
  const [[rep]] = await pool.query("SELECT s.id, s.name, s.role, s.branch_id, COUNT(l.id) AS n FROM staff s JOIN leads l ON l.assigned_sales_id=s.id AND l.tenant_id=s.tenant_id WHERE s.tenant_id=? AND s.role='SALES' GROUP BY s.id ORDER BY n DESC LIMIT 1", [TENANT]);
  const [[collector]] = await pool.query("SELECT id, name, role FROM staff WHERE tenant_id=? AND role='COLLECTION' LIMIT 1", [TENANT]);
  const SALES = { id: rep.id, name: rep.name, role: 'sales', branch_id: rep.branch_id };
  const COLLECTION = { id: collector.id, name: collector.name, role: 'collection' };
  const [[{ leads }]] = await pool.query('SELECT COUNT(*) AS leads FROM leads WHERE tenant_id=?', [TENANT]);
  const [[{ clients }]] = await pool.query('SELECT COUNT(*) AS clients FROM subscribers WHERE tenant_id=?', [TENANT]);
  console.log(`tenant ${TENANT}: ${leads} leads, ${clients} clients; busiest rep holds ${rep.n} leads\n`);

  const cases = [
    ['leads', 'admin leads — first page (500)', routers.leads, '/api/admin/leads', { query: { limit: '500' } }],
    ['leads', 'admin leads — page at 45,000', routers.leads, '/api/admin/leads', { query: { limit: '5000', offset: '45000' } }],
    ['leads', 'admin leads — page at 400,000', routers.leads, '/api/admin/leads', { query: { limit: '5000', offset: '400000' } }],
    ['leads', 'admin leads — search a name', routers.leads, '/api/admin/leads', { query: { limit: '500', q: 'منى حسن' } }],
    ['leads', 'admin leads — search a phone', routers.leads, '/api/admin/leads', { query: { limit: '500', q: '1010012345' } }],
    ['leads', 'admin leads — status filter', routers.leads, '/api/admin/leads', { query: { limit: '500', status: 'interested' } }],
    ['leads', 'lead stats (KPIs)', routers.leads, '/api/admin/leads/stats', {}],
    ['leads', 'CRM insights', routers.leads, '/api/admin/leads/crm-insights', {}],
    ['leads', 'staff lead performance', routers.leads, '/api/admin/leads/staff-performance', {}],
    ['leads', 'scored leads', routers.leads, '/api/admin/leads/scored', { query: { minScore: '60' } }],
    ['leads', 'sales rep — own leads page (2000)', routers.lists, '/api/staff/leads', { query: { limit: '2000' }, staff: SALES }],
    ['clients', 'admin clients — first page (500)', routers.lists, '/api/admin/subscribers', { query: { limit: '500' } }],
    ['clients', 'admin clients — page at 45,000', routers.lists, '/api/admin/subscribers', { query: { limit: '5000', offset: '45000' } }],
    ['clients', 'client count', routers.lists, '/api/admin/subscribers/count', {}],
    ['clients', 'client stats', routers.lists, '/api/admin/subscribers/stats', {}],
    ['clients', 'collection officer — own clients (2000)', routers.lists, '/api/staff/subscribers', { query: { limit: '2000' }, staff: COLLECTION }],
    ['money', 'payments list', routers.payments, '/api/admin/payments', {}],
    ['money', 'outstanding balances', routers.crmTools, '/api/admin/payments/outstanding', {}],
    ['money', 'overview revenue', routers.dashboard, '/api/admin/overview/revenue', {}],
    ['money', 'orders + desk payments review list', routers.orders, '/api/admin/orders', {}],
  ];
  const results = [];
  for (const [group, label, router, path, opts] of cases) {
    if (ONLY && group !== ONLY) continue;
    try {
      await run(router, path, opts);
      const times = [];
      let last;
      for (let i = 0; i < 3; i++) { last = await run(router, path, opts); times.push(last.ms); }
      times.sort((a, b) => a - b);
      results.push({ label, ms: Math.round(times[1]), status: last.statusCode, rows: last.rows, kb: Math.round(last.bytes / 1024) });
    } catch (error) {
      results.push({ label, error: error.message.slice(0, 120) });
    }
    const r = results.at(-1);
    console.log(r.error ? `✗ ${label}: ${r.error}` : `${String(r.ms).padStart(7)} ms  ${String(r.rows ?? '-').padStart(6)} rows  ${String(r.kb).padStart(6)} KB  [${r.status}]  ${label}`);
  }
  if (process.argv.includes('--json')) console.log(JSON.stringify(results));
  await pool.end();
}
main().catch(error => { console.error(error); process.exit(1); });
