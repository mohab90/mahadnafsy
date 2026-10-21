'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const lifecycleSource = fs.readFileSync(path.join(__dirname, '..', 'lib', 'processLifecycle.js'), 'utf8');

test('server delegates process error and shutdown ownership to one lifecycle module', () => {
  assert.match(serverSource, /registerProcessLifecycle\(\{ logger, pool \}\)/);
  assert.match(serverSource, /processLifecycle\.setHttpServer\(server\)/);
  assert.doesNotMatch(serverSource, /process\.on\('SIGTERM'/);
  assert.match(lifecycleSource, /proc\.on\('uncaughtException'/);
  assert.match(lifecycleSource, /proc\.on\('unhandledRejection'/);
  assert.match(lifecycleSource, /proc\.on\('SIGTERM'/);
  assert.match(lifecycleSource, /httpServer\.close/);
  assert.match(lifecycleSource, /pool\.end\(\)/);
});

const { EventEmitter } = require('node:events');
const { registerProcessLifecycle } = require('../lib/processLifecycle');

function harness() {
  const proc = new EventEmitter();
  const exits = [];
  const logger = { info() {}, warn() {}, error() {} };
  let ended = false;
  const pool = { end: async () => { ended = true; } };
  const lifecycle = registerProcessLifecycle({ logger, pool, proc, exit: code => exits.push(code) });
  let closed = false;
  lifecycle.setHttpServer({ close: cb => { closed = true; setImmediate(cb); } });
  return { proc, exits, state: () => ({ ended, closed }) };
}

test('an uncaught exception drains the server and exits non-zero instead of carrying on', async () => {
  const { proc, exits, state } = harness();
  proc.emit('uncaughtException', new Error('boom'));
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.deepEqual(state(), { ended: true, closed: true });
  assert.deepEqual(exits, [1]);
});

test('an unhandled rejection is logged and the process keeps running', async () => {
  const { proc, exits } = harness();
  proc.emit('unhandledRejection', new Error('transient'));
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.deepEqual(exits, []);
});

test('SIGTERM still drains and exits cleanly', async () => {
  const { proc, exits } = harness();
  proc.emit('SIGTERM');
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.deepEqual(exits, [0]);
});
