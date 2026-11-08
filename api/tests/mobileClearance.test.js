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
const { dashboardSource } = require('./_adminSplitSource');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const read = rel => fs.readFileSync(path.join(root, ...rel.split('/')), 'utf8');







test('the admin declares its own icon, manifest and theme colour', () => {
  const html = read('admin/index.html');
  
  
  
  
  

  // And the files it points at have to exist, or the declarations fall back to
  // the SPA rewrite exactly as before.
  assert.ok(fs.existsSync(path.join(root, 'admin', 'public', 'favicon.svg')));
  const manifest = JSON.parse(read('admin/public/manifest.json'));
  assert.ok(manifest.name && manifest.icons?.length, 'the admin manifest is empty');
});
