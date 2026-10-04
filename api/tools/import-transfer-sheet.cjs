#!/usr/bin/env node
'use strict';
/**
 * Put a sheet of transfers that arrived onto the transfers ledger (الحسابات ←
 * التحويلات), once, on the server — for the sheet the accounts team sends that
 * is not yet matched to anyone («التحويلات غير مؤكدة»).
 *
 *   node tools/import-transfer-sheet.cjs <file.xlsx>            # report only
 *   node tools/import-transfer-sheet.cjs <file.xlsx> --apply
 *   … --box "فودافون كاش 7711"    every row on this account, whatever «الخزنة» says
 *   … --unmatched-box "انستا باي"  only the rows whose «الخزنة» names no known account
 *
 * Columns: رقم العملية · الهاتف · المبلغ · الخزنة (the receiving account's
 * number). There is no date column: a transfer is recorded with today's date
 * and the note says it came from this sheet. Each row goes through the same
 * importer as the screen (lib/incomingTransfers.js): an operation number
 * already on that account is counted, not added again, so running this twice
 * changes nothing.
 */
require('dotenv').config();
const fs = require('fs');
const arg = (name, fallback) => { const at = process.argv.indexOf(`--${name}`); return at > 0 ? process.argv[at + 1] : fallback; };
const file = process.argv[2];
const apply = process.argv.includes('--apply');
const tenantId = arg('tenant', process.env.DEFAULT_TENANT_ID || 'tenant-default');
const forcedBox = arg('box', null);
// For the rows whose account matches no known box only — the rest keep theirs.
const fallbackBox = arg('unmatched-box', null);
if (!file || !fs.existsSync(file)) { console.error('usage: node tools/import-transfer-sheet.cjs <file.xlsx> [--apply] [--box "<account>"]'); process.exit(2); }

const fold = value => String(value ?? '').replace(/[\u0660-\u0669]/g, d => String(d.charCodeAt(0) - 0x0660)).replace(/[إأآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/\s+/g, ' ').trim();
const { canonicalChannel } = require('../lib/paymentChannels');
const digitsOf = value => String(value ?? '').replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660)).replace(/\D/g, '');

/**
 * The known account the sheet's «الخزنة» names: a box whose number is in it
 * (its last digits) and whose rail fits («انستا …» is never a Vodafone wallet).
 * The same box is often written several ways («فودافون كاش 4645» twice), so the
 * matches are folded to one channel (lib/paymentChannels.js) and the transfer is
 * recorded under that one clean name. Null when it is not exactly one box.
 */
function boxFor(account, boxes) {
  const text = fold(account);
  const digits = digitsOf(account);
  const instapay = /انستا|insta/.test(text);
  const hits = boxes.filter(box => {
    const name = fold(box);
    if (instapay !== /انستا|insta/.test(name)) return false;
    return (name.match(/\d{3,}/g) || []).some(group => digits.endsWith(group) || digits.includes(group));
  });
  const channels = [...new Set(hits.map(canonicalChannel))];
  return channels.length === 1 ? channels[0] : null;
}

(async () => {
  const { readXlsx } = require('../lib/xlsxRead');
  const { importTransfers } = require('../lib/incomingTransfers');
  const { pool } = require('../lib/db');
  const tabs = readXlsx(fs.readFileSync(file));
  // The accounts in use: what payments and earlier transfers were recorded on.
  const [known] = await pool.query(
    `SELECT DISTINCT method FROM (
       SELECT payment_method AS method FROM payments WHERE tenant_id=? AND payment_method IS NOT NULL AND payment_method<>''
       UNION SELECT method FROM incoming_transfers WHERE tenant_id=?) m`, [tenantId, tenantId]);
  const boxes = known.map(row => row.method);
  const transfers = []; const problems = []; const mapping = new Map();
  for (const tab of tabs) {
    const [heading, ...rows] = tab.rows;
    const col = words => (heading || []).findIndex(cell => words.some(word => fold(cell).includes(word)));
    const at = { reference: col(['رقم العمليه', 'رقم العملية']), phone: col(['الهاتف', 'هاتف', 'رقم المحول']), amount: col(['المبلغ', 'ايداع']), box: col(['الخزنه', 'الحساب']) };
    if (at.reference < 0 || at.amount < 0) { problems.push(`${tab.name}: no «رقم العملية» / «المبلغ» heading`); continue; }
    rows.forEach((row, index) => {
      const reference = digitsOf(row[at.reference]) || String(row[at.reference] ?? '').trim();
      const amount = Number(digitsOf(row[at.amount]) ? String(row[at.amount]).replace(/[^\d.]/g, '') : NaN);
      if (!reference || !(amount > 0)) { problems.push(`${tab.name} row ${index + 2}: missing number or amount`); return; }
      const account = at.box >= 0 ? row[at.box] : tab.name;
      const matched = forcedBox || boxFor(account, boxes);
      const box = matched || fallbackBox;
      const key = `${account} → ${box || '—'}${!matched && box ? '  (--unmatched-box: no known account has this number)' : ''}`;
      mapping.set(key, (mapping.get(key) || 0) + 1);
      if (!box) { problems.push(`${tab.name} row ${index + 2}: account «${at.box >= 0 ? row[at.box] : tab.name}» matches no single known account — pass --box`); return; }
      const phone = at.phone >= 0 ? digitsOf(row[at.phone]) : '';
      transfers.push({
        amount, currency: 'EGP', method: box, reference,
        senderPhone: phone ? (phone.length === 10 && phone.startsWith('1') ? `0${phone}` : phone) : null,
        note: 'من شيت «التحويلات غير مؤكدة»',
      });
    });
  }
  const byBox = transfers.reduce((map, t) => map.set(t.method, (map.get(t.method) || 0) + 1), new Map());
  console.log(`${transfers.length} transfer(s) read, ${transfers.reduce((s, t) => s + t.amount, 0).toLocaleString('en')} EGP`);
  for (const [box, n] of byBox) console.log(`  ${box}: ${n}`);
  console.log('\nsheet account → account recorded on:');
  for (const [line, n] of mapping) console.log(`  ${line}: ${n}`);
  if (problems.length) { console.log(`\n${problems.length} row(s) not read:`); problems.slice(0, 30).forEach(p => console.log(`  - ${p}`)); }
  if (!apply) { console.log('\nNothing written — run again with --apply.'); await pool.end(); return; }
  const result = await importTransfers(pool, { tenantId, transfers, actor: { name: 'استيراد شيت التحويلات غير المؤكدة' } });
  console.log(`\nadded ${result.created} · already on the ledger ${result.existing} · refused ${result.failed.length}`);
  result.failed.slice(0, 20).forEach(f => console.log(`  - row ${f.index + 2}: ${f.error}`));
  await pool.end();
})().catch(error => { console.error(error); process.exit(1); });
