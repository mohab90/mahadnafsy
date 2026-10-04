'use strict';
// One meaning for a lead's status, everywhere.
//
// «Closed» used to be written out by hand in a dozen places and no two agreed:
// one screen counted a wrong number as still open, the HR reports counted
// «مغلق» as a sale, offboarding handed a colleague the leads that had already
// said no, the reminders kept chasing leads marked not interested. The meaning
// now lives in api/lib/leadStatuses.js and its browser copy
// shared/leadStatuses.ts; this holds the two identical and refuses a new
// hand-written list of statuses anywhere else.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const statuses = require('../lib/leadStatuses');

const ROOT = path.join(__dirname, '..', '..');
const shared = fs.readFileSync(path.join(ROOT, 'shared', 'leadStatuses.ts'), 'utf8');

const listIn = (source, name) => {
  const m = source.match(new RegExp(`export const ${name}[^=]*=\\s*(?:new Set\\()?\\[([\\s\\S]*?)\\]`));
  assert.ok(m, `${name} in shared/leadStatuses.ts`);
  return [...m[1].matchAll(/'([a-z_]+)'/g)].map(x => x[1]).sort();
};

test('the browser copy says exactly what the API says', () => {
  assert.deepEqual(listIn(shared, 'LEAD_STATUSES'), [...statuses.LEAD_STATUSES].sort());
  assert.deepEqual(listIn(shared, 'TERMINAL_LEAD_STATUSES'), [...statuses.TERMINAL_LEAD_STATUSES].sort());
  assert.deepEqual(listIn(shared, 'CONVERTED_LEAD_STATUSES'), [...statuses.CONVERTED_LEAD_STATUSES].sort());
  assert.deepEqual(listIn(shared, 'INTERESTED_LEAD_STATUSES'), [...statuses.INTERESTED_LEAD_STATUSES].sort());
});

test('closed is not a sale, and every finished lead is terminal', () => {
  assert.equal(statuses.isConvertedLeadStatus('closed'), false);
  assert.equal(statuses.isConvertedLeadStatus('WON'), true);
  for (const status of ['not_interested', 'wrong_number', 'archived', 'converted', 'lost']) {
    assert.equal(statuses.isOpenLeadStatus(status), false, status);
  }
  assert.equal(statuses.TERMINAL_SQL.startsWith("('converted'"), true);
});

// A list of two or more statuses that are all finished ones — an array in code
// or an IN (…) in SQL — is somebody's own definition of closed or sold. (Lists
// that mix in open statuses are pipeline column orders, funnel stages and
// automation triggers: a different question, and left alone.) A subset that is
// deliberately not «closed» says why on the line above:
//   // lead-status-subset: the negative outcomes only, for the loss report
const VOCABULARY = new Set([...statuses.LEAD_STATUSES, ...statuses.TERMINAL_LEAD_STATUSES, 'follow_up']);
const HOMES = new Set(['api/lib/leadStatuses.js', 'shared/leadStatuses.ts']);
const SCAN = ['api/routes', 'api/lib', 'admin/pages', 'admin/lib', 'admin/hooks', 'admin/context', 'client', 'shared'];

function* files(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!['node_modules', 'dist', 'tests', 'e2e'].includes(entry.name)) yield* files(full);
    } else if (/\.(js|ts|tsx)$/.test(entry.name) && !/\.test\./.test(entry.name)) yield full;
  }
}

test('no hand-written list of lead statuses outside the vocabulary', () => {
  const offenders = [];
  for (const dir of SCAN) {
    for (const file of files(path.join(ROOT, dir))) {
      const rel = path.relative(ROOT, file).replace(/\\/g, '/');
      if (HOMES.has(rel)) continue;
      const source = fs.readFileSync(file, 'utf8');
      for (const m of source.matchAll(/\[\s*((?:'[a-z_]+'\s*,\s*)+'[a-z_]+'\s*,?\s*)\]|\bIN\s*\(\s*((?:'[a-z_]+'\s*,\s*)+'[a-z_]+')\s*\)/g)) {
        const words = [...(m[1] || m[2]).matchAll(/'([a-z_]+)'/g)].map(x => x[1]);
        if (!words.every(word => VOCABULARY.has(word))) continue;
        if (!words.every(word => statuses.TERMINAL_LEAD_STATUSES.has(word))) continue;
        const lineStart = source.lastIndexOf('\n', m.index);
        const before = source.slice(source.lastIndexOf('\n', lineStart - 1) + 1, m.index);
        if (/lead-status-subset:/.test(before)) continue;
        offenders.push(`${rel}:${source.slice(0, m.index).split('\n').length}  ${m[0].replace(/\s+/g, ' ').slice(0, 80)}`);
      }
    }
  }
  assert.deepEqual(offenders, [], 'use TERMINAL_LEAD_STATUSES / CONVERTED_LEAD_STATUSES / isOpenLeadStatus instead');
});
