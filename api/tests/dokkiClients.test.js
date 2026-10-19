'use strict';

// «جدول الدقي» streamed the branch's whole client list into the browser to show two figures and fill two pickers; the
// server chooses the clients now (GET /api/admin/dokki/overview and /candidates, lib/dokkiClients.js). The rules are the
// screen's own written once more in JavaScript, so this runs both on the same clients: the housing and enrolment rules
// are the screen's live TypeScript, bundled; the two pickers' filters and the strip's «في الانتظار» are the code the
// screen ran until 19 Oct 2026, kept here word for word as the reference.

process.env.JWT_SECRET = process.env.JWT_SECRET || 'dokki-clients-test-secret-0123456789abcdef0123456789';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');

const ROOT = path.join(__dirname, '..', '..');
const { overviewOf, candidatesOf, readBranchFacts } = require('../lib/dokkiClients');

function bundleScreen() {
  let esbuild;
  try { esbuild = require(path.join(ROOT, 'admin', 'node_modules', 'esbuild')); } catch { return null; }
  const out = esbuild.buildSync({
    stdin: {
      contents: `
        export { isHousedForCourse, housingNeedOf, isFullyHoused } from './pages/dashboard/tabs/daqqi/daqqiHousingNeeds';
        export { isEnrolledInCourse } from './pages/dashboard/tabs/daqqi/daqqiScheduleUtils';
      `,
      resolveDir: path.join(ROOT, 'admin'), loader: 'ts',
    },
    bundle: true, write: false, format: 'cjs', platform: 'node', logLevel: 'silent',
    nodePaths: [path.join(ROOT, 'admin', 'node_modules')], define: { 'import.meta.env': '{}' },
  });
  const module = { exports: {} };
  new Function('module', 'exports', 'require', out.outputFiles[0].text)(module, module.exports, require);
  return module.exports;
}

