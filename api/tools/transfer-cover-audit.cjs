'use strict';
// Transfer-cover audit: READ-ONLY.
//
// 12 Nov 2026, the owner: «في أخطاء بتظهر عند عملاء في الفلوس، خصوصاً في الدفعات الموزعة على أكتر من تحويل». Until migration 387 a payment could be
// confirmed by one transfer only and nothing compared its amount: a 2,000 transfer confirmed a 4,100 payment (the books say 4,100 arrived, the box got 2,000), and a transfer
// in another currency was tied without comparing. This lists, with the client's name, the amounts and the dates, which clients' money is wrong today:
//
//   short     a paid payment whose tied transfers (same currency) add up to less than its amount
//   currency  a payment tied to a transfer in another currency
//   dead      a transfer still tied to a payment that is deleted, refunded or gone (a refunded payment keeps its transfer on purpose: that money went back out;
//             deleted ones are released since the payments are voided through lib/paymentCorrections.js — older rows may predate that)
//
// It only ever sends SELECT / SET SESSION TRANSACTION READ ONLY (the same assertReadOnly as tools/orphan-row-audit.cjs), and it will not start unless the DB_*
// variables are in the environment - it does not read a .env, so it can never pick up a stale or production login by accident.
//
//   DB_HOST=127.0.0.1 DB_PORT=3306 DB_USER=... DB_PASSWORD=... DB_NAME=... node tools/transfer-cover-audit.cjs [--json] [--tenant <id>]
//
// Exit code: 0 = nothing wrong, 1 = rows listed, 2 = could not run.

const { assertReadOnly, requireDbEnv } = require('./orphan-row-audit.cjs');

const LIMIT = 5000;
const PAID = "p.deleted_at IS NULL AND p.status IN ('paid','confirmed')";

function queries(tenant) {
  const scope = tenant ? 'AND p.tenant_id = ?' : '';
  const params = tenant ? [tenant] : [];
  const client = 'LEFT JOIN subscribers s ON s.id = p.subscriber_id AND s.tenant_id = p.tenant_id';
  return {
    short: {
      sql: `SELECT p.tenant_id, p.id AS payment_id, s.name AS client, s.client_code, p.amount, p.currency, p.date, p.payment_method,
                   SUM(t.amount) AS tied, COUNT(*) AS transfers, ROUND(p.amount - SUM(t.amount), 2) AS missing,
                   GROUP_CONCAT(COALESCE(t.reference, t.id) ORDER BY t.created_at SEPARATOR ', ') AS references_list
              FROM payments p
              JOIN incoming_transfers t ON t.tenant_id = p.tenant_id AND t.payment_id = p.id AND t.currency = p.currency
              ${client}
             WHERE ${PAID} ${scope}
             GROUP BY p.tenant_id, p.id, s.name, s.client_code, p.amount, p.currency, p.date, p.payment_method
            HAVING SUM(t.amount) < p.amount - 0.01
             ORDER BY p.date DESC LIMIT ${LIMIT}`,
      params,
    },
    currency: {
      sql: `SELECT p.tenant_id, p.id AS payment_id, s.name AS client, s.client_code, p.amount, p.currency, p.date,
                   t.id AS transfer_id, t.reference, t.method, t.amount AS transfer_amount, t.currency AS transfer_currency, t.received_on
              FROM payments p
              JOIN incoming_transfers t ON t.tenant_id = p.tenant_id AND t.payment_id = p.id AND t.currency <> p.currency
              ${client}
             WHERE p.deleted_at IS NULL ${scope}
             ORDER BY p.date DESC LIMIT ${LIMIT}`,
      params,
    },
    dead: {
      sql: `SELECT t.tenant_id, t.id AS transfer_id, t.reference, t.method, t.amount AS transfer_amount, t.currency AS transfer_currency, t.received_on,
                   t.payment_id, p.amount, p.currency, p.date, s.name AS client, s.client_code,
                   CASE WHEN p.id IS NULL THEN 'missing' WHEN p.deleted_at IS NOT NULL THEN 'deleted' ELSE p.status END AS payment_state
              FROM incoming_transfers t
              LEFT JOIN payments p ON p.id = t.payment_id AND p.tenant_id = t.tenant_id
              LEFT JOIN subscribers s ON s.id = p.subscriber_id AND s.tenant_id = t.tenant_id
             WHERE t.payment_id IS NOT NULL ${tenant ? 'AND t.tenant_id = ?' : ''}
               AND (p.id IS NULL OR p.deleted_at IS NOT NULL OR p.status = 'refunded')
             ORDER BY t.received_on DESC LIMIT ${LIMIT}`,
      params,
    },
  };
}

