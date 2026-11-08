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
    // `strikePrice > payPrice` was a *string* compare — the API sends prices as
    // DECIMAL strings — so «11500.00» was not greater than «5600.00» and ten
    // products showed no discount. isDiscounted coerces both sides; the rule
    // this test holds is unchanged: compare before you strike.
    assert.ok(source.includes('isDiscounted(strikePrice, payPrice)'), where);
    assert.ok(!/strikePrice > payPrice/.test(source),
      `${where} compares prices as text again`);
    assert.ok(
      !/line-through[^\n]*discountedPrice !== null \? currentPrice : oldPrice/.test(source),
      `${where} still strikes a price it never compared`);
  }
});







test('settings shows the reference support asks for, not a link that goes home', () => {
  const tab = codeOnly(read('client', 'components', 'student-dashboard', 'StudentSettingsTab.tsx'));
  assert.ok(!tab.includes('#/client/'),
    'the app is not hash-routed and /client/:code redirects home');
  assert.ok(tab.includes('{subscriber.clientCode}'));
});


