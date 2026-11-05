const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { OWNED, takeOwned, withOwned, ownedSql } = require('../lib/crmColumns');

test('an owned key leaves the blob for its column, and the rest of the blob is untouched', () => {
  const crm = { clientStatus: 'paused', market: 'local', tags: ['x'] };
  const { crm: rest, set } = takeOwned(crm);
  assert.deepEqual(rest, { market: 'local', tags: ['x'] });
  assert.deepEqual(set, { client_status: 'paused' });
  assert.equal(crm.clientStatus, 'paused', 'the caller\'s object is not mutated');
});

test('a blob that does not mention the key sets no column (a save about something else leaves the status alone)', () => {
  assert.deepEqual(takeOwned({ market: 'local' }).set, {});
  assert.deepEqual(takeOwned(null), { crm: {}, set: {} });
});

test('an empty or blank status is a cleared one: the column is set to NULL', () => {
  for (const value of ['', '   ', null, undefined]) assert.deepEqual(takeOwned({ clientStatus: value }).set, { client_status: null }, JSON.stringify(value));
  assert.equal(takeOwned({ clientStatus: 'x'.repeat(100) }).set.client_status.length, 40, 'cut to the column\'s width');
});

test('a reader sees the key where screens always saw it: the blob\'s while it has it, else the column\'s', () => {
  assert.equal(withOwned({}, { client_status: 'active' }).clientStatus, 'active');
  assert.equal(withOwned({ clientStatus: 'finished' }, { client_status: 'active' }).clientStatus, 'finished', 'an older server wrote the blob after the copy');
  assert.equal('clientStatus' in withOwned({ market: 'x' }, { client_status: null }), false);
  assert.equal('clientStatus' in withOwned({ market: 'x' }, {}), false);
  assert.deepEqual(withOwned({ a: 1 }, { client_status: '' }), { a: 1 });
});

test('the SQL rule is the same rule: the key if the blob has it (even empty), else the column', () => {
  const sql = ownedSql('clientStatus', 'subscribers').replace(/\s+/g, ' ');
  assert.match(sql, /JSON_VALID\(subscribers\.crm_json\) AND JSON_CONTAINS_PATH\(subscribers\.crm_json,'one','\$\.clientStatus'\)/);
  assert.match(sql, /ELSE COALESCE\(subscribers\.client_status,''\) END/);
  assert.throws(() => ownedSql('market'), /not an owned crm key/);
});

test('every owned key has its column in the schema and its index-ready migration', () => {
  const schema = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
  const block = schema.slice(schema.indexOf('CREATE TABLE `subscribers`'), schema.indexOf('ENGINE=', schema.indexOf('CREATE TABLE `subscribers`')));
  for (const { column } of OWNED) assert.match(block, new RegExp('`' + column + '` varchar'), column);
  assert.match(block, /KEY `idx_subscribers_tenant_status` \(`tenant_id`,`client_status`\)/);
});

test('every writer of a client\'s status writes the column, and no list reads the key out of the blob by hand', () => {
  const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  for (const file of ['routes/admin/subscribers.js', 'routes/registrations.js', 'lib/collectionSheets.js', 'lib/clientCurrency.js', 'tools/restore-paused-clients.cjs']) {
    assert.match(read(file), /client_status/, file);
  }
  for (const file of ['routes/admin/stafflists.js', 'lib/staffOverview.js']) {
    assert.doesNotMatch(read(file), /JSON_EXTRACT\([a-z.]*crm_json,\s*'\$\.clientStatus'\)/, `${file} reads the status through ownedSql`);
  }
  assert.doesNotMatch(read('routes/registrations.js'), /JSON\.stringify\(\{ clientStatus/);
  assert.doesNotMatch(read('lib/collectionSheets.js'), /clientStatus: kind/);
});
