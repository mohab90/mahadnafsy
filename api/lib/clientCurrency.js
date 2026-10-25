'use strict';

// The currency a client is kept in, changed from the course-access panel: «محتاجين نعمل تعديل في زر صلاحيات
// الكورسات ان يبقي في زي تغير العمله واقدر اغير العمله بتاعت العميل مع تغيير الارقام لسعر الكورس او المدفوع او
// المتبقي».
//
// An online client's currency is their market's — local جنيه، سعودي ريال، دولي دولار — and the market is the
// branch (ONLINE_EGYPT / ONLINE_SAUDI / ONLINE_ABROAD) with `crm.market` written beside it, the way the desk
// moves a client by hand. Changing it moves the client and, when asked, converts every figure kept in the
// client's own money: each item's agreed price and «مدفوع قبل السيستم», at the system's rate. The remaining is
// not stored, so it follows.
//
// Payments already recorded in the old currency are not touched: they are in the books at the rate of their day
// (amount_egp), and correcting one is the managers' void-and-record-again. A client who has any is refused
// rather than shown a balance that adds two currencies.
//
// Every function runs inside the caller's transaction.

const { subscriberMarket } = require('./collectionDistribution');
const { branchIdForBranch } = require('./branches');
const { logClientEvent } = require('./clientHistory');

const CURRENCIES = ['EGP', 'SAR', 'USD'];
const MARKET_OF = { EGP: 'local', SAR: 'saudi', USD: 'intl' };
const CURRENCY_OF = { local: 'EGP', saudi: 'SAR', intl: 'USD' };
const BRANCH_OF = { local: 'ONLINE_EGYPT', saudi: 'ONLINE_SAUDI', intl: 'ONLINE_ABROAD' };
const NAME_OF = { EGP: 'جنيه', SAR: 'ريال', USD: 'دولار' };
const BRANCH_CLIENT = ['DAQQI', 'DOKKI', 'DQI', 'TAGAMOA'];

const fail = (statusCode, message, code) => Object.assign(new Error(message), { statusCode, ...(code ? { code } : {}) });

function parseCrm(value) {
  if (value && typeof value === 'object') return value;
  try { return JSON.parse(value || '{}') || {}; } catch { return {}; }
}

/** `amount` in `from` money as `to` money, in whole units; a figure that was something stays at least 1. */
function convertAmount(amount, from, to, rates) {
  const value = Number(amount) || 0;
  if (!(value > 0) || from === to) return value;
  return Math.max(1, Math.round((value * rates[from]) / rates[to]));
}

async function itemTitles(db, tenantId, keys) {
  const titles = new Map();
  const bundleIds = keys.filter(key => key.startsWith('bundle:')).map(key => key.slice(7));
  const courseIds = keys.filter(key => !key.startsWith('bundle:'));
  if (courseIds.length) {
    const [rows] = await db.query('SELECT id, title, title_ar FROM courses WHERE tenant_id=? AND id IN (?)', [tenantId, courseIds]);
    for (const row of rows || []) titles.set(row.id, row.title_ar || row.title);
  }
  if (bundleIds.length) {
    const [rows] = await db.query('SELECT id, title FROM bundles WHERE tenant_id=? AND id IN (?)', [tenantId, bundleIds]);
    for (const row of rows || []) titles.set(`bundle:${row.id}`, row.title);
  }
  return titles;
}

/**
 * Moves the client to `currency`'s market and, with `convert`, converts their figures. With `dryRun` nothing is
 * written and the same answer comes back, for the screen to show before it asks.
 * `rates`: EGP per unit ({ EGP: 1, SAR, USD }), or an async function of the two currencies involved that returns
 * them — the route's, which refuses a rate that is stale — called only when there is something to convert.
 */
