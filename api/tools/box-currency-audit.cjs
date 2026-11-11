'use strict';
// Cash-box audit: READ-ONLY. «مش بيظهر كل الخزن المضافة» / «فودافون كاش مصري ظاهر فيه بالريال».
//
// It prints, for one tenant, what the boxes screen is built from, so the owner (or whoever runs it on the server) can tell whether a box that looks wrong is wrong in
// the CODE (already fixed) or in the DATA (a payment, an expense or a stored balance saved under the wrong currency or name):
//
//   1. the settings list (الإعدادات ← وسائل الدفع) with the box and the currency each name is read as;
//   2. every (payment_method, currency) pair that has paid payments: how many, how much, and the box the screen counts it in;
//   3. the same for expenses taken from a box (box_method), withdrawals and stored opening balances;
//   4. FLAGS, one line each:
//        CURRENCY_MISMATCH  money typed on a box whose name says another currency (e.g. riyals on «فودافون كاش 4645»): the screen counts it on a box of ITS currency, so the
//                           Egyptian wallet no longer shows riyals — but the payment itself was saved in the wrong currency and should be looked at;
//        UNLISTED           money in a name that is not in the settings list: counted under «أخرى»;
//        NO_BOX_FOR_CURRENCY money in a currency the list has no box for;
//        STORED_UNLISTED    an opening/reset row (box_balances) under a name the list does not know.
//
// What confirms each hypothesis:
//   - «فودافون كاش مصري ظاهر بالريال» is DATA when section 2 has a row like  method=«فودافون كاش …» currency=SAR  (flag CURRENCY_MISMATCH): a payment was saved with SAR on an
//     Egyptian wallet's name. It is CODE (fixed) when no such row exists and the wallet only shows in SAR on the screen because the box above it is named alike.
//   - «مش بيظهر كل الخزن» is the SETTINGS when section 1 is missing the box (it was never saved: the list is what the screen reads), DATA when section 1 has it but
//     every row of it reads under another name in section 2, and CODE (fixed) when two names in section 1 read as the same box (the line says  SAME_BOX_AS).
//
// It only issues SELECT statements (assertReadOnly of tools/orphan-row-audit.cjs refuses anything else and the session is READ ONLY) and does not start without explicit
// DB_* variables; it never reads a .env.
//
//   DB_HOST=127.0.0.1 DB_PORT=3306 DB_USER=... DB_PASSWORD=... DB_NAME=... node tools/box-currency-audit.cjs [--tenant tenant-default] [--json]
// Exit code: 0 = no flags, 1 = flags found, 2 = could not run.

const { assertReadOnly, requireDbEnv } = require('./orphan-row-audit.cjs');
const { CATCH_ALL, boxOf, buildCatalog, currencyOfName: nameCurrency } = require('../lib/boxCatalog');

const round2 = n => Math.round((Number(n) || 0) * 100) / 100;

/**
 * Pure part, unit-tested: from the rows as stored, the report and its flags.
 * @param {{ listed: string[], aliases?: Array<{alias:string,target:string}>, payments: object[], expenses: object[], withdrawals: object[], openings: object[] }} data
 */
function buildReport(data) {
  const aliases = new Map((data.aliases || []).map(row => [row.alias, row.target]));
  const catalog = buildCatalog(data.listed, aliases);
  const flags = [];
  const flag = (code, detail) => flags.push({ code, ...detail });

  const listed = catalog.entries.map(entry => ({ name: entry.name, box: entry.key, currency: entry.currency }));
  // A name in the list that has no box of its own was read as another listed name (a spelling or a merge): the owner sees two names in the settings, one box on the screen.
  for (const name of [...new Set(data.listed.map(item => item.replace(/\s+/g, ' ').trim()).filter(Boolean))]) {
    if (!listed.some(entry => entry.name === name)) flag('SAME_BOX_AS', { name });
  }

  const reading = (method, currency, stored = false) => boxOf(method, currency, catalog, { stored });
  const pairs = (rows, label) => rows.map(row => {
    const method = row.method === null || row.method === undefined ? '' : String(row.method);
    const currency = String(row.currency || 'EGP').toUpperCase();
    const read = reading(method, currency);
    const out = { source: label, method, currency, rows: Number(row.rows) || 0, amount: round2(row.amount), box: read.box, boxCurrency: read.currency };
    const said = nameCurrency(method);
    if (method && said !== currency) {
      // A name that says riyals or dollars carrying another currency, or an ordinary (pound) wallet carrying riyals/dollars.
      flag('CURRENCY_MISMATCH', { source: label, method, currency, rows: out.rows, amount: out.amount, boxSaysCurrency: said });
    }
    if (catalog.active && read.box === CATCH_ALL) flag('UNLISTED', { source: label, method, currency, rows: out.rows, amount: out.amount });
    if (catalog.active && !catalog.entries.some(entry => entry.currency === currency) && currency !== 'EGP') {
      flag('NO_BOX_FOR_CURRENCY', { source: label, method, currency, rows: out.rows, amount: out.amount });
    }
    return out;
  });

  const payments = pairs(data.payments, 'payments');
  const expenses = pairs(data.expenses, 'expenses');
  const withdrawals = pairs(data.withdrawals, 'withdrawals');
  const openings = (data.openings || []).map(row => {
    const read = reading(row.method, row.currency, true);
    if (catalog.active && read.box === CATCH_ALL && row.method !== '__general__') flag('STORED_UNLISTED', { method: row.method, currency: row.currency, opening: round2(row.opening_amount) });
    return { source: 'box_balances', method: row.method, currency: row.currency, opening: round2(row.opening_amount), baseline: row.baseline_at || null, box: read.box };
  });
  return { catalogActive: catalog.active, listed, payments, expenses, withdrawals, openings, flags };
}

