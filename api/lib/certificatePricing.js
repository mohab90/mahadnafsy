'use strict';
/**
 * TEST-03: extracted from routes/certificates.js's inline pricing computation
 * so the nationality/type → price/currency mapping can be unit-tested without
 * standing up the whole route + DB.
 */

// Maps a requester's nationality to the pricing-table column that applies to
// them. Anyone not explicitly Egyptian/resident/Saudi falls back to the
// foreign USD rate.
function priceKeyForNationality(nationality) {
  if (nationality === 'EGYPTIAN') return 'egyptianEGP';
  if (nationality === 'NON_EGYPTIAN_EGYPT') return 'residentEGP';
  if (nationality === 'SAUDI_RESIDENT') return 'residentSAR';
  return 'foreignUSD';
}

function currencyForPriceKey(priceKey) {
  if (priceKey.endsWith('SAR')) return 'SAR';
  if (priceKey.endsWith('USD')) return 'USD';
  return 'EGP';
}

function priceKeyForCountry(countryCode, nationality) {
  if (countryCode === 'EG') return nationality === 'EGYPTIAN' ? 'egyptianEGP' : 'residentEGP';
  if (countryCode === 'SA') return 'residentSAR';
  return 'foreignUSD';
}

// `pricingConfig` is the parsed content['extra_cert_pricing'] JSON blob:
// { [certTypeLowercase]: { egyptianEGP, residentEGP, residentSAR, foreignUSD } }
function resolveCertificatePrice({ type, nationality, countryCode, pricingConfig }) {
  const typeKey = String(type || '').toLowerCase();
  // Requests store the code upper-cased; the catalogue keeps it as it was typed.
  const savedKey = Object.keys(pricingConfig || {}).find(key => key.toLowerCase() === typeKey);
  const priceRow = (savedKey && pricingConfig[savedKey]) || {};
  const priceKey = countryCode
    ? priceKeyForCountry(countryCode, nationality)
    : priceKeyForNationality(nationality);
  const rawPrice = Number(priceRow[priceKey]);
  const price = Number.isFinite(rawPrice) && rawPrice > 0 ? rawPrice : null;
  const currency = price ? currencyForPriceKey(priceKey) : null;
  return { price, currency, status: price ? 'PRICED' : 'PENDING' };
}

// The price list's figure for a type in the payment's currency — the reading
// the payment dialog uses (admin PaymentModal certBasePrice), so the desk and
// the server agree on what a certificate costs.
//
// «سعر العميل الغير مصري مختلف … ليه بيظهر للموظفين كأنه مصري»: in pounds there are two lists, the Egyptian's and the resident
// non-Egyptian's. This read took the Egyptian one for every client paying in EGP, so a non-Egyptian living in Egypt was shown (and
// held to) the Egyptian price. The client's nationality chooses between them; riyals and dollars have one list each.
function basePriceForCurrency(pricingConfig, type, currency, nationality) {
  const typeKey = String(type || '').toLowerCase();
  const savedKey = Object.keys(pricingConfig || {}).find(key => key.toLowerCase() === typeKey);
  const tiers = (savedKey && pricingConfig[savedKey]) || null;
  if (!tiers) return 0;
  const code = String(currency || 'EGP').toUpperCase();
  if (code === 'SAR') return Number(tiers.residentSAR) || 0;
  if (code === 'USD') return Number(tiers.foreignUSD) || 0;
  if (String(nationality || '').toUpperCase() === 'NON_EGYPTIAN_EGYPT') return Number(tiers.residentEGP) || Number(tiers.egyptianEGP) || 0;
  return Number(tiers.egyptianEGP) || Number(tiers.residentEGP) || 0;
}

// The eight the system started with, and every code «تسعير الشهادات» lists.
const BUILT_IN_CERTIFICATE_TYPES = ['SOCIAL_SOLIDARITY','AIN_SHAMS','EXPERIENCE_EXTERNAL','PRACTICE_EXTERNAL','NATIONAL_COUNCIL','AMERICAN_BOARD','INSTITUTE','OTHER'];
function certificateTypeCodes(pricingConfig) {
  return new Set([...BUILT_IN_CERTIFICATE_TYPES, ...Object.keys(pricingConfig || {}).map(key => String(key).toUpperCase())]);
}

/**
 * What a certificate costs for the books and for the screens: the price list's figure for its type
 * and currency when there is one — «مينفعش تقول السعر اكتمل غير لما يطابق السعر عندك في السيستم»
 * (8 Oct 2026) — else the price on the request itself.
 */
function certificateDue(pricingConfig, request) {
  const listed = basePriceForCurrency(pricingConfig, request.type, request.currency || 'EGP', request.nationality);
  return listed > 0 ? listed : (Number(request.price) || 0);
}

module.exports = {
  certificateTypeCodes, basePriceForCurrency, certificateDue,
  resolveCertificatePrice, priceKeyForNationality, priceKeyForCountry, currencyForPriceKey,
};
