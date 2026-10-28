'use strict';

// «جزء اوفر 24 ساعه مش بقدر اغير واشغل العدادات … محتاجك تخليه في قسم التسويق
// الخصومات واقدر اتحكم فيه كليا … وبوب اب بخصم معين يظهر لكل العملاء».
//
// The home page's timed offer and a site-wide pop-up are both plain content
// keys, controlled from التسويق ← الخصومات. These pin the rules the site and
// the admin share (shared/siteOffers.ts) and that both surfaces use them.
//
// Run: npm run test:unit

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

const load = () => {
  const js = require('node:module').stripTypeScriptTypes(read('shared/siteOffers.ts')).replace(/^export /gm, '');
  const module_ = { exports: {} };
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', `${js}\nmodule.exports = { offerEnabled, offerHours, offerRemainingMs, offerIsOver, offerIsShown, offerPrices, popupIsLive, popupWasSeen, popupFrequency, popupTheme };`)(module_, module_.exports);
  return module_.exports;
};
const HOUR = 3600_000;
const T0 = Date.parse('2026-10-16T10:00:00.000Z');

test('the offer is on until marketing switches it off', () => {
  const { offerEnabled } = load();
  assert.equal(offerEnabled({}), true);
  assert.equal(offerEnabled({ 'offer.enabled': '1' }), true);
  assert.equal(offerEnabled({ 'offer.enabled': '0' }), false);
});

test('the countdown runs for the hours marketing set, 24 by default', () => {
  const { offerHours, offerRemainingMs, offerIsOver, offerIsShown } = load();
  const started = new Date(T0).toISOString();
  assert.equal(offerHours({}), 24);
  assert.equal(offerHours({ 'offer.durationHours': '48' }), 48);
  assert.equal(offerHours({ 'offer.durationHours': 'abc' }), 24);
  assert.equal(offerHours({ 'offer.durationHours': '99999' }), 720, 'capped at thirty days');

  assert.equal(offerRemainingMs({}, T0), null, 'nobody started one: no countdown');
  assert.equal(offerRemainingMs({ 'offer.timerStartedAt': started }, T0 + 10 * HOUR), 14 * HOUR);
  assert.equal(offerRemainingMs({ 'offer.timerStartedAt': started, 'offer.durationHours': '48' }, T0 + 10 * HOUR), 38 * HOUR);

  // Run out → the offer leaves the page rather than sitting at 00:00:00.
  const over = { 'offer.timerStartedAt': started };
  assert.equal(offerIsOver(over, T0 + 25 * HOUR), true);
  assert.equal(offerIsShown(over, T0 + 25 * HOUR), false);
  assert.equal(offerIsShown(over, T0 + 1 * HOUR), true);
  assert.equal(offerIsShown({}, T0), true, 'no countdown started: the offer shows without one');
  assert.equal(offerIsShown({ 'offer.enabled': '0', 'offer.timerStartedAt': started }, T0 + HOUR), false, 'switched off wins over a running clock');
});

test('the price shown is the offer\'s own, else the course\'s, in the visitor\'s currency', () => {
  const { offerPrices } = load();
  const course = { price: { EGP: 3000, SAR: 300, USD: 100 } };
  assert.deepEqual(offerPrices({ 'home.offer.discountPercent': '40' }, course, 'SAR'), { oldPrice: 500, newPrice: 300 });
  assert.deepEqual(offerPrices({ 'home.offer.discountPercent': '40', 'offer.price.SAR': '240' }, course, 'SAR'), { oldPrice: 400, newPrice: 240 });
  // Another currency is untouched by an override typed for one.
  assert.equal(offerPrices({ 'home.offer.discountPercent': '40', 'offer.price.SAR': '240' }, course, 'USD').newPrice, 100);
  // A price typed with no course still works; nothing at all falls back to the typed text.
  assert.equal(offerPrices({ 'offer.price.EGP': '1999' }, null, 'EGP').newPrice, 1999);
  assert.equal(offerPrices({}, null, 'EGP'), null);
  // No discount: nothing to strike out.
  assert.deepEqual(offerPrices({ 'home.offer.discountPercent': '0' }, course, 'EGP'), { oldPrice: 3000, newPrice: 3000 });
});

