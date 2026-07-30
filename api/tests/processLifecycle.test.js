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
  assert.match(lifecycleSource, /process\.on\('uncaughtException'/);
  assert.match(lifecycleSource, /process\.on\('unhandledRejection'/);
  assert.match(lifecycleSource, /process\.on\('SIGTERM'/);
  assert.match(lifecycleSource, /httpServer\.close/);
  assert.match(lifecycleSource, /pool\.end\(\)/);
});
