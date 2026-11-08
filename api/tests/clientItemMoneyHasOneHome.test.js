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
  
  
});



test('every comparison of the new table\'s columns with another table\'s names the collation (a production database mixes utf8mb4_unicode_ci and utf8mb4_general_ci)', () => {
  // The release's staging run stopped on «Illegal mix of collations» in migration 360, which the lab (one collation everywhere) cannot show.
  const strip = read('migrations/360_v26_client_item_money_leaves_crm_json.sql');
  assert.equal((strip.match(/COLLATE utf8mb4_unicode_ci/g) || []).length, 6, 'tenant, client and item, twice');
  const home = read('lib/itemMoney.js');
  
  
  const list = read('routes/misc/clientDbList.js');
  assert.equal((list.match(/ COLLATE utf8mb4_unicode_ci AS (id|name|phone|email)/g) || []).length, 12, 'the three parts of the union carry one collation');
  
  
});
