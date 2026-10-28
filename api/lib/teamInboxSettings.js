'use strict';

// «كل واحدة هترد يظهرلها رسايلها فقط باسمها، واحنا بس اللي بنشوف كله» (28 Oct 2026): who sees which conversation in the team inbox
// («صندوق الرسائل» — the company WhatsApp, the Facebook page and Instagram in one place).
//
//   pool  (the default, as it has always been)  a rep sees the conversations assigned to her and the ones nobody has taken yet, and takes
//         one by answering it.
//   own   a rep sees only the conversations assigned to her, under her name. Nobody has to take anything: every new conversation is
//         given to a rep by the same round-robin that distributes leads, so none is left where no rep can see it. The people whose data
//         scope is «everything» (the owner, the sales manager) still see and move all of it.
//
// signReplies adds the rep's first name under each reply, so the customer, too, knows who is answering from the company number.

const { pool } = require('./db');
const { getTenantSetting, setTenantSetting } = require('./tenantSettings');

const SECTION = 'team_inbox';
const MODES = ['pool', 'own'];
const DEFAULTS = { repVisibility: 'pool', autoAssign: false, signReplies: false };
const TTL_MS = 30 * 1000;
const cache = new Map();

/** What is stored, as the three settings. «own» needs the automatic distribution, or a new conversation would be invisible to every rep. */
function clean(input = {}) {
  const repVisibility = MODES.includes(input.repVisibility) ? input.repVisibility : DEFAULTS.repVisibility;
  return {
    repVisibility,
    autoAssign: repVisibility === 'own' ? true : Boolean(input.autoAssign),
    signReplies: Boolean(input.signReplies),
  };
}

async function teamInboxSettings(tenantId, db = pool) {
  const hit = cache.get(tenantId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const saved = await getTenantSetting(SECTION, { tenantId, fallback: {}, db }).catch(() => ({}));
  const value = clean(saved && typeof saved === 'object' ? saved : {});
  cache.set(tenantId, { value, at: Date.now() });
  return value;
}

async function saveTeamInboxSettings(tenantId, patch, { actorId = null, db = pool } = {}) {
  const current = await teamInboxSettings(tenantId, db);
  const next = clean({ ...current, ...patch });
  await setTenantSetting(SECTION, next, { tenantId, actorId, db });
  cache.delete(tenantId);
  return next;
}

/**
 * May this person open this conversation? `seesAll` is the data scope «everything»; `me` the rep's staff id; the thread's
 * assigned_staff_id says whose it is (null: nobody's).
 */
function mayOpenThread({ seesAll, me, thread, settings }) {
  if (seesAll) return true;
  if (settings?.repVisibility === 'own') return Boolean(me) && thread.assigned_staff_id === me;
  return !thread.assigned_staff_id || thread.assigned_staff_id === me;
}

/** The list a rep may ask for: in «own» there is only «mine». */
function allowedView({ seesAll, requested, settings }) {
  if (!seesAll && settings?.repVisibility === 'own') return 'mine';
  return ['mine', 'unassigned', 'all'].includes(requested) ? requested : 'mine';
}

/** A reply, signed with the rep's first name when the option is on and the text is plain text. */
function signed(text, name, settings) {
  const first = String(name || '').trim().split(/\s+/)[0];
  if (!settings?.signReplies || !first || !String(text || '').trim()) return text;
  return `${String(text).trimEnd()}\n— ${first}`;
}

module.exports = { DEFAULTS, MODES, SECTION, allowedView, clean, mayOpenThread, saveTeamInboxSettings, signed, teamInboxSettings, _cache: cache };
