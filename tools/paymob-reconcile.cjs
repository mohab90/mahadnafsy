// Every transaction Paymob has, against every payment we have.
//
// The worry is one-directional and specific: a customer paid, Paymob took the
// money, and our webhook never landed — so the sale exists at the provider and
// nowhere in our books. Read-only on both sides.
// Usage on the server:  cd /var/www/mahad-api && node tools/paymob-reconcile.cjs
require('dotenv').config({ path: process.env.MAHAD_ENV || '/var/www/mahad-api/.env' });
const mysql = require('mysql2/promise');

(async () => {
  const c = await mysql.createConnection({
    host: process.env.DB_HOST, user: process.env.DB_USER,
    password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  });
  const [[row]] = await c.query(
    "SELECT config_json FROM tenant_settings WHERE section='sys_payment_gateway' LIMIT 1");
  const paymob = JSON.parse(row.config_json).paymob;

  // The Accept API needs a session token from the legacy api_key.
  const auth = await fetch('https://accept.paymob.com/api/auth/tokens', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: paymob.api_key }),
  }).then(r => r.json());
  if (!auth.token) { console.error('could not authenticate with Paymob'); process.exit(1); }

  const res = await fetch('https://accept.paymob.com/api/acceptance/transactions?page_size=200', {
    headers: { Authorization: `Bearer ${auth.token}` },
  });
  const body = await res.json().catch(() => null);
  const list = body?.results || body?.data || [];
  console.log('transactions Paymob reports:', list.length, '(HTTP', res.status + ')');

  const successful = list.filter(t => t.success && !t.is_refunded && !t.is_voided);
  console.log('of those, successful and not refunded:', successful.length);

  const [ours] = await c.query(
    "SELECT transaction_id, amount_egp, date FROM payments WHERE transaction_id IS NOT NULL AND deleted_at IS NULL");
  const known = new Set(ours.map(p => String(p.transaction_id)));

  const missing = successful.filter(t => !known.has(String(t.id)));
  console.log('\n=== successful at Paymob but NOT in our books ===');
  if (!missing.length) console.log('  none — every collected transaction is recorded');
  for (const t of missing) {
    console.log(`  txn ${t.id} · ${(t.amount_cents / 100).toFixed(2)} ${t.currency || 'EGP'} · ${t.created_at}` +
      ` · order ${t.order?.merchant_order_id || t.order?.id || '?'}`);
  }

  console.log('\n=== in our books ===');
  console.log('  payments carrying a transaction id:', ours.length);
  ours.forEach(p => console.log(`  txn ${p.transaction_id} · ${p.amount_egp} EGP · ${String(p.date).slice(0, 10)}`));
  await c.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });

// Also worth watching: payments carrying obviously synthetic transaction ids
// (LOAD-TXN, QA-TXN, UAT-TXN). Those are load-test and UAT leftovers sitting in
// the live books as if they were revenue.
