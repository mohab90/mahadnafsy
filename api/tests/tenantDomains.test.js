'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  createDomainChallenge,
  normalizeDomain,
  verifyDnsOwnership,
} = require('../lib/tenantDomains');

const read = relative => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');

test('custom domain normalization accepts public DNS names and rejects local/invalid hosts', () => {
  assert.equal(normalizeDomain('https://Academy.Example.com/'), 'academy.example.com');
  assert.throws(() => normalizeDomain('localhost'), /Invalid public domain/);
  assert.throws(() => normalizeDomain('127.0.0.1'), /Invalid public domain/);
  assert.throws(() => normalizeDomain('bad_domain.example'), /Invalid public domain/);
});

test('DNS challenge proves control without storing or returning the raw token later', async () => {
  const challenge = createDomainChallenge('academy.example.com');
  assert.equal(challenge.recordName, '_mahad-verify.academy.example.com');
  assert.match(challenge.recordValue, /^mahad-verification=[a-f0-9]{48}$/);
  assert.equal(await verifyDnsOwnership(
    challenge.domain,
    challenge.tokenHash,
    async name => {
      assert.equal(name, challenge.recordName);
      return [[challenge.recordValue]];
    }
  ), true);
  assert.equal(await verifyDnsOwnership(
    challenge.domain,
    challenge.tokenHash,
    async () => [['mahad-verification=wrong']]
  ), false);
});

test('only verified domains enter tenant routing and branding/email identity', () => {
  const context = read('middleware/tenantContext.js');
  const brand = read('lib/brandSettings.js');
  const email = read('lib/email.js');
  assert.match(context, /FROM tenant_domains WHERE status='verified'/);
  assert.match(context, /index\.byDomain/);
  assert.match(brand, /tenant_domains WHERE tenant_id=\? AND status='verified'/);
  assert.match(email, /href="\$\{c\.websiteUrl\}"/);
});

test('tenant domain workflow is permissioned, audited and cache coherent', () => {
  const route = read('routes/tenant-domains.js');
  assert.ok((route.match(/requirePermission\('manage_settings'\)/g) || []).length >= 4);
  assert.match(route, /tenant\.domain\.verification_requested/);
  assert.match(route, /tenant\.domain\.verified/);
  assert.match(route, /cacheInvalidate\('tenant_index'\)/);
  assert.match(route, /DOMAIN_IN_USE/);
});

test('sender identity cannot claim an unrelated unverified domain', () => {
  const config = read('routes/config.js');
  assert.match(config, /UNVERIFIED_SENDER_DOMAIN/);
  assert.match(config, /senderDomain !== smtpDomain && senderDomain !== verifiedDomain\?\.domain/);
});
