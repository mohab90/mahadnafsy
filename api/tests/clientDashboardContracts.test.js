'use strict';
/**
 * Source-level contracts for screens the customer sees. Each of these was a
 * live defect: the page declared a field or a state the other side never
 * produced, and nothing failed loudly. Run: npm run test:unit
 */
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const root = path.join(__dirname, '..', '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');

// A comment naming the bug it removed will satisfy a doesNotMatch against the
// raw file. Every negative assertion below runs against code with the comments
// stripped out.
const codeOnly = source => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

test('«آخر المدفوعات» takes the newest payments, not the tail of a newest-first list', () => {
  const page = codeOnly(read('client', 'pages', 'UserDashboard.tsx'));
  assert.ok(page.includes('paymentHistory ?? []).slice(0, 5)'), 'takes the head of the list');
  assert.ok(!page.includes('slice(-5)'), 'the tail of a DESC list is the oldest five');
});

test('a live stream published to the whole community is visible to the whole community', () => {
  const page = codeOnly(read('client', 'pages', 'UserDashboard.tsx'));
  assert.ok(page.includes("ls.visibility === 'community_all' && subscriber) return true"));
});

test('a certificate counted as earned includes every state after issuing', () => {
  const lib = read('client', 'lib', 'certificateStatus.ts');
  for (const status of ['issued', 'shipped', 'at_branch', 'delivered']) {
    assert.ok(lib.includes(`'${status}'`), `${status} must count as earned`);
  }
  const page = codeOnly(read('client', 'pages', 'UserDashboard.tsx'));
  assert.ok(!page.includes("r.status === 'issued'"), 'the counter must not test one state');
  assert.ok(page.includes('isCertificateEarned(r.status)'));

  // Every status the column can hold needs a label, or the badge falls back to
  // «قيد المراجعة» on a certificate the customer is already holding.
  const tab = read('client', 'components', 'student-dashboard', 'StudentCertificatesTab.tsx');
  assert.ok(tab.includes('CERT_STATUS_META'));
  for (const status of ['pending', 'priced', 'paid', 'in_progress', 'not_sent',
    'issued', 'shipped', 'at_branch', 'delivered']) {
    assert.match(lib, new RegExp(`${status}:\\s+\\{ label:`), `${status} needs a label`);
  }
});

test("the community feed marks the viewer's own posts without poisoning the shared cache", () => {
  const route = read('api', 'routes', 'community.js');
  assert.match(route, /router\.get\('\/api\/community\/posts', publicLimiter, optionalAuth/);
  assert.ok(route.includes('isOwner: true'));
  // The personalised body must not be handed to a shared cache, and the cached
  // rows must be copied rather than marked in place.
  assert.ok(route.includes("res.set('Cache-Control', 'private, no-store')"));
  assert.ok(route.includes('{ ...post, isOwner: true }'));
});

test('a course with no original price shows neither a struck-out zero nor a discount badge', () => {
  for (const file of [
    ['client', 'pages', 'course-details-sections', 'CourseHeroSection.tsx'],
    ['client', 'pages', 'course-details-sections', 'MobileStickyCta.tsx'],
  ]) {
    const where = file.join('/');
    const source = codeOnly(read(...file));
    assert.ok(
      source.includes('const strikePrice = discountedPrice !== null ? currentPrice : oldPrice;'),
      where);
    assert.ok(source.includes('strikePrice > payPrice'), where);
    assert.ok(
      !/line-through[^\n]*discountedPrice !== null \? currentPrice : oldPrice/.test(source),
      `${where} still strikes a price it never compared`);
  }
});

test("a bundle with no price in the viewer's currency does not offer itself for sale", () => {
  const page = codeOnly(read('client', 'pages', 'BundleDetails.tsx'));
  assert.ok(page.includes('const priceAvailable = (bundle?.price?.[currency] ?? 0) > 0;'));
  assert.ok(page.includes('{priceAvailable ? ('), 'the price block is gated');
  assert.ok(page.includes('{priceAvailable && ('), 'the checkout buttons are gated');
});

test('an empty bundle catalogue reports itself empty instead of loading forever', () => {
  const page = codeOnly(read('client', 'pages', 'Bundles.tsx'));
  assert.ok(page.includes('remoteReady ? ('));
  assert.ok(page.includes('const { bundles, content, currency, remoteReady } = useSiteData();'));
});

test('a failed support rating tells the customer instead of doing nothing', () => {
  const page = codeOnly(read('client', 'pages', 'TicketRating.tsx'));
  assert.ok(page.includes('else setError('), 'a non-2xx response is reported');
  assert.ok(page.includes('catch { setError('), 'a network failure is reported');
  assert.ok(!page.includes('catch { /* ignore */ }'));
});

test('settings shows the reference support asks for, not a link that goes home', () => {
  const tab = codeOnly(read('client', 'components', 'student-dashboard', 'StudentSettingsTab.tsx'));
  assert.ok(!tab.includes('#/client/'),
    'the app is not hash-routed and /client/:code redirects home');
  assert.ok(tab.includes('{subscriber.clientCode}'));
});

test('the customer subscriber payload carries the fields the dashboard reads', () => {
  const mappers = read('api', 'lib', 'mappers.js');
  assert.match(mappers, /nameEn: r\.name_en \|\| crm\.nameEn \|\| null,/);
  assert.match(mappers, /installmentPlans: \(r\.installmentPlans \|\| \[\]\)\.map\(mapInstallmentPlan\),/);
  // The route has to fetch what the mapper now maps, or the field is always [].
  const route = read('api', 'routes', 'public.js');
  assert.match(route, /FROM installment_plans ip/);
  assert.match(route, /certRequests, installmentPlans \}\)/);
  assert.ok(route.includes("'created_at', 'updated_at', 'name_en',"));
});
