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

/** The one currency a box holds, from its name. */
const currencyOfName = name => (/سعود|ريال|sar/i.test(name) ? 'SAR' : /ويسترن|western|دولار|usd/i.test(name) ? 'USD' : 'EGP');

/**
 * @param {string[]} listed   the names as the settings list them
 * @param {Map} aliases       box_aliases (lib/boxAliases.js)
 * @returns the catalogue: { active, aliases, entries: [{ key, name, currency, canonical, folded }] }
 */
function buildCatalog(listed, aliases = new Map()) {
  const names = [...new Set(listed.map(collapse).filter(Boolean))];
  const drafts = names.map(name => ({ name, currency: currencyOfName(name), canonical: applyAlias(canonicalChannel(name), aliases), folded: fold(name) }));
  // Two listed boxes that read the same under the spelling rules (the two bank transfers) keep their own names as their keys.
  const sameReading = draft => drafts.filter(other => other.canonical === draft.canonical && other.currency === draft.currency).length > 1;
  const seen = new Set();
  const entries = [];
  for (const draft of drafts) {
    const key = sameReading(draft) ? draft.name : draft.canonical;
    if (seen.has(`${key}|${draft.currency}`)) continue;
    seen.add(`${key}|${draft.currency}`);
    entries.push({ ...draft, key });
  }
  return { active: entries.length > 0, aliases, entries };
}

async function loadBoxCatalog(db, tenantId) {
  const aliases = await loadBoxAliases(db, tenantId);
  const { getTenantSetting } = require('./tenantSettings');
  const content = await getTenantSetting('content', { tenantId, fallback: {}, db }).catch(() => ({}));
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
    const own = catalog.entries.find(entry => entry.currency === cur);
    return { box: own ? own.key : CATCH_ALL, currency: cur };
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
