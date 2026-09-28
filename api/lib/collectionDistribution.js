'use strict';

// «التحصيل: التوزيع والشيتات» — who in collection receives clients, from which
// market, and how many in a period; and each officer's own sheets.
//
// «إعدادات أوسع + تحكم في توزيع الداتا على التحصيل زي السيلز». Distribution to
// collection was a plain rotation over every active collection employee: no one
// could be taken out of it, capped, or kept to the riyal clients. And the four
// paths that hand a new client to an officer on their own — a new subscriber, a
// lead converted, a payment that creates the client — each picked the least
// loaded employee whatever the settings said.
//
// «أقصى عدد في مدة اد ايه يوميا ولا اسبوعيا ولا 15 يوم ولا في الشهر»: the cap
// counts what an officer RECEIVED in the period, by subscribers.assigned_cs_at
// (migration 220), the way the sales cap counts leads.assigned_at.
//
// Kept in tenant settings rather than crm_assignment_members: saving the sales
// list deletes every row not in it, whatever its team.

const { getTenantSetting } = require('./tenantSettings');
const { periodStart } = require('./assignmentQuota');

const MARKETS = ['local', 'saudi', 'intl'];
const CLIENT_STATUSES = ['active', 'old_local', 'old_intl'];
const PERIODS = ['day', 'week', 'fortnight', 'month'];

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
      intakeLimit: member?.intakeLimit === '' || member?.intakeLimit == null || Number(member.intakeLimit) <= 0
        ? null : Math.min(Math.round(Number(member.intakeLimit)) || 0, 100000) || null,
      intakePeriod: PERIODS.includes(member?.intakePeriod) ? member.intakePeriod : 'day',
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
        autoSync: sheet?.autoSync !== false,
        lastSyncAt: typeof sheet?.lastSyncAt === 'string' ? sheet.lastSyncAt.slice(0, 40) : null,
        lastResult: sheet?.lastResult && typeof sheet.lastResult === 'object' ? {
          created: Number(sheet.lastResult.created) || 0, assigned: Number(sheet.lastResult.assigned) || 0,
          skipped: Number(sheet.lastResult.skipped) || 0, others: Number(sheet.lastResult.others) || 0,
          failed: Number(sheet.lastResult.failed) || 0,
        } : null,
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
 * switched on take part, each within their markets and up to what they may
 * receive in their period; a client nobody takes is left unassigned. With
 * nothing configured it is the old rotation over every collection employee.
 * `received` is what each officer has already received in their period.
 */
function createCollectionPicker(staff, config, received = new Map()) {
  const configured = config.members.length > 0;
  const byId = new Map(config.members.map(member => [member.staffId, member]));
  const pool = staff
    .map(person => ({ ...person, rule: byId.get(String(person.id)) || null, received: received.get(String(person.id)) || 0 }))
    .filter(person => !configured || (person.rule && person.rule.isAvailable));
  let index = 0;
  return {
    size: pool.length,
    next(market) {
      const open = pool.filter(person => {
        const rule = person.rule;
        if (rule?.intakeLimit != null && person.received >= rule.intakeLimit) return false;
        return !rule?.markets?.length || rule.markets.includes(market);
      });
      if (!open.length) return null;
      const person = open[index % open.length];
      index += 1;
      person.received += 1;
      return person;
    },
  };
}

async function loadCollectionConfig(db, tenantId) {
  return sanitizeCollectionConfig(await getTenantSetting('collection_distribution', { tenantId, fallback: {}, db }) || {});
}

/** What each capped officer has received in their own period. */
async function collectionIntake(db, tenantId, members, now = new Date()) {
  const counts = new Map();
  const byPeriod = new Map();
  for (const member of members) {
    if (member.intakeLimit == null) continue;
    if (!byPeriod.has(member.intakePeriod)) byPeriod.set(member.intakePeriod, []);
    byPeriod.get(member.intakePeriod).push(member.staffId);
  }
  for (const [period, staffIds] of byPeriod) {
    const [rows] = await db.query(
      `SELECT assigned_cs_id AS id, COUNT(*) AS n FROM subscribers
        WHERE tenant_id=? AND deleted_at IS NULL AND assigned_cs_at >= ?
          AND assigned_cs_id IN (${staffIds.map(() => '?').join(',')})
        GROUP BY assigned_cs_id`,
      [tenantId, periodStart(period, now), ...staffIds]);
    rows.forEach(row => counts.set(String(row.id), Number(row.n) || 0));
  }
  return counts;
}

async function collectionStaff(db, tenantId) {
  const [rows] = await db.query(
    `SELECT id, name FROM staff
      WHERE tenant_id=? AND UPPER(role)='COLLECTION' AND is_active=1 AND deleted_at IS NULL ORDER BY name`,
    [tenantId]);
  return rows;
}

/** A picker for a whole run, loaded once. */
async function loadCollectionPicker(db, tenantId) {
  const [staff, config] = await Promise.all([collectionStaff(db, tenantId), loadCollectionConfig(db, tenantId)]);
  return createCollectionPicker(staff, config, await collectionIntake(db, tenantId, config.members));
}

/**
 * The officer for one new client, by the same rules as «توزيع غير المُسندين»,
 * or null when nobody takes them — they then wait unassigned, where the
 * distribute button and the settings find them. (It replaced a round-robin
 * that picked the least loaded employee whatever the settings said.)
 */
async function pickCollectionOfficer(db, tenantId, { market = 'local' } = {}) {
  const picker = await loadCollectionPicker(db, tenantId);
  const officer = picker.next(market);
  return officer ? { id: officer.id, name: officer.name } : null;
}

module.exports = {
  CLIENT_STATUSES, MARKETS, PERIODS,
  collectionIntake, createCollectionPicker, loadCollectionConfig, loadCollectionPicker,
  pickCollectionOfficer, sanitizeCollectionConfig, subscriberMarket,
};
