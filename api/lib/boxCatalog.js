'use strict';

// «الخزن»: which box a sum of money belongs to (3 Nov 2026).
//
//   «خلي اي خزنه مضافه في السيسيتم تظهر في الخزن هنا حتى لو رصيدها صفر … واي خزنه مش مضافه جمع فلوسها في اخري حتى لو الفلوس دي من الحسابات القديمة …
//    مضيفش خزن من نفسك … ويسترن بالدولار وتحويل احمد السعودية بالريال الباقي كله بالجنيه … فودافون كاش 4645 2,316 SAR مينفعش فودافون كاش وتبقى بالريال».
//
// The boxes are the institute's own list (الإعدادات ← وسائل الدفع, content['finance.payment_methods']) and nothing else; the system adds none. Each has ONE
// currency, the one its name says: أحمد السعودية is riyals, ويسترن يونيون is dollars, every other is pounds. So a payment is counted by what it is:
//   - in riyals  → the riyal box, whatever method was typed on it (a Vodafone wallet never held riyals);
//   - in dollars → the dollar box;
//   - in pounds  → the listed box its method is, read through the spelling rules (lib/paymentChannels.js) and the merges (lib/boxAliases.js);
//   - anything else, however old its spelling → «أخرى».
// The stored payments, withdrawals and expenses are never rewritten: this is how they are read. A tenant with no list gets the old behaviour (every
// spelling its own box), because nothing says which boxes are real.

const { canonicalChannel, INVISIBLE } = require('./paymentChannels');
const { applyAlias, loadBoxAliases } = require('./boxAliases');

