'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');
const errorMonitor = require('../lib/errorMonitor');

test('incident webhook sends release-scoped JSON and accepts a 2xx response', async (t) => {
  let received;
  const server = http.createServer((req, res) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      received = JSON.parse(body);
      res.writeHead(204);
      res.end();
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());

  const previous = {
    url: process.env.ALERT_WEBHOOK_URL,
    release: process.env.APP_RELEASE,
    environment: process.env.NODE_ENV,
  };
  t.after(() => {
    if (previous.url === undefined) delete process.env.ALERT_WEBHOOK_URL;
    else process.env.ALERT_WEBHOOK_URL = previous.url;
    if (previous.release === undefined) delete process.env.APP_RELEASE;
    else process.env.APP_RELEASE = previous.release;
    if (previous.environment === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous.environment;
  });

  const address = server.address();
  process.env.ALERT_WEBHOOK_URL = `http://127.0.0.1:${address.port}/incident`;
  process.env.APP_RELEASE = 'uat-release';
  process.env.NODE_ENV = 'test';

  assert.equal(await errorMonitor.alert('UAT incident', { source: 'test' }), true);
  assert.equal(received.title, 'UAT incident');
  assert.equal(received.release, 'uat-release');
  assert.equal(received.environment, 'test');
  assert.equal(received.detail.source, 'test');
});
