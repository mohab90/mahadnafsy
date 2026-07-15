'use strict';

const CERT_TYPES = new Set([
  'SOCIAL_SOLIDARITY',
  'AIN_SHAMS',
  'EXPERIENCE_EXTERNAL',
  'PRACTICE_EXTERNAL',
  'NATIONAL_COUNCIL',
  'AMERICAN_BOARD',
  'INSTITUTE',
  'OTHER',
]);

const CERT_NATIONALITIES = new Set(['EGYPTIAN', 'NON_EGYPTIAN_EGYPT', 'SAUDI_RESIDENT', 'INTERNATIONAL']);

function optionalText(value, max) {
  if (value === undefined || value === null || value === '') return null;
  return String(value).trim().slice(0, max);
}

function validateCertificateRequest(body) {
  const type = String(body?.type || '').toUpperCase();
  if (!CERT_TYPES.has(type)) return { error: 'invalid certificate type' };
  const nationality = body?.nationality ? String(body.nationality).toUpperCase() : null;
  if (nationality && !CERT_NATIONALITIES.has(nationality)) return { error: 'invalid nationality' };
  const price = body?.price === undefined || body?.price === null || body?.price === '' ? null : Number(body.price);
  if (price !== null && (!Number.isFinite(price) || price < 0)) return { error: 'invalid price' };
  const currency = body?.currency ? String(body.currency).toUpperCase() : null;
  if (currency && !['EGP', 'SAR', 'USD'].includes(currency)) return { error: 'invalid currency' };
  return {
    value: {
      type,
      courseId: optionalText(body?.courseId, 36),
      customName: optionalText(body?.customName, 255),
      nameAr: optionalText(body?.nameAr, 255),
      nameEn: optionalText(body?.nameEn, 255),
      nationality,
      idNumber: optionalText(body?.idNumber, 50),
      price,
      currency,
      note: optionalText(body?.note, 2000),
    },
  };
}

module.exports = { validateCertificateRequest };
