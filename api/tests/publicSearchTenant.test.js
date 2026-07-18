'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const publicRoute = fs.readFileSync(path.join(__dirname, '..', 'routes', 'public.js'), 'utf8');
const studentAiRoute = fs.readFileSync(path.join(__dirname, '..', 'routes', 'student-ai.js'), 'utf8');

test('public search scopes every searchable catalogue source to the resolved tenant', () => {
  assert.match(publicRoute, /router\.get\('\/api\/search'/);
  assert.match(publicRoute, /FROM courses[\s\S]*WHERE tenant_id=\? AND is_published=1/);
  assert.match(publicRoute, /FROM bundles[\s\S]*WHERE tenant_id=\? AND is_published=1/);
  assert.match(publicRoute, /\[req\.tenantId, like, like, like\]/);
  assert.match(publicRoute, /\[req\.tenantId, like, like\]/);
});

test('student AI context cannot resolve subscriber or courses globally', () => {
  assert.match(studentAiRoute, /WHERE tenant_id=\? AND LOWER\(TRIM\(email\)\)/);
  assert.match(studentAiRoute, /FROM courses WHERE tenant_id=\? AND id IN/);
  assert.match(studentAiRoute, /loadSubscriberContext\(req\.user\?\.email, req\.tenantId\)/);
});

test('certificate QR is generated locally without leaking certificate data to an external service', () => {
  assert.match(publicRoute, /router\.get\('\/api\/qr'/);
  assert.match(publicRoute, /QRCode\.toString/);
  assert.match(publicRoute, /const qrUrl\s+= `\/api\/qr\?size=90&data=\$\{qrData\}`/);
  assert.doesNotMatch(publicRoute, /api\.qrserver\.com/);
});
