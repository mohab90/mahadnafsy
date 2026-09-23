'use strict';
// Fixed action buttons must not sit on top of the last row of the page.
//
// Two buttons are pinned at bottom-6 on every public page and one on every
// admin screen. Nothing reserved that space, so on a phone the public
// copyright line rendered 48px underneath them and the admin's pagination row
// sat under «حجز / دفعة» — «السابق» and the page numbers could not be tapped
// at all on العملاء المحتملين.
//
// The padding is phone-only on purpose. At 1280 the buttons occupy 24-80 and
// 1113-1248 while the centred copyright text runs 473-799, so nothing collides
// and padding the desktop would only add dead space. Measuring the element's
// box says otherwise — it is full-width — which is why that was checked with a
// Range over the text.
//
// And the admin has to declare an icon: /favicon.ico and /manifest.json both
// answered 200 by falling through to the SPA rewrite, handing back index.html
// as text/html, so the tab showed a browser default and a home-screen install
// produced a blank placeholder.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const read = rel => fs.readFileSync(path.join(root, ...rel.split('/')), 'utf8');

test('the public footer clears the floating buttons on phones only', () => {
  const footer = read('client/components/Footer.tsx');
  // Both variants: the mini one used on dashboard/payment pages and the full one.
  assert.match(footer, /pt-3 pb-24 sm:pb-3/, 'the mini footer lost its phone clearance');
  assert.match(footer, /pt-16 pb-28 sm:pb-8/, 'the full footer lost its phone clearance');
  assert.doesNotMatch(footer, /className="bg-gray-900 border-t border-gray-800 py-3 /,
    'the mini footer is back to uniform py-3, which puts the copyright under the buttons');
});

test('the dashboard clears its booking button on phones only', () => {
  const dashboard = read('admin/pages/Dashboard.tsx');
  // The bottom is the part that matters and the part this test is named after:
  // «حجز / دفعة» is fixed at bottom-6 and 44px tall, so it owns the bottom 68px
  // of a phone viewport. pb-28 clears it; md:pb-8 puts the normal padding back
  // where the button no longer overlaps the content column.
  //
  // This used to pin «py-6 pb-28 md:py-8 md:pb-8» whole, which made it fail
  // when the top padding was trimmed to bring the nav closer to the top edge —
  // a change with nothing to do with the button it guards.
  assert.match(dashboard, /pb-28/,
    'the dashboard shell lost the padding that keeps «حجز / دفعة» off the last row');
  assert.match(dashboard, /md:pb-8/,
    'and the desktop padding that replaces it above the breakpoint');
});

test('sub-pixel overflow from the decorations cannot scroll the page', () => {
  const css = read('client/index.css');
  // At 768 the page measured 763 against a 760 viewport and really did scroll.
  assert.match(css, /html,\s*\n\s*body \{\s*\n\s*@apply overflow-x-hidden;/,
    'the html/body overflow-x clamp is gone');
});

test('the admin declares its own icon, manifest and theme colour', () => {
  const html = read('admin/index.html');
  assert.match(html, /<link rel="icon" type="image\/svg\+xml" href="\/favicon\.svg"/);
  assert.match(html, /<link rel="apple-touch-icon"/);
  assert.match(html, /<link rel="manifest" href="\/manifest\.json"/);
  assert.match(html, /<meta name="theme-color"/);
  assert.match(html, /viewport-fit=cover/, 'the admin no longer handles the notch');

  // And the files it points at have to exist, or the declarations fall back to
  // the SPA rewrite exactly as before.
  assert.ok(fs.existsSync(path.join(root, 'admin', 'public', 'favicon.svg')));
  const manifest = JSON.parse(read('admin/public/manifest.json'));
  assert.ok(manifest.name && manifest.icons?.length, 'the admin manifest is empty');
});
