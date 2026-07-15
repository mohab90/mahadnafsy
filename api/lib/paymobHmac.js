'use strict';

const crypto = require('crypto');

const PAYMOB_HMAC_FIELDS = [
  'amount_cents','created_at','currency','error_occured','has_parent_transaction',
  'id','integration_id','is_3d_secure','is_auth','is_capture','is_refunded',
  'is_standalone_payment','is_voided','order','owner','pending',
  'source_data.pan','source_data.sub_type','source_data.type','success',
];

function getDeepParam(source, path) {
  if (!source || !path) return '';
  const direct = source[path];
  if (direct !== undefined && direct !== null) return direct;
  return path.split('.').reduce((acc, key) => (acc && acc[key] !== undefined ? acc[key] : ''), source);
}

function normalizePaymobValue(value) {
  if (value === true) return 'true';
  if (value === false) return 'false';
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return value.id ?? value.merchant_order_id ?? value.order_id ?? '';
  return String(value);
}

function buildPaymobHmacPayload(params) {
  return PAYMOB_HMAC_FIELDS.map((field) => normalizePaymobValue(getDeepParam(params, field))).join('');
}

function verifyPaymobHmac(params, hmacSecret) {
  const incoming = String(params.hmac || params.HMAC || '').trim().toLowerCase();
  if (!incoming || !hmacSecret) return false;
  const expected = crypto.createHmac('sha512', hmacSecret).update(buildPaymobHmacPayload(params)).digest('hex').toLowerCase();
  try {
    const a = Buffer.from(incoming);
    const b = Buffer.from(expected);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch (_) {
    return false;
  }
}

function paymobMerchantOrderId(params) {
  return normalizePaymobValue(
    params.merchant_order_id
    || getDeepParam(params, 'order.merchant_order_id')
    || getDeepParam(params, 'obj.order.merchant_order_id')
    || getDeepParam(params, 'order')
    || getDeepParam(params, 'obj.order')
  );
}

function paymobTransactionId(params) {
  return normalizePaymobValue(params.id || getDeepParam(params, 'obj.id') || params.transaction_id);
}

module.exports = {
  PAYMOB_HMAC_FIELDS,
  buildPaymobHmacPayload,
  verifyPaymobHmac,
  paymobMerchantOrderId,
  paymobTransactionId,
};
