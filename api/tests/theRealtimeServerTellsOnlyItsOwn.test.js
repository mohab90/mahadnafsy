'use strict';

// HIGH-08 / MED-30 of the 7 Oct 2026 audit: the realtime server (ws-server)
// ran on a published fallback secret, took a token under any algorithm, never
// asked whether the session was still alive, and sent every event to every
// connected account of every tenant — admin edits included. It is not deployed;
// these keep it safe for the day it is.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..', '..');
const SERVER = path.join(ROOT, 'ws-server', 'server.js');
const API_MODULES = path.join(ROOT, 'api', 'node_modules');
const jwt = require('jsonwebtoken');

test('without its secrets it does not start', () => {
  const run = spawnSync(process.execPath, [SERVER], { env: { PATH: process.env.PATH }, encoding: 'utf8' });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /JWT_SECRET is not set/);
});

// socket.io is the server's own dependency and not installed here: a stand-in
// records what the server asks of it.
const sent = [];
let guard = null;
class FakeServer {
  use(fn) { guard = fn; }
  on() {}
  to(room) { return { emit: (event, payload) => sent.push({ room, event, payload }) }; }
}
const resolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  if (request === 'socket.io') return 'fake-socket.io';
  if (parent && parent.filename === SERVER && ['express', 'cors', 'jsonwebtoken'].includes(request)) {
    return resolve.call(this, request, parent, false, { paths: [API_MODULES] });
  }
  return resolve.call(this, request, parent, ...rest);
};
require.cache['fake-socket.io'] = { id: 'fake-socket.io', filename: 'fake-socket.io', loaded: true, exports: { Server: FakeServer } };

const SECRET = 'test-only-ws-secret-0123456789-abcdefghijklmnopqrstu';
Object.assign(process.env, { JWT_SECRET: SECRET, WS_INTERNAL_SECRET: 'internal-1', MAHAD_API_URL: 'http://api.test', WS_PORT: '0' });
let alive = true;
const realFetch = global.fetch;
global.fetch = async (url, init) => {
  if (String(url).startsWith('http://api.test/')) {
    assert.equal(String(url), 'http://api.test/api/auth/me');
    assert.match(init.headers.authorization, /^Bearer /);
    return { ok: alive };
  }
  return realFetch(url, init);
};
const { server } = require(SERVER);
test.after(() => server.close());

async function emit(body, secret = 'internal-1') {
  const { port } = server.address();
  const response = await realFetch(`http://127.0.0.1:${port}/emit`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-internal-secret': secret }, body: JSON.stringify(body),
  });
  return response.status;
}

test('an event goes to the room it names, and one naming none goes nowhere', async () => {
  await new Promise(done => (server.listening ? done() : server.once('listening', done)));
  sent.length = 0;
  assert.equal(await emit({ event: 'admin:mutation', payload: { a: 1 } }), 400);
  assert.equal(await emit({ event: 'admin:mutation', room: 'staff:tenant-default' }, 'wrong'), 401);
  assert.equal(await emit({ event: 'admin:mutation', room: 'staff:tenant-default' }), 200);
  assert.deepEqual(sent.map(item => item.room), ['staff:tenant-default']);
});

async function connect(token) {
  const rooms = [];
  const socket = { handshake: { headers: { cookie: `authToken=${encodeURIComponent(token)}` }, auth: {} }, join: room => rooms.push(room) };
  const error = await new Promise(done => guard(socket, done));
  return { error, rooms };
}

test('a student joins their own rooms, staff their tenant\'s staff room', async () => {
  const student = await connect(jwt.sign({ uid: 'u-1', email: 'A@x.test', tid: 't-1', stf: false }, SECRET, { algorithm: 'HS256' }));
  assert.equal(student.error, undefined);
  assert.deepEqual(student.rooms.sort(), ['tenant:t-1', 'user:a@x.test', 'user:u-1']);
  const staff = await connect(jwt.sign({ uid: 'u-2', tid: 't-1', stf: true }, SECRET, { algorithm: 'HS256' }));
  assert.ok(staff.rooms.includes('staff:t-1'));
});

test('a token under another algorithm, or of an ended session, is refused', async () => {
  const other = jwt.sign({ uid: 'u-1', tid: 't-1' }, SECRET, { algorithm: 'HS512' });
  assert.match(String((await connect(other)).error), /invalid token/);
  alive = false;
  const ended = await connect(jwt.sign({ uid: 'u-1', tid: 't-1' }, SECRET, { algorithm: 'HS256' }));
  alive = true;
  assert.match(String(ended.error), /session ended/);
  assert.deepEqual(ended.rooms, []);
});

test('the API never sends an event without a room', async () => {
  process.env.WS_SERVER_URL = 'http://ws.test';
  const { publishRealtimeEvent } = require('../lib/realtime');
  const result = await publishRealtimeEvent('admin:mutation', {});
  assert.equal(result.reason, 'room is required');
});