async function changeClientCurrency(db, { tenantId, subscriberId, currency, convert = true, dryRun = false, rates, actor }) {
  const to = String(currency || '').toUpperCase();
  if (!CURRENCIES.includes(to)) throw fail(400, 'اختار العملة: جنيه أو ريال أو دولار');
  const [[subscriber]] = await db.query(
    `SELECT id, name, branch, crm_json FROM subscribers WHERE id=? AND tenant_id=? AND deleted_at IS NULL LIMIT 1 FOR UPDATE`,
    [subscriberId, tenantId]);
  if (!subscriber) throw fail(404, 'العميل غير موجود');
  if (BRANCH_CLIENT.includes(String(subscriber.branch || '').toUpperCase())) {
    throw fail(409, 'ده عميل فرع — عملته بتتحدد بالفرع، وتغيير العملة للعملاء الأونلاين بس', 'BRANCH_CLIENT');
  }
  const crm = parseCrm(subscriber.crm_json);
  const [[latest]] = await db.query(
    `SELECT currency FROM payments WHERE tenant_id=? AND subscriber_id=? AND status='paid' AND deleted_at IS NULL
      ORDER BY date DESC, created_at DESC LIMIT 1`, [tenantId, subscriberId]);
  const fromMarket = subscriberMarket({ market: crm.market, latestCurrency: latest?.currency, branch: subscriber.branch });
  const from = CURRENCY_OF[fromMarket];
  const market = MARKET_OF[to];
  if (from === to && crm.market === market && String(subscriber.branch).toUpperCase() === BRANCH_OF[market]) {
    throw fail(409, `العميل ده أصلاً بالـ${NAME_OF[to]}`, 'SAME_CURRENCY');
  }

  const [other] = await db.query(
    `SELECT currency, COUNT(*) AS n FROM payments
      WHERE tenant_id=? AND subscriber_id=? AND deleted_at IS NULL AND status IN ('paid','pending') AND currency<>?
        AND payment_type IN ('COURSE','BUNDLE') AND (course_id IS NOT NULL OR bundle_id IS NOT NULL)
      GROUP BY currency`, [tenantId, subscriberId, to]);
  if (other?.length) {
    const said = other.map(row => `${row.n} بالـ${NAME_OF[row.currency] || row.currency}`).join(' و');
    throw fail(409, `العميل عنده دفعات مسجلة (${said}) — تغيير العملة هيخلط عملتين في المتبقي. صحّح الدفعات الأول من المدير (إلغاء الدفعة وتسجيلها بالعملة الجديدة).`, 'PAYMENTS_IN_OTHER_CURRENCY');
  }
  const table = convert && from !== to && typeof rates === 'function' ? await rates([from, to]) : rates;
  if (convert && from !== to && !(table?.[from] > 0 && table?.[to] > 0)) throw fail(409, 'سعر الصرف مش متاح دلوقتي', 'NO_RATE');

  const keys = [...new Set([...Object.keys(crm.customPrices || {}), ...Object.keys(crm.priorPaid || {})])];
  const titles = await itemTitles(db, tenantId, keys);
  const customPrices = { ...(crm.customPrices || {}) };
  const priorPaid = { ...(crm.priorPaid || {}) };
  const changes = [];
  if (convert && from !== to) {
    for (const key of keys) {
      const price = { was: Number(customPrices[key]) || 0 };
      const prior = { was: Number(priorPaid[key]) || 0 };
      price.now = convertAmount(price.was, from, to, table);
      prior.now = convertAmount(prior.was, from, to, table);
      if (price.was > 0) customPrices[key] = price.now;
      if (prior.was > 0) priorPaid[key] = prior.now;
      changes.push({ item: key, title: titles.get(key) || key, price, priorPaid: prior });
    }
  }

  const next = { ...crm, market, customPrices, priorPaid };
  // The old-data tabs tell local from foreign by the status, so it moves with the market.
  if (market === 'local' && crm.clientStatus === 'old_intl') next.clientStatus = 'old_local';
  if (market !== 'local' && crm.clientStatus === 'old_local') next.clientStatus = 'old_intl';

  const result = {
    from, to, converted: Boolean(convert && from !== to), rate: convert && from !== to ? table[from] / table[to] : null,
    branch: BRANCH_OF[market], changes, clientStatus: next.clientStatus || null,
  };
  if (dryRun) return result;

  await db.query('UPDATE subscribers SET branch=?, branch_id=?, crm_json=? WHERE id=? AND tenant_id=?',
    [BRANCH_OF[market], branchIdForBranch(BRANCH_OF[market]), JSON.stringify(next), subscriberId, tenantId]);
  await db.query('UPDATE enrollments SET branch_id=? WHERE subscriber_id=? AND tenant_id=?',
    [branchIdForBranch(BRANCH_OF[market]), subscriberId, tenantId]);
  await logClientEvent(db, {
    tenantId, subscriberId, action: 'currency_changed', actor,
    label: `اتغيرت عملة العميل من ${NAME_OF[from]} إلى ${NAME_OF[to]}`
      + (result.converted ? ` — الأرقام اتحولت بسعر ${result.rate.toFixed(4)} (${changes.length} كورس)` : ' — الأرقام زي ما هي من غير تحويل'),
  });
  return result;
}

module.exports = { BRANCH_OF, CURRENCIES, CURRENCY_OF, MARKET_OF, NAME_OF, changeClientCurrency, convertAmount };
