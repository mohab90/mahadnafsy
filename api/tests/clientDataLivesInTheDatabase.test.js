'use strict';
/**
 * The clients — Dokki's included — are rows in the database. Nothing in the code,
 * the migrations, the committed files or the browser's storage carries a client.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..', '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('the admin\'s seed holds no clients, leads or staff', () => {
  const seed = read('admin/context/siteDataSeed.ts');
  for (const name of ['defaultSubscribers', 'defaultLeads', 'defaultStaffMembers']) {
    assert.match(seed, new RegExp(`export const ${name}: \\w+\\[\\] = \\[\\];`), `${name} must be an empty array`);
  }
});

test('no migration inserts a client or a lead', () => {
  const dir = path.join(ROOT, 'api', 'migrations');
  const offenders = fs.readdirSync(dir).filter(file => file.endsWith('.sql'))
    .filter(file => /INSERT\s+(IGNORE\s+)?INTO\s+`?(subscribers|leads|daqqi_attendees|daqqi_rounds)`?/i.test(fs.readFileSync(path.join(dir, file), 'utf8')));
  assert.deepEqual(offenders, []);
});

test('no spreadsheet, CSV or client dump is committed', () => {
  const files = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' }).split('\n');
  const data = files.filter(file => /\.(csv|xlsx?|sqlite|db|dump)$/i.test(file) || /(^|\/)(clients|subscribers|dokki|daqqi)[\w-]*\.json$/i.test(file));
  assert.deepEqual(data, []);
});

test('the browser keeps no client data: the persisted cache is the public catalogue only', () => {
  const context = read('admin/context/SiteDataContext.tsx');
  const payload = context.slice(context.indexOf('const payloadObject = {'), context.indexOf('writeVersionedCache(STORAGE_KEY'));
  for (const key of ['subscribers', 'leads', 'orders', 'staffMembers', 'expenses']) {
    assert.ok(!new RegExp(`\\b${key}\\b`).test(payload), `${key} must not be written to localStorage`);
  }
});

test('the Dokki screens ask the server for their clients; none streams the branch list', () => {
  // The branch's whole client list used to be streamed into the browser 300 at a time for the schedule, the clients,
  // the accounts and the statistics. Each of them asks the server for what it shows now.
  const groups = read('admin/pages/dashboard/dashboardTabGroups.ts');
  assert.doesNotMatch(groups, /branchSubscriberTabs/);
  const runtime = read('admin/context/site-data-hooks/useAdminDataRuntime.ts');
  assert.doesNotMatch(runtime, /loadBranchSubscribers|streamSubscribers/);
  assert.doesNotMatch(read('admin/lib/mysqlapi.ts'), /streamSubscribers|streamPages|countSubscribers/);
  const routes = read('api/routes/admin/dokkiclients.js');
  for (const path of ['overview', 'candidates', 'clients', 'installment-clients']) {
    assert.ok(routes.includes(`/api/admin/dokki/${path}'`), path);
  }
  assert.ok(read('api/routes/admin/analyticssummary.js').includes("'/api/admin/analytics-summary'"));
});
