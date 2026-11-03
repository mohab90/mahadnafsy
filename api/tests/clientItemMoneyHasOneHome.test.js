'use strict';

// 3 Nov 2026, «انقل الأسعار المتفق عليها ومدفوع قبل السيستم من crm_json لجدول»: the price a client agreed for an item and what they paid for it before the system are rows of
// client_item_money (migration 359), read and written by lib/itemMoney.js alone. They were two maps in subscribers.crm_json, read from twenty places — some as JSON paths in
// SQL — and overwritten by any whole-client save from an older screen. This keeps anything from reading or writing them in the old place again.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const API = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(API, rel), 'utf8');
const walk = (dir, out = []) => {
  for (const entry of fs.readdirSync(path.join(API, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) walk(rel, out); else if (/\.(js|cjs)$/.test(entry.name)) out.push(rel);
  }
  return out;
};

test('nothing reads the two maps out of crm_json: no JSON path, no LIKE on the blob, no property of a parsed crm', () => {
  const offenders = [];
  for (const rel of [...walk('lib'), ...walk('routes'), ...walk('tools')]) {
    if (rel === 'lib/itemMoney.js') continue;
    const lines = fs.readFileSync(path.join(API, rel), 'utf8').split('\n');
    lines.forEach((line, index) => {
      if (/^\s*(\/\/|\*|--)/.test(line)) return;
      const jsonPath = /\$\.(priorPaid|customPrices)\b|'%(priorPaid|customPrices)%'|crm_json[^\n]{0,80}\b(priorPaid|customPrices)\b/.test(line);
      const parsedCrm = /parseCrm\([^)]*\)\.(priorPaid|customPrices)\b|\bcrm\??\.(priorPaid|customPrices)\b/.test(line);
      if (jsonPath || parsedCrm) offenders.push(`${rel}:${index + 1}  ${line.trim().slice(0, 100)}`);
    });
  }
  // The ones that are about the NEW maps (the object lib/itemMoney.js hands back, named crm in these files) are the only exceptions.
  const allowed = new Set(['lib/clientCurrency.js', 'lib/daqqiAttendeeMoney.js', 'lib/staffOverview.js']);
  const real = offenders.filter(entry => !allowed.has(entry.split(':')[0]));
  assert.deepEqual(real, [], 'read them through lib/itemMoney.js (loadItemMoney / moneyOf / priorPaidSql)');
  for (const file of allowed) {
    const source = read(file);
    assert.match(source, /require\('\.\/itemMoney'\)/, `${file} gets the maps from lib/itemMoney.js`);
    assert.doesNotMatch(source, /parseCrm\([^)]*\)\.(priorPaid|customPrices)|JSON_EXTRACT\([^)]*(priorPaid|customPrices)/);
  }
});

test('a client\'s save never stores the two maps, whatever copy the screen holds', () => {
  const save = read('routes/admin/subscribers.js');
  assert.match(save, /customPrices: _customPrices,\s+priorPaid: _priorPaid,/);
  assert.match(save, /delete crmData\.customPrices;\s+delete crmData\.priorPaid;/);
  const { withoutItemMoney, withItemMoney } = require('../lib/itemMoney');
  assert.deepEqual(withoutItemMoney({ market: 'EG', priorPaid: { a: 1 }, customPrices: { a: 2 } }), { market: 'EG' });
  // A stale copy left in the blob is overridden by the table's, never read.
  assert.deepEqual(withItemMoney({ market: 'EG', priorPaid: { stale: 9 } }, { customPrices: { c: 5 }, priorPaid: { c: 1 } }),
    { market: 'EG', customPrices: { c: 5 }, priorPaid: { c: 1 } });
  assert.deepEqual(withItemMoney({ market: 'EG' }, undefined), { market: 'EG', customPrices: {}, priorPaid: {} });
});

test('every list and every detail that sends a client with its prices fills them from the table', () => {
  const lists = read('routes/admin/stafflists.js');
  assert.equal((lists.match(/withItemMoney\(withInstallmentPlans\(/g) || []).length, 4);
  assert.equal((lists.match(/await loadItemMoney\(pool, \{ tenantId(: req\.tenantId)?, subscriberIds: ids \}\)/g) || []).length, 4);
  assert.match(read('routes/admin/subscribers.js'), /withItemMoney\(parseCrm\(r\.crm_json\), await moneyOf\(pool, \{ tenantId: req\.tenantId, subscriberId: r\.id \}\)\)/);
  assert.match(read('lib/staffOverview.js'), /withItemMoney\(withInstallmentPlans\(/);
});

test('the SQL that read a JSON path now reads the table', () => {
  assert.match(read('lib/daqqiAttendees.js'), /FROM client_item_money m\s+WHERE m\.tenant_id = da\.tenant_id AND m\.subscriber_id = da\.subscriber_id AND m\.item_key = dr\.course_id/);
  assert.match(read('lib/outstandingBalances.js'), /priorPaidTotalSql\('s'\)/);
  assert.match(read('lib/weeklyBranchReport.js'), /priorPaidTotalSql\('s'\)/);
  assert.match(read('lib/instituteCertificates.js'), /FROM client_item_money m JOIN subscribers s/);
});

test('migration 359 creates the table and copies the numbers; 360 takes them out of the blob only where the copy is whole', () => {
  const create = read('migrations/359_v26_client_item_money.sql');
  assert.match(create, /CREATE TABLE IF NOT EXISTS client_item_money/);
  assert.match(create, /PRIMARY KEY \(tenant_id, subscriber_id, item_key\)/);
  assert.match(create, /JSON_KEYS\(s\.crm_json, '\$\.customPrices'\)/);
  assert.match(create, /JSON_KEYS\(s\.crm_json, '\$\.priorPaid'\)/);
  const strip = read('migrations/360_v26_client_item_money_leaves_crm_json.sql');
  assert.match(strip, /JSON_REMOVE\(s\.crm_json, '\$\.customPrices', '\$\.priorPaid'\)/);
  assert.match(strip, /NOT EXISTS \(SELECT 1 FROM client_item_money m/);
  assert.match(read('schema.sql'), /CREATE TABLE `client_item_money`/);
});
