'use strict';

// The Dokki requests of 9 Oct 2026.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = rel => fs.readFileSync(path.join(__dirname, '../..', rel), 'utf8');

// «اعمل زر ادوس عليه يظهر الكورسات المنتهي … عشان الكورس المنتهيه استخدامها قليل جدا».
test('finished rounds are hidden until asked for', () => {
  const tab = read('admin/pages/dashboard/tabs/DaqqiScheduleTab.tsx');
  assert.match(tab, /const \[showFinished, setShowFinished\] = useState\(false\);/);
  assert.match(tab, /\(showFinished \|\| daqqiFilterStatus === 'finished' \|\| r\.status !== 'finished'\) &&/);
});

// «زر بحث وحجز دفعه … البحث صحيح لما اكتب اول حرفين».
function matcher() {
  const ADMIN_MODULES = path.join(__dirname, '../../admin/node_modules');
  let esbuild;
  try { esbuild = require(path.join(ADMIN_MODULES, 'esbuild')); } catch { return null; }
  const out = esbuild.buildSync({
    stdin: { contents: "export { matchesSearch } from './lib/clientSearch';", resolveDir: path.join(__dirname, '../../admin'), loader: 'ts' },
    bundle: true, write: false, format: 'cjs', platform: 'node', logLevel: 'silent', nodePaths: [ADMIN_MODULES], define: { 'import.meta.env': '{}' },
  });
  const module = { exports: {} };
  new Function('module', 'exports', 'require', out.outputFiles[0].text)(module, module.exports, require);
  return module.exports.matchesSearch;
}
const matchesSearch = matcher();

test('two letters find the people with them, not the first eight on the list', { skip: !matchesSearch }, () => {
  const clients = [
    { name: 'أحمد سمير', phone: '01012345678' },
    { name: 'منى علي', phone: '01198765432' },
    { name: 'هاني مراد', phone: '01222222222' },
  ];
  const found = query => clients.filter(client => matchesSearch(query, client)).map(client => client.name);
  assert.deepEqual(found('اح'), ['أحمد سمير'], '«اح» finds «أحمد»');
  assert.deepEqual(found('من'), ['منى علي']);
  assert.deepEqual(found('0119'), ['منى علي'], 'a number by its digits');
  const modal = read('admin/pages/dashboard/DashboardQuickBooking.tsx');
  assert.doesNotMatch(modal, /replace\(\/\D\/g, ''\)\.includes\(qDigits\)/, 'the empty-digits test is gone');
  assert.match(modal, /\{searching && searchesEverything && <WholeDatabaseSearch query=\{q\} \/>\}/);
});