function summarize(found) {
  const byCurrency = {};
  for (const row of found.short) {
    const key = row.currency || 'EGP';
    byCurrency[key] = Math.round(((byCurrency[key] || 0) + Number(row.missing)) * 100) / 100;
  }
  return {
    short_payments: found.short.length,
    missing_by_currency: byCurrency,
    currency_mismatches: found.currency.length,
    transfers_on_dead_payments: found.dead.length,
  };
}

function parseArgs(argv) {
  const out = { json: false, tenant: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--json') out.json = true;
    else if (argv[i] === '--tenant') out.tenant = String(argv[++i] || '');
    else throw new Error(`unknown argument: ${argv[i]}`);
  }
  return out;
}

const day = value => (value instanceof Date ? value.toISOString().slice(0, 10) : String(value || '').slice(0, 10));

async function main() {
  const args = parseArgs(process.argv.slice(2));
  let conf;
  try { conf = requireDbEnv(process.env); } catch (e) { console.error(e.message); return 2; }
  const mysql = require('mysql2/promise');
  const conn = await mysql.createConnection({ ...conf, connectTimeout: 20000 });
  const found = { short: [], currency: [], dead: [] };
  try {
    await conn.query(assertReadOnly('SET SESSION TRANSACTION READ ONLY'));
    console.error(`[transfer-cover-audit] ${conf.user}@${conf.host}:${conf.port}/${conf.database} - SELECT only`);
    const all = queries(args.tenant);
    for (const key of Object.keys(all)) {
      const [rows] = await conn.query(assertReadOnly(all[key].sql), all[key].params);
      found[key] = rows;
    }
  } finally {
    await conn.end().catch(() => {});
  }
  const summary = summarize(found);
  if (args.json) {
    console.log(JSON.stringify({ summary, ...found }, null, 2));
  } else {
    console.log('== short: paid payments whose transfers add up to less than the payment ==');
    for (const r of found.short) {
      console.log(`${day(r.date)}  ${r.client || '-'} ${r.client_code ? `(${r.client_code})` : ''}  payment ${r.payment_id}  ${r.amount} ${r.currency}  transfers ${r.tied} (${r.transfers}: ${r.references_list})  missing ${r.missing}`);
    }
    console.log('\n== currency: payments tied to a transfer in another currency ==');
    for (const r of found.currency) {
      console.log(`${day(r.date)}  ${r.client || '-'}  payment ${r.payment_id}  ${r.amount} ${r.currency}  <-  transfer ${r.reference || r.transfer_id} ${r.transfer_amount} ${r.transfer_currency} (${r.method}, ${day(r.received_on)})`);
    }
    console.log('\n== dead: transfers still tied to a deleted, refunded or missing payment ==');
    for (const r of found.dead) {
      console.log(`${day(r.received_on)}  transfer ${r.reference || r.transfer_id} ${r.transfer_amount} ${r.transfer_currency} (${r.method})  ->  payment ${r.payment_id} [${r.payment_state}] ${r.client || '-'} ${r.amount ?? ''} ${r.currency || ''} ${day(r.date)}`);
    }
    console.log('\n' + JSON.stringify(summary));
  }
  return found.short.length + found.currency.length + found.dead.length > 0 ? 1 : 0;
}

module.exports = { queries, summarize, parseArgs };

if (require.main === module) {
  main().then(code => process.exit(code), (e) => { console.error('[transfer-cover-audit] failed:', e.message); process.exit(2); });
}
