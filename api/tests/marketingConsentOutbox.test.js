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

test('consent changes lock a tenant subject and audit suppression transactionally', () => {
  const service = read('lib/marketingConsent.js');
  const migration = read('migrations/082_v25_marketing_consent_outbox.sql');
  assert.match(service, /WHERE id=\? AND tenant_id=\? LIMIT 1 FOR UPDATE/);
  assert.match(service, /INSERT INTO marketing_suppressions/);
  assert.match(service, /INSERT INTO marketing_consent_audit/);
  assert.match(service, /await conn\.rollback\(\)/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS marketing_suppressions/);
  assert.match(migration, /PRIMARY KEY \(tenant_id, channel, destination_hash\)/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS marketing_consent_audit/);
});

test('campaigns are tenant scoped, consent filtered and use the durable outbox', () => {
  const route = read('routes/campaigns.js');
  assert.match(route, /api\/public\/marketing\/unsubscribe/);
  assert.match(route, /verifyUnsubscribeToken[\s\S]*consent\.tenantId !== req\.tenantId/);
  assert.match(route, /INSERT INTO email_campaigns \(id,tenant_id/);
  assert.match(route, /FROM email_campaigns WHERE id=\? AND tenant_id=\? LIMIT 1 FOR UPDATE/);
  assert.match(route, /FROM subscribers WHERE tenant_id=\?[\s\S]*filterSuppressed\(req\.tenantId, 'email'/);
  assert.match(route, /outbox\.enqueue\([\s\S]*refType: 'email_campaign'/);
  assert.match(route, /INSERT INTO sms_campaigns \(id,tenant_id/);
  assert.match(route, /FROM sms_campaigns WHERE id=\? AND tenant_id=\? LIMIT 1 FOR UPDATE/);
  assert.match(route, /filterSuppressed\(req\.tenantId, 'sms'/);
  assert.match(route, /refType: 'sms_campaign'/);
  assert.doesNotMatch(route, /Mark as sent immediately/);
});

test('message outbox claims concurrently, retries and scopes every completion by tenant', () => {
  const outbox = read('lib/outbox.js');
  const migration = read('migrations/082_v25_marketing_consent_outbox.sql');
  assert.match(outbox, /LIMIT \? FOR UPDATE/);
  assert.match(outbox, /status='processing',locked_at=NOW\(\),locked_by=\?/);
  assert.match(outbox, /WHERE id=\? AND tenant_id=\? AND locked_by=\?/);
  assert.match(outbox, /dead \? 'dead' : 'failed'/);
  assert.match(migration, /uq_message_outbox_tenant_dedupe \(tenant_id, dedupe_key\)/);
  assert.match(migration, /ENUM\('email','whatsapp','sms','push'\)/);
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
