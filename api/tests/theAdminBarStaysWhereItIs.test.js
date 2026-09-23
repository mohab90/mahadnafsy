'use strict';

// The bar across the top of the panel: the institute's own mark, and it follows
// you down the page.
//
// It carried a shield glyph, the words «لوحة الإدارة», and a pulsing «متصل»
// underneath — three lines of furniture telling somebody already inside the
// panel that they were inside the panel, in the space where the logo belongs.
// And it scrolled away, so on any long screen — the leads table, the client
// database, a financial report — moving between sections meant scrolling back
// to the top first.
//
// «متصل» was also a link, to the security centre. That screen is still in its
// own menu (الإعدادات ← الأمان والصيانة), which is the part that matters and is
// asserted below: a shortcut can be removed, a only-way-in cannot.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const NAV = 'admin/pages/dashboard/DashboardNavigation.tsx';
const source = read(NAV);

// Comments are blanked before the two "this text is gone" assertions below.
// The comment left in the code explaining what was removed necessarily names
// the thing it removed, and an assertion its own explanation can trip is not an
// assertion about the code — a mistake this suite has made more than once.
const codeOnly = source
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .split('\n')
  .map(line => (/^\s*(\/\/|\*)/.test(line) ? '' : line.replace(/(^|[^:])\/\/.*$/, '$1')))
  .join('\n');

test('the brand is the institute mark, not a label', () => {
  assert.ok(!codeOnly.includes('لوحة الإدارة'),
    'the panel does not need to tell the person using it what it is');
  assert.ok(!codeOnly.includes('متصل'), 'nor that the server is up, permanently, in the corner');
  assert.match(codeOnly, /content\['institute\.logo'\]/,
    'the same key the site header and the certificates use');
});

test('a tenant with no logo set still gets a bar', () => {
  // An <img> with an empty src is a broken image where the brand should be.
  const brand = codeOnly.slice(codeOnly.indexOf('logoUrl ?'), codeOnly.indexOf('logoUrl ?') + 700);
  assert.ok(codeOnly.includes('logoUrl ?'), 'the mark is conditional on there being one');
  assert.match(brand, /Shield/, 'and the old glyph is what it falls back to');
  assert.match(codeOnly, /\|\| ''\)\.trim\(\)/,
    'whitespace-only is not a logo either');
});

test('the bar follows the page down', () => {
  // Both bars: the grouped one the managers see and the compact one every
  // other role gets. One sticky and one not would be the odd kind of fixed.
  const sticky = source.match(/sticky top-3 z-40/g) || [];
  assert.ok(sticky.length >= 2,
    `the main bar and CompactRoleNav should both stick; found ${sticky.length}`);
});

test('and it stays under anything that opens over it', () => {
  // shared/ui/Modal draws at z-50, z-[60] and z-[80]. A nav above those would
  // sit on top of every dialog in the panel.
  const layers = read('shared/ui/Modal.tsx');
  assert.match(layers, /base: 'z-50'/, 'the floor this has to stay below');
  assert.ok(!/sticky top-3 z-(5[0-9]|[6-9][0-9]|\[)/.test(source),
    'the bar must not be drawn above the dialog layer');
});

test('an open menu does not detach when the page moves', () => {
  // The dropdown is positioned once, from the button's rectangle, and drawn
  // fixed. That was survivable while the bar scrolled away with it; now the bar
  // stays and the menu would be left behind on the page.
  assert.match(source, /addEventListener\('scroll'/,
    'a menu opened at one scroll position must not hang there at another');
});

test('the security centre is still reachable without that shortcut', () => {
  const nav = read('admin/pages/dashboard/navigation.tsx');
  assert.match(nav, /key: 'security_center', label: 'الأمان والصيانة'/,
    'removing the «متصل» link is only safe because this exists');
});

test('the mark, not the wordmark', () => {
  // «خليه الدائرة فقط مش لازم الاسم». The institute's logo is the name beside a
  // red roundel, and in a bar that needs its width for the menu the name is the
  // half worth dropping. The roundel already exists as its own square asset —
  // institute.favicon — so this is a different key rather than a crop tuned to
  // one image, which would break the moment somebody uploads a new logo.
  assert.match(codeOnly, /content\['institute\.favicon'\]/,
    'the favicon is the mark on its own');
  assert.match(codeOnly, /institute\.favicon'\][\s\S]{0,60}institute\.logo'\]/,
    'falling back to the full logo for a tenant that has no favicon set');
});

test('the menu starts straight after the mark', () => {
  // A divider between the brand and the first group was costing width in the
  // one place there is none to spare.
  const bar = codeOnly.slice(codeOnly.indexOf('{/* Brand'), codeOnly.indexOf('Group nav buttons'));
  assert.ok(!/w-px h-5 bg-gray-200/.test(bar),
    'nothing between the mark and the first group');
});

test('the two longest labels are shortened in the bar only', () => {
  // «استبدل كلمه خدمه ب خ وكمله الموارد ب م» — in the bar. The dropdown that
  // opens underneath has room, and «خ العملاء» as a panel heading reads like a
  // typo, so the full name stays there.
  const nav = read('admin/pages/dashboard/navigation.tsx');
  assert.match(nav, /label: 'خدمة العملاء',[\s\S]{0,300}short: 'خ العملاء'/);
  assert.match(nav, /label: 'الموارد البشرية',[\s\S]{0,80}short: 'م البشرية'/);
  assert.match(codeOnly, /group\.short \|\| group\.label/, 'the bar prefers the short one');
  assert.match(codeOnly, /\{group\.label\}/, 'and the dropdown header keeps the full one');
});
