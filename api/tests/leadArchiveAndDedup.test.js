'use strict';
const { leadsRouteSource } = require('./_authRouteSource');

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ARCHIVE_SOURCE_PREFIXES, excludeArchiveSourcesSql, isArchiveSource } = require('../lib/leadArchive');
const { findLeadDuplicateGroups } = require('../lib/leadMerge');

test('server archive rule matches the admin app and excludes archive sources in SQL', () => {
  const adminRule = fs.readFileSync(path.join(__dirname, '..', '..', 'admin', 'pages', 'dashboard', 'tabs', 'leads', 'leadSourceGroups.ts'), 'utf8');
  const adminPrefixes = JSON.parse(adminRule.match(/ARCHIVE_SOURCE_PREFIXES = (\[[^\]]*\])/)[1].replace(/'/g, '"'));
  assert.deepEqual(adminPrefixes, ARCHIVE_SOURCE_PREFIXES);
  assert.equal(isArchiveSource(' محلي قديم — موزّع'), true);
  assert.equal(isArchiveSource('Google Sheet'), false);
  const clause = excludeArchiveSourcesSql('l.source');
  assert.match(clause.sql, /^ AND NOT \(TRIM\(COALESCE\(l\.source,''\)\) LIKE \?/);
  assert.deepEqual(clause.params, ARCHIVE_SOURCE_PREFIXES.map(prefix => `${prefix}%`));
});

test('distributors skip archive rows', () => {
  const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  assert.match(read('routes/lead-capture-crm.js'), /excludeArchiveSourcesSql\('source'\)/);
  assert.match(read('routes/crm-advanced.js'), /excludeArchiveSourcesSql\('source'\)/);
  assert.match(leadsRouteSource(), /excludeArchiveSourcesSql\('l\.source'\)/);
});

test('duplicate detection reads past the first page of leads', async () => {
  // Two leads with the same number, 6000 rows apart: the old LIMIT 10000 style
  // single read of the oldest rows could not see a pair split like this.
  const all = Array.from({ length: 6002 }, (_, i) => ({
    id: `lead-${String(i).padStart(5, '0')}`, name: `n${i}`, email: '', phone: `0100${String(1000000 + i)}`,
    status: 'new', score: 0, client_code: null, created_at: new Date(2026, 0, 1, 0, 0, i),
  }));
  all[6001].phone = all[0].phone;
  const db = {
    async query(sql, params) {
      if (/\bid IN \(\?\)/.test(sql)) return [all.filter(row => params[1].includes(row.id))];
      const limit = params[params.length - 1];
      let rows = all;
      if (params.length > 2) {
        const [, createdAt, , id] = params;
        rows = all.filter(row => row.created_at > createdAt || (+row.created_at === +createdAt && row.id > id));
      }
      return [rows.slice(0, limit)];
    },
  };
  const groups = await findLeadDuplicateGroups('tenant-a', db);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].leads.map(lead => lead.id).sort(), ['lead-00000', 'lead-06001']);
});

test('the two-pass duplicate search gives exactly the groups a read of every lead gives', async () => {
  const { duplicateGroups } = require('../lib/leadMerge');
  // A small pool of numbers and addresses written in different spellings, so chains (a~b by phone, b~c by email) appear.
  const numbers = ['01001234567', '+201001234567', '0020 100 123 4567', '01111111111', '+20 111 111 1111', '01222222222', '٠١٠٠٥٥٥٦٦٦٧', '0100 555 6667'];
  const emails = ['a@x.com', ' A@X.COM ', 'b@x.com', 'c@x.com', '', 'd@x.com'];
  let seed = 7;
  const next = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  const all = Array.from({ length: 400 }, (_, i) => ({
    id: `lead-${String(i).padStart(4, '0')}`, name: `n${i}`,
    email: next(3) === 0 ? emails[next(emails.length)] : `solo${i}@x.com`,
    phone: next(3) === 0 ? numbers[next(numbers.length)] : `0155${String(1000000 + i)}`,
    status: 'new', score: next(50), client_code: next(4) === 0 ? `C${i}` : null, created_at: new Date(2026, 0, 1, 0, 0, i),
  }));
  const db = {
    async query(sql, params) {
      if (/\bid IN \(\?\)/.test(sql)) return [all.filter(row => params[1].includes(row.id))];
      const limit = params[params.length - 1];
      let rows = all;
      if (params.length > 2) {
        const [, createdAt, , id] = params;
        rows = all.filter(row => row.created_at > createdAt || (+row.created_at === +createdAt && row.id > id));
      }
      return [rows.slice(0, limit)];
    },
  };
  const shape = groups => groups.map(group => ({ target: group.targetId, ids: group.leads.map(lead => lead.id) })).sort((a, b) => a.target.localeCompare(b.target));
  const expected = shape(duplicateGroups(all));
  assert.ok(expected.length > 0, 'the data has no duplicates to compare');
  assert.deepEqual(shape(await findLeadDuplicateGroups('tenant-a', db)), expected);
  // And no duplicates at all reads no second page of rows.
  const unique = all.map((row, i) => ({ ...row, email: `u${i}@x.com`, phone: `0155${String(2000000 + i)}` }));
  let secondPass = false;
  const quiet = { async query(sql, params) { if (/\bid IN \(\?\)/.test(sql)) secondPass = true; return [unique.slice(0, params[params.length - 1])]; } };
  assert.deepEqual(await findLeadDuplicateGroups('tenant-a', quiet), []);
  assert.equal(secondPass, false);
});
