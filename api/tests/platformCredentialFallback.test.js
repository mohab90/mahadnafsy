'use strict';
// The provider credentials in the environment belong to the original institute:
// its WhatsApp number, its Facebook page, its Paymob account. Another institute
// that has not set up its own used to fall back to them — its OTPs and
// campaigns went out from somebody else's company number, and its Facebook
// leads were fetched with somebody else's page token. Only the original
// institute may fall back now.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.WHATSAPP_TOKEN = 'platform-token';
process.env.WHATSAPP_PHONE_ID = '123456';
const { platformFallback, DEFAULT_TENANT_ID } = require('../lib/tenantScope');
const { forTenant, providerCredentialState, resolveProvider } = require('../lib/whatsapp');

test('only the original institute falls back to the environment', () => {
  assert.equal(platformFallback(DEFAULT_TENANT_ID, 'secret'), 'secret');
  assert.equal(platformFallback(undefined, 'secret'), 'secret');
  assert.equal(platformFallback('tenant-other', 'secret'), undefined);
});

test("another institute's WhatsApp config does not borrow the company number", () => {
  assert.equal(providerCredentialState(forTenant({}, DEFAULT_TENANT_ID)).metaReady, true);
  const other = forTenant({}, 'tenant-other');
  assert.equal(providerCredentialState(other).metaReady, false);
  assert.notEqual(resolveProvider(other), 'meta');
  // Its own credentials still work.
  assert.equal(providerCredentialState(forTenant({ metaToken: 't', metaPhoneId: '9' }, 'tenant-other')).metaReady, true);
});

test('no provider credential is read from the environment without the tenant gate', () => {
  const API = path.join(__dirname, '..');
  const CREDENTIALS = /process\.env\.(WHATSAPP_TOKEN|WHATSAPP_PHONE_ID|WHATSAPP_WABA_ID|WA_INSTANCE_ID|WA_API_TOKEN|ULTRAMSG_INSTANCE_ID|ULTRAMSG_TOKEN|FB_APP_SECRET|FB_PAGE_TOKEN|FB_VERIFY_TOKEN|PAYMOB_HMAC_SECRET)\b/g;
  const offenders = [];
  for (const dir of ['lib', 'routes']) {
    const walk = d => fs.readdirSync(d, { withFileTypes: true }).forEach(e => {
      const full = path.join(d, e.name);
      if (e.isDirectory()) return walk(full);
      if (!e.name.endsWith('.js')) return;
      const src = fs.readFileSync(full, 'utf8');
      for (const m of src.matchAll(CREDENTIALS)) {
        const line = src.slice(src.lastIndexOf('\n', m.index) + 1, src.indexOf('\n', m.index));
        if (/platformFallback\(|^\s*(\/\/|\*)|logger\.warn|configuredInstance|^if \(!process\.env/.test(line)) continue;
        offenders.push(`${path.relative(API, full)}: ${line.trim()}`);
      }
    });
    walk(path.join(API, dir));
  }
  assert.deepEqual(offenders, []);
});
