'use strict';
// What an order's branch and type are called, the one way — read by the order
// routes and by the Paymob finalisation (lib/paymobFinalise.js).
const { DEFAULT_TENANT_ID } = require('./tenantScope');

const BRANCH_ALIASES = {
  DAQQI: 'DAQQI',
  DQI: 'DAQQI',
  DOKKI: 'DAQQI',
  TAGAMOA: 'TAGAMOA',
  ONLINE: 'ONLINE_EGYPT',
  ONLINE_EGYPT: 'ONLINE_EGYPT',
  ONLINE_SAUDI: 'ONLINE_SAUDI',
  ONLINE_ABROAD: 'ONLINE_ABROAD',
  INTERNATIONAL: 'ONLINE_ABROAD',
  OTHER: 'OTHER',
};

function normalizePaymentBranch(value) {
  const key = String(value || '').trim().toUpperCase().replace(/[-\s]+/g, '_');
  return BRANCH_ALIASES[key] || null;
}

function normalizeOrderTypeForDb(value) {
  const key = String(value || '').trim().toLowerCase();
  if (key === 'course') return 'COURSE';
  if (key === 'bundle') return 'BUNDLE';
  if (key === 'consultation' || key === 'standalone_payment' || key === 'standalone') return 'CONSULTATION';
  return 'CONSULTATION';
}

function normalizedOrderType(value) {
  const key = String(value || '').trim().toLowerCase();
  if (key === 'course') return 'course';
  if (key === 'bundle') return 'bundle';
  return 'consultation';
}


function appendTenantScope(sql, alias, tenantId, params) {
  const prefix = alias ? `${alias}.` : '';
  const effectiveTenantId = tenantId || DEFAULT_TENANT_ID;
  if (effectiveTenantId === DEFAULT_TENANT_ID) {
    params.push(DEFAULT_TENANT_ID);
    return `${sql} AND (${prefix}tenant_id = ? OR ${prefix}tenant_id IS NULL)`;
  }
  params.push(effectiveTenantId);
  return `${sql} AND ${prefix}tenant_id = ?`;
}

module.exports = { BRANCH_ALIASES, normalizePaymentBranch, normalizeOrderTypeForDb, normalizedOrderType, appendTenantScope };
