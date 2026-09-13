'use strict';

// One writer decides who gets access to a course.
//
// api/lib/entitlements.js is the authority: it applies the access policy (full
// or limited by the proportion paid), refuses to lower a grant somebody already
// holds, records entitlement_source, granted_by, an expiry from the course's
// access_months, and an entitlement_events audit row.
//
// The Paymob confirmation had its own INSERT. It wrote access_type='full'
// whatever had been paid, recorded none of that, and its ON DUPLICATE KEY
// UPDATE set access_type='full' unconditionally — so it would raise a
// deliberately limited grant to full, the one move the authority exists to
// refuse. 1,533 of the enrolments on production record no reason for existing,
// and this was the last writer that could still add to them.
//
// Run: npm run test:unit

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');

function apiSources() {
  const out = [];
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'tests' || entry.name === 'migrations') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.js$/.test(entry.name)) out.push(full);
    }
  };
  walk(path.join(ROOT, 'api'));
  return out.map(f => path.relative(ROOT, f).split(path.sep).join('/'));
}

test('only the authority writes an enrolment', () => {
  const writers = apiSources().filter(rel =>
    /INSERT\s+(?:IGNORE\s+)?INTO\s+enrollments/i.test(fs.readFileSync(path.join(ROOT, rel), 'utf8')));
  assert.deepEqual(writers, ['api/lib/entitlements.js'],
    'these grant access without going through grantCourseEntitlement: ' + writers.join(', '));
});

test('the Paymob confirmation asks the authority', () => {
  const src = fs.readFileSync(path.join(ROOT, 'api/routes/public-orders.js'), 'utf8');
  assert.match(src, /const \{ grantCourseEntitlement \} = require\('\.\.\/lib\/entitlements'\);/);
  assert.match(src, /await grantCourseEntitlement\(\{/);
  // It says where the grant came from, which is the column that was empty.
  assert.match(src, /source: 'paymob_order'/);
  assert.match(src, /actor: order\.customer_email \|\| 'paymob'/);
  // And it passes the transaction, so a failed grant rolls the payment back
  // with it rather than leaving a paid order with no access.
  assert.match(src, /\}, conn\);/);
});

test('the authority still records why a grant exists, and never lowers one', () => {
  const src = fs.readFileSync(path.join(ROOT, 'api/lib/entitlements.js'), 'utf8');

  // Every column that made the difference between an accountable grant and a
  // bare row. Pinned as the insert's own column list, not as loose words —
  // `entitlement_source` also appears in the ON DUPLICATE clause below it, so
  // searching the whole file passes on an insert that dropped the column.
  const insert = /INSERT INTO enrollments\s*\n\s*\(([^)]*)\)/.exec(src);
  assert.ok(insert, 'the enrolment insert moved');
  const columns = insert[1].replace(/\s+/g, '');
  for (const col of ['entitlement_source', 'granted_by', 'expiry_date', 'lecture_limit', 'status']) {
    assert.ok(columns.includes(col), `the insert no longer carries ${col}`);
  }
  // And the upsert has to carry them forward, or a second grant blanks them.
  assert.match(src, /entitlement_source=VALUES\(entitlement_source\),granted_by=VALUES\(granted_by\)/);
  assert.match(src, /INSERT INTO entitlement_events/, 'a grant has to leave an audit row');

  // The refusal to take access away.
  assert.match(src, /if \(paymentDriven && effective\.mode === 'limited' && existing\?\.access_type === 'limited'\)/);
  assert.match(src, /if \(held > Number\(effective\.lectureLimit \|\| 0\)\) effective = accessPolicy\('limited', held\);/);
});
