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
  const priceRow = (pricingConfig && pricingConfig[typeKey]) || {};
  const priceKey = countryCode
    ? priceKeyForCountry(countryCode, nationality)
    : priceKeyForNationality(nationality);
  const rawPrice = Number(priceRow[priceKey]);
  const price = Number.isFinite(rawPrice) && rawPrice > 0 ? rawPrice : null;
  const currency = price ? currencyForPriceKey(priceKey) : null;
  return { price, currency, status: price ? 'PRICED' : 'PENDING' };
}

module.exports = {
  resolveCertificatePrice, priceKeyForNationality, priceKeyForCountry, currencyForPriceKey,
};
