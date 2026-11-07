'use strict';

// Where a client belongs and the currency that follows (moved out of lib/staffClientsView.js so the SQL balance, lib/agreedPrice.js, reads the same answer as the lists
// and GET /api/admin/clients/:id/money: the currency an item is priced in when no payment names one).

const isCollected = payment => !payment?.status || payment.status === 'paid';

const normBranch = value => (value ? String(value).toUpperCase().replace(/[-\s]/g, '_') : '');
const isOnlineBranch = branch => !['DAQQI', 'TAGAMOA'].includes(normBranch(branch));
const isOnlineClient = client => isOnlineBranch(client.branch);

/** «محلي / سعودي / دولي»: where the desk moved the client, else what their latest collected payment was in, else their branch. */
function marketOf(client) {
  if (['local', 'saudi', 'intl'].includes(client.market)) return client.market;
  const latest = (client.paymentHistory || []).filter(isCollected)
    .sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')))[0];
  if (latest?.currency === 'SAR') return 'saudi';
  if (latest?.currency === 'USD') return 'intl';
  if (latest?.currency === 'EGP') return 'local';
  const branch = normBranch(client.branch);
  if (branch === 'ONLINE_SAUDI') return 'saudi';
  if (branch === 'ONLINE_ABROAD') return 'intl';
  return 'local';
}

const BRANCH_CURRENCY = { ONLINE_SAUDI: 'SAR', ONLINE_ABROAD: 'USD' };
function clientCurrency(client) {
  if (isOnlineClient(client)) return { local: 'EGP', saudi: 'SAR', intl: 'USD' }[marketOf(client)];
  return BRANCH_CURRENCY[normBranch(client.branch)] || 'EGP';
}

module.exports = { clientCurrency, isOnlineBranch, isOnlineClient, marketOf, normBranch };
