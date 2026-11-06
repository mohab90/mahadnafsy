const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { OWNED, takeOwned, withOwned, ownedSql } = require('../lib/crmColumns');

test('an owned key leaves the blob for its column, and the rest of the blob is untouched', () => {
  const crm = { clientStatus: 'paused', market: 'local', tags: ['x'] };
  const { crm: rest, set } = takeOwned(crm);
  assert.deepEqual(rest, { tags: ['x'] });
  assert.deepEqual(set, { client_status: 'paused', market: 'local' });
  assert.equal(crm.clientStatus, 'paused', 'the caller\'s object is not mutated');
  assert.equal(crm.market, 'local');
});

test('a blob that does not mention the key sets no column (a save about something else leaves the status and the market alone)', () => {
  assert.deepEqual(takeOwned({ tags: ['x'] }).set, {});
  assert.deepEqual(takeOwned({ market: 'saudi' }).set, { market: 'saudi' }, 'each key is its own');
  assert.deepEqual(takeOwned(null), { crm: {}, set: {} });
});

test('a blank market is a cleared one, and the column\'s width is held', () => {
  for (const value of ['', '  ', null]) assert.deepEqual(takeOwned({ market: value }).set, { market: null }, JSON.stringify(value));
  assert.equal(takeOwned({ market: 'x'.repeat(40) }).set.market.length, 10);
});

test('an empty or blank status is a cleared one: the column is set to NULL', () => {
  for (const value of ['', '   ', null, undefined]) assert.deepEqual(takeOwned({ clientStatus: value }).set, { client_status: null }, JSON.stringify(value));
  assert.equal(takeOwned({ clientStatus: 'x'.repeat(100) }).set.client_status.length, 40, 'cut to the column\'s width');
});

test('a reader sees the key where screens always saw it: the blob\'s while it has it, else the column\'s', () => {
  assert.equal(withOwned({}, { client_status: 'active' }).clientStatus, 'active');
  assert.equal(withOwned({ clientStatus: 'finished' }, { client_status: 'active' }).clientStatus, 'finished', 'an older server wrote the blob after the copy');
  assert.equal('clientStatus' in withOwned({ tags: 'x' }, { client_status: null }), false);
  assert.equal('clientStatus' in withOwned({ tags: 'x' }, {}), false);
  assert.deepEqual(withOwned({ a: 1 }, { client_status: '', market: '' }), { a: 1 });
  assert.equal(withOwned({}, { market: 'saudi' }).market, 'saudi', 'the market comes back where the screens read it');
  assert.equal(withOwned({ market: 'local' }, { market: 'saudi' }).market, 'local', 'the blob\'s while it has it');
});

test('the SQL rule is the same rule: the key if the blob has it (even empty), else the column', () => {
  const sql = ownedSql('clientStatus', 'subscribers').replace(/\s+/g, ' ');
  assert.match(sql, /JSON_VALID\(subscribers\.crm_json\) AND JSON_CONTAINS_PATH\(subscribers\.crm_json,'one','\$\.clientStatus'\)/);
  assert.match(sql, /ELSE COALESCE\(subscribers\.client_status,''\) END/);
  assert.throws(() => ownedSql('tags'), /not an owned crm key/);
  assert.match(ownedSql('market', 's').replace(/\s+/g, ' '), /ELSE COALESCE\(s\.market,''\) END/);
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
  // and of a client's market (367): the two writers that save a blob write the column, and the bulk assignment reads it through ownedSql
  for (const file of ['routes/admin/subscribers.js', 'lib/clientCurrency.js']) assert.match(read(file), /market=IF\(\?,\?,market\)/, file);
  assert.doesNotMatch(read('routes/admin/stafflists.js'), /JSON_EXTRACT\(s\.crm_json, '\$\.market'\)/);
  assert.match(read('routes/admin/stafflists.js'), /ownedSql\('market'\)/);
  assert.doesNotMatch(read('routes/registrations.js'), /JSON\.stringify\(\{ clientStatus/);
  assert.doesNotMatch(read('lib/collectionSheets.js'), /clientStatus: kind/);
});
