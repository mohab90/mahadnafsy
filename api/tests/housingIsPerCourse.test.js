'use strict';

// «في الدقي عند التسكين للعميل اللي حاجز اكتر من كورس لما بنسكن كورس العميل كله
// بيتسكن ودا غلط لو لسه في كورسات تانية محتاجة تسكين» (13 Oct 2026).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = rel => fs.readFileSync(path.join(__dirname, '../..', rel), 'utf8');

function load() {
  const ADMIN_MODULES = path.join(__dirname, '../../admin/node_modules');
  let esbuild;
  try { esbuild = require(path.join(ADMIN_MODULES, 'esbuild')); } catch { return null; }
  const out = esbuild.buildSync({
    stdin: {
      contents: "export * from './pages/dashboard/tabs/daqqi/daqqiHousingNeeds';",
      resolveDir: path.join(__dirname, '../../admin'), loader: 'ts',
    },
    bundle: true, write: false, format: 'cjs', platform: 'node', logLevel: 'silent', nodePaths: [ADMIN_MODULES],
    define: { 'import.meta.env': '{}' },
  });
  const module = { exports: {} };
  new Function('module', 'exports', 'require', out.outputFiles[0].text)(module, module.exports, require);
  return module.exports;
}
const housing = load();

const round = (id, courseId, ...attendees) => ({ id, code: `R-${id}`, courseId, attendees: attendees.map(subscriberId => ({ subscriberId })), status: 'running' });
const bundles = [{ id: 'b1', title: 'المسار', courses: [{ id: 'c-psy' }, { id: 'c-cbt' }] }];

test('a client seated for one of two courses still needs the other', { skip: !housing }, () => {
  const rounds = [round('1', 'c-psy', 'sara'), round('2', 'c-cbt'), round('3', 'c-psy')];
  const sara = { id: 'sara', enrolledCourseIds: ['c-psy', 'c-cbt'] };
  const need = housing.housingNeedOf(rounds, bundles, sara);
  assert.deepEqual(need.housedCourseIds, ['c-psy']);
  assert.deepEqual(need.roundCodes, ['R-1']);
  assert.deepEqual(need.missingCourseIds, ['c-cbt'], 'the course she booked and is not seated in');
  assert.equal(housing.isFullyHoused(need), false);
  assert.equal(housing.needsHousing(need), true, 'she is still in «غير مسكن»');
});

test('seated for every course that has a round is housed; seated nowhere is not', { skip: !housing }, () => {
  const rounds = [round('1', 'c-psy', 'sara'), round('2', 'c-cbt', 'sara')];
  const done = housing.housingNeedOf(rounds, bundles, { id: 'sara', enrolledCourseIds: ['c-psy', 'c-cbt'] });
  assert.equal(housing.isFullyHoused(done), true);
  assert.equal(housing.needsHousing(done), false);
  const nobody = housing.housingNeedOf(rounds, bundles, { id: 'omar', enrolledCourseIds: ['c-psy'] });
  assert.equal(housing.isFullyHoused(nobody), false);
  assert.equal(housing.needsHousing(nobody), true);
});

test('a course with no round cannot be missing, and a track counts for its courses', { skip: !housing }, () => {
  const rounds = [round('1', 'c-psy', 'sara')];
  // c-other has no round: nothing to seat her in.
  const sara = housing.housingNeedOf(rounds, bundles, { id: 'sara', enrolledCourseIds: ['c-psy', 'c-other'] });
  assert.deepEqual(sara.missingCourseIds, []);
  // A client holding the track holds both its courses; only one has a round seat.
  const track = housing.housingNeedOf([round('1', 'c-psy', 'hana'), round('2', 'c-cbt')], bundles, { id: 'hana', enrolledCourseIds: ['bundle:b1'] });
  assert.deepEqual(track.missingCourseIds, ['c-cbt']);
});

test('housed for a course means a round of THAT course, not any round', { skip: !housing }, () => {
  const rounds = [round('1', 'c-psy', 'sara')];
  assert.equal(housing.isHousedForCourse(rounds, 'sara', 'c-psy'), true);
  assert.equal(housing.isHousedForCourse(rounds, 'sara', 'c-cbt'), false);
  assert.equal(housing.isHousedForCourse(rounds, 'omar', 'c-psy'), false);
});

test('the schedule, both modals and the clients tab read housing per course', () => {
  const schedule = read('admin/pages/dashboard/tabs/DaqqiScheduleTab.tsx');
  assert.doesNotMatch(schedule, /assignedSubIds/, 'no more «anyone in any round»');
  assert.doesNotMatch(read('admin/pages/dashboard/tabs/daqqi/DaqqiAddClientsModal.tsx'), /assignedSubIds/);
  assert.doesNotMatch(read('admin/pages/dashboard/tabs/daqqi/DaqqiNewRoundModal.tsx'), /assignedSubIds/);
  // Both pickers ask the server for the clients not housed FOR the round's course
  // (api/lib/dokkiClients.js candidatesOf, pinned in dokkiClients.test.js).
  assert.match(read('admin/pages/dashboard/tabs/daqqi/DaqqiNewRoundModal.tsx'), /housing: 'unhoused', housedFor: round\.courseId/);
  assert.match(read('admin/pages/dashboard/tabs/daqqi/DaqqiAddClientsModal.tsx'), /housedFor: wantedCourse === 'all' \? '' : wantedCourse/);
  const tab = read('admin/pages/dashboard/tabs/OnlineClientsTab.tsx');
  assert.match(tab, /housingNeeds\.set\(subscriber\.id, housingNeedOf\(/);
  assert.match(tab, /daqqiHousingFilter === 'unhoused' && _need && !needsHousing\(_need\)/);
  assert.doesNotMatch(tab, /daqqiHousingFilter === 'unhoused' && housingMap\.has/);
  assert.match(read('admin/pages/dashboard/tabs/online-clients-sections/ClientsTable.tsx'), /🏠 جزئي/);
});

test('the server seats one client in one round and moves one seat — never every round of the client', () => {
  const lib = read('api/lib/daqqiHousing.js');
  assert.match(lib, /WHERE tenant_id=\? AND round_id=\? AND subscriber_id=\? LIMIT 1 FOR UPDATE/);
  const rounds = read('api/routes/daqqi-rounds.js');
  assert.match(rounds, /DELETE FROM daqqi_attendees WHERE tenant_id=\? AND round_id=\? AND subscriber_id=\?/);
  assert.doesNotMatch(rounds, /DELETE FROM daqqi_attendees WHERE tenant_id=\? AND subscriber_id=\?['"`]/, 'no delete across all of a client\'s rounds');
});
