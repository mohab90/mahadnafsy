'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const guard = fs.readFileSync(path.join(__dirname, '..', 'lib', 'productionRuntimeGuard.js'), 'utf8');

test('runtime restart ownership is delegated without mutating host process-manager state', () => {
  assert.match(server, /startProductionRuntimeGuard\(\{ logger \}\)/);
  assert.match(guard, /process\.env\.NODE_ENV !== 'production'/);
  assert.match(guard, /interval\.unref/);
  assert.doesNotMatch(guard, /writeFileSync|appendFileSync|crontab|dump\.pm2|supervisor\.js/);
  assert.doesNotMatch(server, /writeFileSync|crontab|dump\.pm2/);
});
