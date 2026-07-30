'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { wrapAsyncRouteHandlers } = require('../lib/registerRoutes');

test('central route registration forwards rejected async endpoints to Express error handling', async () => {
  const router = express.Router();
  const expected = new Error('database unavailable');
  router.get('/failure', async () => { throw expected; });

  wrapAsyncRouteHandlers(router);
  const handler = router.stack[0].route.stack[0].handle;
  let received;
  await handler({}, {}, error => { received = error; });

  assert.equal(received, expected);
});

test('central async boundary also traverses nested routers', async () => {
  const child = express.Router();
  child.post('/failure', async () => { throw new Error('nested failure'); });
  const parent = express.Router();
  parent.use('/child', child);

  wrapAsyncRouteHandlers(parent);
  const handler = child.stack[0].route.stack[0].handle;
  let received;
  await handler({}, {}, error => { received = error; });

  assert.equal(received?.message, 'nested failure');
});