test('the pop-up shows only while it is on, has something to say, and has not ended', () => {
  const { popupIsLive } = load();
  assert.equal(popupIsLive({}, T0), false);
  assert.equal(popupIsLive({ 'popup.enabled': '1' }, T0), false, 'on but empty');
  assert.equal(popupIsLive({ 'popup.enabled': '1', 'popup.title': 'خصم' }, T0), true);
  assert.equal(popupIsLive({ 'popup.enabled': '1', 'popup.discountPercent': '30' }, T0), true);
  assert.equal(popupIsLive({ 'popup.enabled': '0', 'popup.title': 'خصم' }, T0), false);
  const endsAt = new Date(T0 + HOUR).toISOString();
  assert.equal(popupIsLive({ 'popup.enabled': '1', 'popup.title': 'خصم', 'popup.endsAt': endsAt }, T0), true);
  assert.equal(popupIsLive({ 'popup.enabled': '1', 'popup.title': 'خصم', 'popup.endsAt': endsAt }, T0 + 2 * HOUR), false);
});

test('a visitor sees a pop-up as often as marketing chose, and sees a changed one again', () => {
  const { popupWasSeen, popupFrequency } = load();
  const base = { 'popup.version': 'v1' };
  const seen = { at: T0, version: 'v1' };
  assert.equal(popupFrequency({}), 'daily');
  assert.equal(popupFrequency({ 'popup.frequency': 'nonsense' }), 'daily');

  assert.equal(popupWasSeen({ ...base, 'popup.frequency': 'always' }, seen, T0 + 1), false);
  assert.equal(popupWasSeen({ ...base, 'popup.frequency': 'once' }, seen, T0 + 99 * HOUR), true);
  assert.equal(popupWasSeen({ ...base, 'popup.frequency': 'daily' }, seen, T0 + 5 * HOUR), true);
  assert.equal(popupWasSeen({ ...base, 'popup.frequency': 'daily' }, seen, T0 + 25 * HOUR), false);
  assert.equal(popupWasSeen({ ...base, 'popup.frequency': 'once' }, null, T0), false);
  // Saved again = a new version: even a «once» visitor who closed the old one sees it.
  assert.equal(popupWasSeen({ 'popup.version': 'v2', 'popup.frequency': 'once' }, seen, T0 + HOUR), false);
});

test('the controls live in التسويق ← الخصومات and the site reads the same helpers', () => {
  const hub = read('admin/pages/dashboard/tabs/MarketingHubTab.tsx');
  assert.match(hub, /activeSubTab === 'discounts'[\s\S]{0,200}<SiteOffersPanel notify=\{notify\} \/>/, 'the panel opens the discounts tab');

  const panel = read('admin/pages/dashboard/tabs/marketing-hub-sections/SiteOffersPanel.tsx');
  for (const key of ['offer.enabled', 'offer.courseId', 'offer.durationHours', 'offer.timerStartedAt', 'offer.price.EGP', 'offer.price.SAR', 'offer.price.USD',
    'popup.enabled', 'popup.title', 'popup.discountPercent', 'popup.code', 'popup.courseId', 'popup.endsAt', 'popup.frequency', 'popup.theme', 'popup.version']) {
    assert.ok(panel.includes(`'${key}'`), `${key} is saved from the panel`);
  }
  assert.match(panel, /'popup\.version': String\(Date\.now\(\)\)/, 'every save is a new version');
  assert.match(panel, /previewPopup=1/, 'staff have a preview');
  assert.match(panel, /document\.hidden/, 'the clock stops ticking in a background tab');

  const home = read('client/pages/Home.tsx');
  assert.match(home, /offerIsShown\(content\)/, 'the home page hides a switched-off or finished offer');
  assert.match(read('client/components/home/OfferSpotlight.tsx'), /offerPrices\(content, offerCourse \? \{ price: \{ \[currency\]: coursePrice \} \} : null, currency\)/, 'and shows the offer\'s own price');
  assert.doesNotMatch(home, /24 \* 60 \* 60 \* 1000/, 'no hard-coded 24 hours left in the page');

  const popup = read('client/components/SpecialOffer.tsx');
  assert.match(popup, /popupIsLive\(content\)/);
  assert.match(popup, /previewPopup/);
  assert.match(popup, /!isAdmin && !isStaff/, 'staff do not see it on the live site');
  assert.match(read('client/App.tsx'), /<SpecialOffer \/>/, 'it is mounted for every page');
});
