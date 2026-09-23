'use strict';

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
  assert.match(read('routes/admin/leads.js'), /excludeArchiveSourcesSql\('l\.source'\)/);
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
