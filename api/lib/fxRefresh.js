'use strict';
/**
 * Today's SAR and USD rates, fetched when a payment needs them.
 *
 * A riyal or dollar payment is posted only with a rate younger than
 * FX_MAX_AGE_HOURS (lib/finance.js isFxSnapshotUsable). The rate came from one
 * daily job, and when that job did not run — it was among the jobs that
 * skipped while staging held the server-wide lock, fixed 5 Oct 2026 — every
 * Saudi and international booking answered «Internal server error» («لما
 * بنرفع حجز عميل دولي او سعودي … بيظهر مشكله», 10 Oct 2026). Now the payment
 * fetches the rate itself before it gives up, and one that still cannot be
 * priced is told why (FX_STALE) instead.
 */
const logger = require('./logger').child({ module: 'fx-refresh' });
const { getTenantSetting, setTenantSetting } = require('./tenantSettings');

const PROVIDER = 'https://open.er-api.com/v6/latest/EGP';
const FAILURE_BACKOFF_MS = 5 * 60 * 1000;
let lastFailureAt = 0;

async function fetchProviderRates({ timeoutMs = 8000 } = {}) {
  const response = await fetch(PROVIDER, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`provider returned ${response.status}`);
  const data = await response.json();
  if (!data.rates?.SAR || !data.rates?.USD) throw new Error('provider response has no SAR/USD rates');
  return {
    sarToEgp: Number((1 / data.rates.SAR).toFixed(4)),
    usdToEgp: Number((1 / data.rates.USD).toFixed(4)),
  };
}

/** Writes the rates into a tenant's content, as the daily job and the refresh button do. */
async function storeTenantRates(tenantId, { sarToEgp, usdToEgp }, { actorId = 'fx-refresh', source = 'open.er-api.com' } = {}) {
  const content = await getTenantSetting('content', { tenantId, fallback: {} });
  const updatedAt = new Date().toISOString();
  await setTenantSetting('content', {
    ...content,
    'exchange.sar_to_egp': String(sarToEgp),
    'exchange.usd_to_egp': String(usdToEgp),
    'exchange.source': source,
    'exchange.updated_at': updatedAt,
  }, { tenantId, actorId });
  require('./finance').invalidateFxCache(tenantId);
  return updatedAt;
}

/**
 * Refreshes one tenant's rates now. A failed fetch is not retried for five
 * minutes, so a provider that is down does not slow every payment by the timeout.
 */
async function refreshTenantFx(tenantId, { timeoutMs = 4000 } = {}) {
  if (Date.now() - lastFailureAt < FAILURE_BACKOFF_MS) return false;
  try {
    const rates = await fetchProviderRates({ timeoutMs });
    await storeTenantRates(tenantId, rates);
    logger.info(`[fx] refreshed on demand for ${tenantId}: SAR=${rates.sarToEgp} USD=${rates.usdToEgp}`);
    return true;
  } catch (error) {
    lastFailureAt = Date.now();
    logger.warn('[fx] on-demand refresh failed:', error.message);
    return false;
  }
}

/**
 * A snapshot that can price `currency`, refreshing once if the stored one is
 * too old. Returns { usable, snapshot }.
 */
async function ensureFreshFx(tenantId, currency) {
  const finance = require('./finance');
  const cur = String(currency || 'EGP').toUpperCase();
  let snapshot = await finance.getFxSnapshot(tenantId);
  if (finance.isFxSnapshotUsable(snapshot, cur)) return { usable: true, snapshot };
  if (!['SAR', 'USD'].includes(cur)) return { usable: false, snapshot };
  if (await refreshTenantFx(tenantId)) {
    snapshot = await finance.getFxSnapshot(tenantId);
  }
  return { usable: finance.isFxSnapshotUsable(snapshot, cur), snapshot };
}

const CURRENCY_AR = { SAR: 'الريال', USD: 'الدولار' };

/** The refusal a desk sees when a foreign-currency payment cannot be priced. */
function fxStaleError(currency, snapshot) {
  const cur = String(currency || '').toUpperCase();
  const when = snapshot?.updatedAt ? String(snapshot.updatedAt).slice(0, 10) : null;
  return Object.assign(new Error(
    `سعر ${CURRENCY_AR[cur] || cur} بالجنيه مش محدّث${when ? ` (آخر تحديث ${when})` : ''} — `
    + 'دوس «تحديث أسعار الصرف» في الحسابات، أو اكتب السعر في الإعدادات ← أسعار الصرف، وجرّب تاني'), { statusCode: 409, code: 'FX_STALE' });
}

/**
 * Manual rates typed in الإعدادات › أسعار الصرف were never stamped, so they read
 * as stale the moment they were saved. A change to either rate is dated now.
 */
function stampManualRates(previous = {}, next = {}) {
  const changed = ['exchange.sar_to_egp', 'exchange.usd_to_egp']
    .some(key => next[key] !== undefined && String(next[key]) !== String(previous[key] ?? ''));
  if (!changed || next['exchange.updated_at'] !== previous['exchange.updated_at']) return next;
  return { ...next, 'exchange.source': 'manual', 'exchange.updated_at': new Date().toISOString() };
}

/** For tests: forget a failed fetch. */
function resetFxBackoff() { lastFailureAt = 0; }

module.exports = { resetFxBackoff, fetchProviderRates, storeTenantRates, refreshTenantFx, ensureFreshFx, fxStaleError, stampManualRates };