function random(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const COURSES = ['c1', 'c2', 'c3', 'c4'];
function world(count = 500) {
  const next = random(20261019);
  const pick = list => list[Math.floor(next() * list.length)];
  const clients = Array.from({ length: count }, (_, i) => ({
    id: `s${i}`, name: pick(['أحمد علي', 'Omar Test', 'سارة', 'منى إبراهيم', 'Sara K']) + ` ${i}`, phone: pick(['01012345678', '+201112223334', '0555000111', '', null]),
    clientCode: pick([null, `C${100 + i}`]), createdAt: new Date(Date.UTC(2026, 9, 18 - (i % 90), 10)),
  }));
  const courses = new Map(clients.map(client => [client.id, new Set(COURSES.filter(() => next() < 0.3))]));
  const rounds = Array.from({ length: 9 }, (_, i) => ({
    id: `r${i}`, courseId: COURSES[i % 4], finished: i % 3 === 2,
    attendees: new Set(clients.filter(() => next() < 0.12).map(client => client.id)),
  }));
  return { clients, courses, rounds };
}

// The TypeScript side's view of the same world.
const screenRounds = facts => facts.rounds.map(round => ({
  id: round.id, code: round.id, courseId: round.courseId, status: round.finished ? 'finished' : 'active',
  attendees: [...round.attendees].map(subscriberId => ({ subscriberId })),
}));
const screenClients = facts => facts.clients.map(client => ({ ...client, enrolledCourseIds: [...(facts.courses.get(client.id) || [])] }));

test('the picker for a round, the picker for a new round and the strip choose the clients the screen chose', () => {
  const screen = bundleScreen();
  if (!screen) return;
  const facts = world();
  const rounds = screenRounds(facts);
  const subs = screenClients(facts);
  let compared = 0;

  // «إضافة عملاء للروند» (DaqqiAddClientsModal): the code the modal ran, word for word.
  for (const round of rounds) {
    for (const courseFilter of ['', 'all', 'c2']) {
      for (const housing of ['all', 'unhoused', 'housed']) {
        for (const search of ['', 'أحمد', 'omar', '0101', '1112223', 'c12', '55', 'zzz']) {
          const alreadyIn = new Set(round.attendees.map(a => a.subscriberId));
          const term = search.trim().toLowerCase();
          const digits = term.replace(/\D/g, '');
          const wantedCourse = courseFilter === '' ? round.courseId || '' : courseFilter;
          const available = subs.filter(s => {
            if (alreadyIn.has(s.id)) return false;
            if (wantedCourse !== 'all' && !screen.isEnrolledInCourse([], s.enrolledCourseIds || [], wantedCourse)) return false;
            const housedHere = wantedCourse !== 'all'
              ? screen.isHousedForCourse(rounds, s.id, wantedCourse)
              : screen.isFullyHoused(screen.housingNeedOf(rounds, [], s));
            if (housing === 'housed' && !housedHere) return false;
            if (housing === 'unhoused' && housedHere) return false;
            if (term) {
              const byName = String(s.name || '').toLowerCase().includes(term) || String(s.clientCode || '').toLowerCase().includes(term);
              const byPhone = digits.length >= 3 && String(s.phone || '').replace(/\D/g, '').includes(digits);
              if (!byName && !byPhone) return false;
            }
            return true;
          }).map(s => s.id);
          const got = candidatesOf(facts, {
            roundId: round.id, enrolled: wantedCourse === 'all' ? '' : wantedCourse, housing: housing === 'all' ? 'any' : housing,
            housedFor: wantedCourse === 'all' ? '' : wantedCourse, q: search,
          }).map(client => client.id);
          assert.deepEqual(got, available, `round ${round.id} course «${courseFilter}» ${housing} «${search}»`);
          compared += 1;
        }
      }
    }
  }

  // «اختر الحاضرين» of a new round (DaqqiNewRoundModal): the clients of a course not yet seated for it, or any not seated.
  for (const courseId of COURSES) {
    const filtered = subs.filter(s => !screen.isHousedForCourse(rounds, s.id, courseId) && screen.isEnrolledInCourse([], s.enrolledCourseIds || [], courseId)).map(s => s.id);
    const everyone = subs.filter(s => !screen.isHousedForCourse(rounds, s.id, courseId)).map(s => s.id);
    assert.deepEqual(candidatesOf(facts, { enrolled: courseId, housing: 'unhoused', housedFor: courseId }).map(c => c.id), filtered, `new round ${courseId}`);
    assert.deepEqual(candidatesOf(facts, { housing: 'unhoused', housedFor: courseId }).map(c => c.id), everyone, `new round, every course ${courseId}`);
    compared += 2;
  }
  assert.ok(compared > 500, `${compared} pickers compared`);

  // The strip (daqqiOverview's «في الانتظار»): who holds a course with an open round and sits in no round of it.
  const open = rounds.filter(round => (round.status || 'new') !== 'finished');
  const seatedIn = new Map();
  for (const round of rounds) {
    const seated = seatedIn.get(round.courseId) || new Set();
    round.attendees.forEach(a => seated.add(a.subscriberId));
    seatedIn.set(round.courseId, seated);
  }
  const openCourses = [...new Set(open.map(round => round.courseId))];
  const waiting = subs.filter(client => openCourses.some(courseId => !seatedIn.get(courseId)?.has(client.id)
    && screen.isEnrolledInCourse([], client.enrolledCourseIds || [], courseId))).length;
  assert.deepEqual(overviewOf(facts), { clients: subs.length, waiting });
  assert.ok(waiting > 0 && waiting < subs.length, 'the world has some waiting and some not');
});

test('the facts come from the branch\'s active clients, their enrolments, and the branch\'s rounds with who sits in them', async () => {
  const queries = [];
  const fakePool = {
    async query(sql, params) {
      queries.push({ sql, params });
      if (/FROM subscribers/.test(sql)) return [[{ id: 'a', name: 'A', phone: '1', client_code: 'C1', created_at: new Date() }, { id: 'b', name: 'B', phone: '2', client_code: null, created_at: new Date() }]];
      if (/FROM enrollments/.test(sql)) return [[{ subscriber_id: 'a', course_id: 'c1' }, { subscriber_id: 'a', course_id: 'c2' }, { subscriber_id: 'zzz', course_id: 'c1' }]];
      if (/FROM daqqi_rounds/.test(sql)) return [[{ id: 'r1', course_id: 'c1', status: 'ACTIVE' }, { id: 'r2', course_id: 'c2', status: 'FINISHED' }]];
      if (/FROM daqqi_attendees/.test(sql)) return [[{ round_id: 'r1', subscriber_id: 'b' }, { round_id: 'r9', subscriber_id: 'a' }]];
      return [[]];
    },
  };
  const facts = await readBranchFacts(fakePool, 't1', { where: 's.deleted_at IS NULL AND s.is_active = 1', params: [] }, 'DAQQI');
  assert.deepEqual(facts.clients.map(client => client.id), ['a', 'b']);
  assert.deepEqual([...facts.courses.get('a')], ['c1', 'c2']);
  assert.ok(!facts.courses.has('zzz') || queries.some(query => /IN \(/.test(query.sql)), 'a small branch asks for its own clients\' enrolments');
  assert.deepEqual(facts.rounds.map(round => [round.id, round.finished, [...round.attendees]]), [['r1', false, ['b']], ['r2', true, []]]);
  // a: holds c1 and c2, open course c1 only (r2 is finished) → waiting; b sits in r1 and holds nothing → not.
  assert.deepEqual(overviewOf(facts), { clients: 2, waiting: 1 });
  assert.ok(queries.every(query => /tenant_id/.test(query.sql)), 'every read names the tenant');
});

test('the endpoints are the schedule\'s own: its permission, its branch, its data scope', () => {
  const route = fs.readFileSync(path.join(ROOT, 'api/routes/admin/dokkiclients.js'), 'utf8');
  assert.match(route, /requirePermission\('manage_daqqi'\), requireDaqqiAccess\]/, 'the schedule\'s own gate');
  assert.match(route, /requestedBranch\(req\)/, 'a branch desk is confined to its branch');
  assert.match(route, /s\.is_active = 1 AND \(\$\{scope\.clause\}\)/, 'the population of the branch list, inside the data scope');
  assert.match(route, /figures:dokki-facts:/, 'held 15 s and dropped by the next write');
  const registered = fs.readFileSync(path.join(ROOT, 'api/routes/admin.js'), 'utf8');
  assert.match(registered, /require\('\.\/admin\/dokkiclients'\)/);
});

test('the route answers from a stubbed database', async () => {
  const path2 = require('node:path');
  const stub = (rel, exports) => {
    const resolved = require.resolve(path2.join(__dirname, rel));
    require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
  };
  const real = require('../lib/db');
  const fakePool = {
    async query(sql) {
      if (/FROM subscribers s\s+WHERE s\.tenant_id = \? AND \(/.test(sql)) {
        return [[1, 2, 3].map(n => ({ id: `s${n}`, name: `client ${n}`, phone: `010${n}`, client_code: `C${n}`, created_at: new Date() }))];
      }
      if (/FROM enrollments/.test(sql)) return [[{ subscriber_id: 's1', course_id: 'c1' }, { subscriber_id: 's2', course_id: 'c1' }]];
      if (/FROM daqqi_rounds/.test(sql)) return [[{ id: 'r1', course_id: 'c1', status: 'NEW' }]];
      return [[]];
    },
  };
  stub('../lib/db', { ...real, pool: fakePool, cached: async (_key, _ttl, load) => load() });
  const pass = (_req, _res, next) => next();
  const realAuth = require('../middleware/auth');
  stub('../middleware/auth', { ...realAuth, requireAuth: pass, requireAdminOrStaff: pass, requirePermission: () => pass, requireAnyPermission: () => pass });
  stub('../lib/daqqiAccess', { requireDaqqiAccess: pass, requireDaqqiManager: pass });
  // The shaping of the page is the clients list's own; here it is a stand-in that returns the ids it was given.
  const lists = require('../routes/admin/stafflists');
  lists.staffClientTools.loadShapedByIds = async (_tenant, ids) => ids.map(id => ({ id }));
  const router = require('../routes/admin/dokkiclients');
  async function get(url, req) {
    const app = express();
    app.use((request, _res, next) => { request.tenantId = 't1'; Object.assign(request, req); next(); });
    app.use(router);
    const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    try {
      const response = await fetch(`http://127.0.0.1:${server.address().port}${url}`);
      return { status: response.status, body: await response.json() };
    } finally { server.close(); }
  }
  const admin = { isSuperAdmin: true, staffRecord: null };
  assert.deepEqual((await get('/api/admin/dokki/overview?branch=DAQQI', admin)).body, { clients: 3, waiting: 2 });
  const page = (await get('/api/admin/dokki/candidates?branch=DAQQI&enrolled=c1&housing=unhoused&housedFor=c1&limit=1&offset=1', admin)).body;
  assert.deepEqual(page, { rows: [{ id: 's2' }], total: 2, ids: ['s1', 's2'] });
  // A Tagamoa desk cannot read Dokki's clients.
  const refused = await get('/api/admin/dokki/overview?branch=DAQQI', { isSuperAdmin: false, staffRecord: { id: 'x', role: 'reception_tagamoa' } });
  assert.equal(refused.status, 403);
  // A role with no client scope sees none.
  const none = await get('/api/admin/dokki/overview', { isSuperAdmin: false, staffRecord: { id: 'h', role: 'hr' } });
  assert.deepEqual(none.body, { clients: 0, waiting: 0 });
});
