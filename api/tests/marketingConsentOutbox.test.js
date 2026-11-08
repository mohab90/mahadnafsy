'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('unsubscribe tokens are signed, tenant bound, expiring and tamper evident', () => {
  const previous = process.env.MARKETING_TOKEN_SECRET;
  process.env.MARKETING_TOKEN_SECRET = 'test-secret-that-is-at-least-thirty-two-characters';
  const modulePath = require.resolve('../lib/marketingConsent');
  delete require.cache[modulePath];
  const { createUnsubscribeToken, verifyUnsubscribeToken } = require('../lib/marketingConsent');
  const token = createUnsubscribeToken({ tenantId: 'tenant-a', subjectType: 'lead', subjectId: 'lead-1', channel: 'email' });
  assert.deepEqual(verifyUnsubscribeToken(token).tenantId, 'tenant-a');
  assert.throws(() => verifyUnsubscribeToken(`${token}x`), /Invalid unsubscribe token/);
  const expired = createUnsubscribeToken({ tenantId: 'tenant-a', subjectType: 'lead', subjectId: 'lead-1', channel: 'email', expiresInDays: -1 });
  assert.throws(() => verifyUnsubscribeToken(expired), /Expired or invalid/);
  if (previous === undefined) delete process.env.MARKETING_TOKEN_SECRET; else process.env.MARKETING_TOKEN_SECRET = previous;
});







test('tenant webhooks reject private-network SSRF targets', async () => {
  const { assertSafeWebhookUrl, isPrivateAddress } = require('../lib/webhookSecurity');
  assert.equal(isPrivateAddress('127.0.0.1'), true);
  assert.equal(isPrivateAddress('10.1.2.3'), true);
  assert.equal(isPrivateAddress('169.254.169.254'), true);
  assert.equal(isPrivateAddress('8.8.8.8'), false);
  await assert.rejects(() => assertSafeWebhookUrl('http://127.0.0.1/admin'), /Private webhook/);
  await assert.rejects(() => assertSafeWebhookUrl('https://localhost/'), /Private webhook/);
  const route = read('routes/campaigns.js');
  assert.match(route, /FROM webhooks WHERE tenant_id=\?/);
  assert.match(route, /assertSafeWebhookUrl\(wh\.url\)/);
  assert.match(route, /UPDATE webhooks SET last_triggered_at=NOW\(\),last_status=\? WHERE id=\? AND tenant_id=\?/);
});
