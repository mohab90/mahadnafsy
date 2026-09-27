'use strict';

// «التحصيل: التوزيع والشيتات» — who in collection receives clients, from which
// market, and how many; and each officer's own sheets.
//
// «إعدادات أوسع + تحكم في توزيع الداتا على التحصيل زي السيلز». Distribution to
// collection was a plain rotation over every active collection employee: no one
// could be taken out of it, capped, or kept to the riyal clients.
//
// Kept in tenant settings rather than crm_assignment_members: saving the sales
// list deletes every row not in it, whatever its team.

const MARKETS = ['local', 'saudi', 'intl'];
const CLIENT_STATUSES = ['active', 'old_local', 'old_intl'];

function cleanList(value, allowed) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(item => String(item || '').trim()).filter(item => allowed.includes(item)))];
}

function sanitizeCollectionConfig(input = {}) {
  const members = (Array.isArray(input.members) ? input.members : [])
    .map(member => ({
      staffId: String(member?.staffId || '').trim().slice(0, 64),
      isAvailable: member?.isAvailable !== false,
      markets: cleanList(member?.markets, MARKETS),
      maxClients: member?.maxClients === '' || member?.maxClients == null || Number(member.maxClients) <= 0
        ? null : Math.min(Math.round(Number(member.maxClients)) || 0, 100000) || null,
    }))
    .filter((member, index, all) => member.staffId && all.findIndex(other => other.staffId === member.staffId) === index);
  const sheets = (Array.isArray(input.sheets) ? input.sheets : [])
    .map(sheet => {
      const raw = String(sheet?.sheetId || '').trim();
      const fromUrl = raw.match(/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
      return {
        id: String(sheet?.id || '').trim().slice(0, 64) || `cs-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        staffId: String(sheet?.staffId || '').trim().slice(0, 64),
        name: String(sheet?.name || '').trim().slice(0, 120),
        sheetId: (fromUrl ? fromUrl[1] : raw).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 128),
        gid: String(sheet?.gid || '').replace(/\D/g, '').slice(0, 20),
        clientStatus: CLIENT_STATUSES.includes(sheet?.clientStatus) ? sheet.clientStatus : 'old_local',
      };
    })
    .filter(sheet => sheet.staffId && sheet.sheetId);
  return { members, sheets };
}

// The same reading as the screen's (admin onlineClientsUtils.subscriberMarket):
// where the desk moved the client, else what their latest payment was in, else
// their branch.
function subscriberMarket({ market, latestCurrency, branch }) {
  if (MARKETS.includes(market)) return market;
  if (latestCurrency === 'SAR') return 'saudi';
  if (latestCurrency === 'USD') return 'intl';
  if (latestCurrency === 'EGP') return 'local';
  const b = String(branch || '').toUpperCase();
  if (b === 'ONLINE_SAUDI') return 'saudi';
  if (b === 'ONLINE_ABROAD') return 'intl';
  return 'local';
}

/**
 * Picks an officer per client. Once any member is configured, only members
 * switched on take part, each up to their cap and within their markets; a
 * client nobody takes is left unassigned. With nothing configured it is the
 * old rotation over every collection employee.
 */
function createCollectionPicker(staff, config, holding) {
  const configured = config.members.length > 0;
  const byId = new Map(config.members.map(member => [member.staffId, member]));
  const pool = staff
    .map(person => ({ ...person, rule: byId.get(String(person.id)) || null, held: holding.get(String(person.id)) || 0 }))
    .filter(person => !configured || (person.rule && person.rule.isAvailable));
  let index = 0;
  return {
    size: pool.length,
    next(market) {
      const open = pool.filter(person => {
        const rule = person.rule;
        if (rule?.maxClients != null && person.held >= rule.maxClients) return false;
        return !rule?.markets?.length || rule.markets.includes(market);
      });
      if (!open.length) return null;
      const person = open[index % open.length];
      index += 1;
      person.held += 1;
      return person;
    },
  };
}

module.exports = { CLIENT_STATUSES, MARKETS, createCollectionPicker, sanitizeCollectionConfig, subscriberMarket };