const CATCH_ALL = 'أخرى';
const collapse = value => String(value ?? '').replace(INVISIBLE, ' ').replace(/\s+/g, ' ').trim();
const fold = value => collapse(value).replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660)).replace(/[إأآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').toLowerCase();

/**
 * The one currency a box holds, from its name. The settings list is plain names with no currency column, so the name has to say it. A Latin «sar» / «usd» counts
 * only as a word of its own (never inside «Nasar»), and the Saudi banks that do not say «السعودية» in their name are named here — «بنك الراجحي» was read as
 * pounds and shown as a pound box.
 */
const currencyOfName = name => (/سعود|ريال|راجحي|rajhi|(^|[^a-z])(sar|stc)([^a-z]|$)/i.test(name)
  ? 'SAR'
  : /ويسترن|western|دولار|(^|[^a-z])usd([^a-z]|$)/i.test(name) ? 'USD' : 'EGP');

// Names the spelling rules (lib/paymentChannels.js) give to one specific box. Anything else they return for a name with no number in it is only the PROVIDER
// («فودافون كاش» for «فودافون كاش مصري» and for «فودافون كاش السعودية», «تحويل بنكي» for «بنك الراجحي»): not an identity, so such a box keeps the name it was typed under.
const SPECIFIC_NAMES = new Set(['أحمد السعودية', 'البنك السعودي', 'أونلاين', 'خزنة الدقي - كاش']);
const isSpecific = canonical => SPECIFIC_NAMES.has(canonical) || /\d{3,}/.test(canonical);

/**
 * @param {string[]} listed   the names as the settings list them
 * @param {Map} aliases       box_aliases (lib/boxAliases.js)
 * @returns the catalogue: { active, aliases, entries: [{ key, name, currency, canonical, folded }] }
 */
function buildCatalog(listed, aliases = new Map()) {
  const names = [...new Set(listed.map(collapse).filter(Boolean))];
  const drafts = names.map(name => ({ name, currency: currencyOfName(name), spelled: canonicalChannel(name), canonical: applyAlias(canonicalChannel(name), aliases), folded: fold(name) }));
  // A box is named by what the owner typed unless the spelling rules found its specific name (its number, أحمد السعودية, the cash box) or a merge moved it: «بنك الراجحي» is
  // not «تحويل بنكي» and «فودافون كاش السعودية» is not «فودافون كاش». Two listed boxes that read alike and hold one currency (the two bank transfers) keep their own names too.
  const sameReading = draft => drafts.filter(other => other.spelled === draft.spelled && other.currency === draft.currency).length > 1;
  const identity = draft => (isSpecific(draft.canonical) || draft.canonical !== draft.spelled ? draft.canonical : draft.name);
  const seen = new Set();
  const entries = [];
  for (const draft of drafts) {
    const key = sameReading(draft) ? draft.name : identity(draft);
    if (seen.has(`${key}|${draft.currency}`)) continue;
    seen.add(`${key}|${draft.currency}`);
    entries.push({ ...draft, key });
  }
  return { active: entries.length > 0, aliases, entries };
}

async function loadBoxCatalog(db, tenantId) {
  const aliases = await loadBoxAliases(db, tenantId);
  const { getTenantSetting } = require('./tenantSettings');
  // A failed read reads as «no list» (the old reading), which shows every spelling as its own box — say so in the log, so a screen that looks wrong can be traced to it.
  const content = await getTenantSetting('content', { tenantId, fallback: {}, db }).catch(error => {
    require('./logger').warn('[boxCatalog] the payment-methods list could not be read; boxes are shown without it:', error.message);
    return {};
  });
  return buildCatalog(String(content?.['finance.payment_methods'] || '').split('||'), aliases);
}

/**
 * The box a (method, currency) is counted in: { box, currency }. With no list it is the old reading — the method's channel, in its own currency.
 */
function boxOf(method, currency, catalog, { stored = false } = {}) {
  const cur = String(currency || 'EGP').toUpperCase();
  // A name already stored as a box (an opening, a withdrawal) is only read through the merges; a payment's typed method also through the spelling rules.
  if (!catalog?.active) return { box: stored ? applyAlias(String(method), catalog?.aliases) : applyAlias(canonicalChannel(method), catalog?.aliases), currency: cur };
  if (cur !== 'EGP') {
    // The listed box of that currency the method names; with no such name, the currency's one box («فودافون كاش 4645 2,316 SAR» is on the riyal box — a Vodafone wallet never held
    // riyals); with several boxes in the currency and no name to choose by, «أخرى» in that currency — never the first one listed, which took every other box's money.
    const own = catalog.entries.filter(entry => entry.currency === cur);
    const typed = fold(method);
    const reading = applyAlias(canonicalChannel(method), catalog.aliases);
    const named = own.find(entry => entry.folded === typed) || own.find(entry => entry.key === reading)
      || (own.filter(entry => entry.canonical === reading).length === 1 ? own.find(entry => entry.canonical === reading) : null);
    // The catch-all keeps its own name when it is read back as a stored box.
    const chosen = named || (own.length === 1 && collapse(method) !== CATCH_ALL ? own[0] : null);
    return { box: chosen ? chosen.key : CATCH_ALL, currency: cur };
  }
  const pounds = catalog.entries.filter(entry => entry.currency === 'EGP');
  const text = fold(method);
  const exact = pounds.find(entry => entry.folded === text);
  if (exact) return { box: exact.key, currency: cur };
  const reading = applyAlias(canonicalChannel(method), catalog.aliases);
  const same = pounds.filter(entry => entry.canonical === reading || entry.key === reading);
  if (same.length === 1) return { box: same[0].key, currency: cur };
  if (same.length > 1) {
    // «تحويل بنكي» alone was always the Egyptian one; the foreign one says so.
    const abroad = /خارج|اجنب|دولي|abroad/.test(text);
    const pick = same.find(entry => /خارج|اجنب|دولي|abroad/.test(entry.folded) === abroad) || same[0];
    return { box: pick.key, currency: cur };
  }
  return { box: CATCH_ALL, currency: cur };
}

const keyOf = (method, currency, catalog, options) => {
  const { box, currency: cur } = boxOf(method, currency, catalog, options);
  return `${box}|${cur}`;
};

module.exports = { CATCH_ALL, boxOf, buildCatalog, currencyOfName, keyOf, loadBoxCatalog };