function parseArgs(argv) {
  const out = { tenant: 'tenant-default', json: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--json') out.json = true;
    else if (argv[i] === '--tenant') out.tenant = String(argv[++i] || '');
    else throw new Error(`unknown argument: ${argv[i]}`);
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  let conf;
  try { conf = requireDbEnv(process.env); } catch (error) { console.error(error.message); return 2; }
  const mysql = require('mysql2/promise');
  const conn = await mysql.createConnection({ ...conf, connectTimeout: 20000 });
  const run = async (sql, params = []) => { const [rows] = await conn.query(assertReadOnly(sql), params); return rows; };
  try {
    await run('SET SESSION TRANSACTION READ ONLY');
    console.error(`[box-audit] ${conf.user}@${conf.host}:${conf.port}/${conf.database} tenant=${args.tenant}, SELECT only`);
    const [setting] = await run("SELECT config_json FROM tenant_settings WHERE tenant_id = ? AND section = 'content' LIMIT 1", [args.tenant]);
    let content = {};
    try { content = setting ? JSON.parse(setting.config_json) : {}; } catch { content = {}; }
    const listed = String(content['finance.payment_methods'] || '').split('||');
    const data = {
      listed,
      aliases: await run('SELECT alias, target FROM box_aliases WHERE tenant_id = ?', [args.tenant]),
      payments: await run(
        `SELECT payment_method AS method, currency, COUNT(*) AS \`rows\`, SUM(amount) AS amount FROM payments
          WHERE tenant_id = ? AND deleted_at IS NULL AND (status = 'paid' OR status IS NULL) GROUP BY payment_method, currency ORDER BY amount DESC`, [args.tenant]),
      expenses: await run(
        `SELECT box_method AS method, currency, COUNT(*) AS \`rows\`, SUM(amount) AS amount FROM expenses
          WHERE tenant_id = ? AND deleted_at IS NULL AND box_method IS NOT NULL AND box_method <> '' GROUP BY box_method, currency`, [args.tenant]),
      withdrawals: await run(
        `SELECT method, currency, COUNT(*) AS \`rows\`, SUM(amount) AS amount FROM box_withdrawals WHERE tenant_id = ? AND voided_at IS NULL GROUP BY method, currency`, [args.tenant]),
      openings: await run('SELECT method, currency, opening_amount, baseline_at FROM box_balances WHERE tenant_id = ?', [args.tenant]),
    };
    const report = buildReport(data);
    if (args.json) console.log(JSON.stringify(report, null, 2));
    else {
      console.log(`\n1. The settings list (${report.catalogActive ? 'in use' : 'EMPTY — the screen reads every spelling as its own box'})`);
      for (const entry of report.listed) console.log(`   ${entry.name}  ->  box «${entry.box}»  ${entry.currency}`);
      for (const [title, rows] of [['2. Payments (paid, not deleted)', report.payments], ['3a. Expenses taken from a box', report.expenses], ['3b. Withdrawals (not voided)', report.withdrawals]]) {
        console.log(`\n${title}`);
        for (const row of rows) console.log(`   ${String(row.method || '(none)').padEnd(34)} ${row.currency}  rows=${String(row.rows).padStart(5)}  amount=${String(row.amount).padStart(12)}  ->  «${row.box}» ${row.boxCurrency}`);
      }
      console.log('\n3c. Stored opening balances');
      for (const row of report.openings) console.log(`   ${String(row.method).padEnd(34)} ${row.currency}  opening=${row.opening}  ->  «${row.box}»`);
      console.log(`\n4. Flags: ${report.flags.length}`);
      for (const item of report.flags) console.log(`   ${item.code}  ${JSON.stringify(item)}`);
    }
    return report.flags.length ? 1 : 0;
  } finally {
    await conn.end();
  }
}

module.exports = { buildReport, nameCurrency, parseArgs };

if (require.main === module) {
  main().then(code => { process.exitCode = code; }).catch(error => { console.error(error.message); process.exitCode = 2; });
}
