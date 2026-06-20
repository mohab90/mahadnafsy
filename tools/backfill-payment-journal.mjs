#!/usr/bin/env node
// One-time historical ledger backfill (Top20 #13 follow-up).
// Posts a double-entry journal for every PAID payment that doesn't already have
// one (ref_type='payment'), so /api/admin/reconcile-ledger balances. Reuses the
// app's postPaymentJournal so amounts/accounts/FX match live behaviour exactly.
// Idempotent + resilient: re-run safely; skips already-journaled payments and
// tolerates a flaky tunnel (errors per-payment are logged, loop continues).
//
// Usage: node tools/backfill-payment-journal.mjs [--dry-run] [--limit N]
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const apiRequire = createRequire(join(ROOT, 'api', 'package.json'));
// Load .env into process.env the way the app does, then load app libs.
apiRequire('dotenv').config({ path: join(ROOT, 'api', '.env') });
const { pool } = apiRequire('./lib/db');
const { postPaymentJournal } = apiRequire('./lib/finance');

const DRY = process.argv.includes('--dry-run');
const LIMIT = (() => { const i = process.argv.indexOf('--limit'); return i > -1 ? +process.argv[i + 1] : 100000; })();

const [rows] = await pool.query(
  `SELECT p.id, p.amount, p.currency, p.payment_type, p.date
   FROM payments p
   WHERE p.status='paid'
     AND NOT EXISTS (SELECT 1 FROM journal_entries je WHERE je.ref_type='payment' AND je.ref_id=p.id)
   ORDER BY p.date ASC
   LIMIT ?`, [LIMIT]
);
console.log(`${DRY ? '[dry-run] ' : ''}payments needing a journal entry: ${rows.length}`);

let ok = 0, fail = 0;
for (const p of rows) {
  if (DRY) continue;
  try {
    await postPaymentJournal({
      paymentId: p.id, amount: p.amount, currency: p.currency || 'EGP',
      payType: p.payment_type, date: (() => { const d = new Date(p.date); return isNaN(d) ? new Date().toISOString().slice(0, 10) : d.toISOString().slice(0, 10); })(),
      actor: 'journal-backfill',
    });
    ok++;
    if (ok % 25 === 0) process.stdout.write(`\r  posted ${ok}/${rows.length}   `);
  } catch (e) { fail++; process.stdout.write(`\n  fail ${p.id}: ${e.message}\n`); }
}
process.stdout.write('\n');
console.log(`Done — posted ${ok}, failed ${fail} (re-run to retry failures).`);
await pool.end();
