'use strict';

// Dropped in every API process at once, not only the one that took the save.
const { shared } = require('./cacheBus');

/**
 * Who may delete — anything, anywhere in the staff panel.
 *
 * The owner, 12 Oct 2026: «شيل من صلاحيات اي شخص غير المدير وليد وحازم ومهاب
 * الحذف اي ما كان سواء نشوى او خلود حذف عميل او حذف موظف او حذف حتي شخص منضم».
 *
 * Until then deleting was spread across a dozen permissions (delete_subscribers,
 * manage_hr, manage_join_us, the admin/manager roles …), so a branch manager
 * or anyone whose grid carried the right box could remove a client, an
 * employee or an applicant. The owner wants one short list of people instead,
 * whatever their role or grid says. This file is that list and the one check
 * every deletion asks:
 *
 *   • the owner always may (ADMIN_EMAILS / ADMIN_UIDS in the original
 *     institute; in another institute, whoever holds its top role, since the
 *     environment list stops at the original one and nobody else could ever
 *     save the list there);
 *   • otherwise the caller's staff id must be on the tenant setting
 *     `delete_rights` once the owner has saved it from «صلاحية الحذف»;
 *   • until it has been saved, the active staff whose name is Walid, Hazem or
 *     Mohab (Arabic or Latin) — so the deploy enforces the request on day one
 *     without anybody having to configure anything first.
 *
 * deleteRightsGuard refuses every HTTP DELETE under /api/admin and /api/staff
 * (mounted in lib/httpApp.js). Deletions that travel as POST — bulk clean-ups,
 * «مسح كورس من عميل», returning a client to the leads, an erasure approval —
 * carry requireDeleteRight on the route itself.
 */
const { pool } = require('./db');
const logger = require('./logger');
const { getTenantSetting, setTenantSetting } = require('./tenantSettings');
const { DEFAULT_TENANT_ID, findActiveStaff } = require('./authTenant');

const SETTING_KEY = 'delete_rights';
const CACHE_TTL_MS = 30 * 1000;
// Substring match on purpose: «وليد» finds «وليد محمد» and «م. وليد», and the
// Latin spellings cover an account created in English.
const DEFAULT_NAME_PATTERN = /وليد|حازم|مهاب|walid|waleed|hazem|hazim|mohab/i;
const REFUSAL_CODE = 'DELETE_NOT_ALLOWED';

/**
 * DELETE routes that stay open to anyone their own guards already admit.
 *
 * Each is something a person does to their own things, or an undo that removes
 * no record of a client, an employee or money. Kept short and with a reason,
 * because every line here is a hole in the owner's rule. `ownRows` means the
 * handler itself narrows a caller without the right to rows they created
 * (canDelete is asked there), so the route is open only for your own.
 */
const EXEMPT_DELETE_ROUTES = Object.freeze([
  {
    route: 'DELETE /api/staff/me/whatsapp-channel',
    reason: 'An employee disconnecting their own WhatsApp number from «واتسابي» — their own session, nothing of the institute is removed.',
  },
  {
    route: 'DELETE /api/admin/tasks/:id',
    ownRows: true,
    reason: 'Your own to-do list. Without the right, routes/campaigns.js deletes only a task you created yourself; one a manager assigned you stays.',
  },
  {
    route: 'DELETE /api/admin/team-inbox/quick-replies/:id',
    ownRows: true,
    reason: 'Your own saved reply. Without the right, routes/team-inbox.js deletes only one you wrote; a shared or a colleague’s reply stays.',
  },
  {
    route: 'DELETE /api/admin/subscribers/:id/devices',
    reason: 'Unlocks a client who changed phone (clears the device binding so they can sign in). The client, their courses and payments are untouched; customer service does it daily.',
  },
  {
    route: 'DELETE /api/admin/daqqi-rounds/:roundId/attendance/:subscriberId/:sessionNumber',
    reason: 'Takes back an attendance tap made by mistake at the Dokki desk — the undo of a mark, not the removal of a client from a round (that one is guarded).',
  },
  // The lecturer's portal (routes/lecturer-portal.js): each handler narrows the caller to their own rows, so these open nothing of anyone else's.
  {
    route: 'DELETE /api/staff/lecturer/lives/:id',
    reason: 'A lecturer cancelling their own live that has not started — the handler deletes only an UPCOMING live whose instructor is the caller.',
  },
  {
    route: 'DELETE /api/staff/lecturer/availability/blocked/:id',
    reason: 'A lecturer reopening a day they had closed on their own consultation hours — the handler is keyed on the caller’s own profile.',
  },
  {
    route: 'DELETE /api/staff/lecturer/rounds/:roundId/attendance/:subscriberId/:sessionNumber',
    reason: 'A lecturer taking back an attendance tap they made by mistake in their own round — the undo of a mark, not the removal of a client from a round.',
  },
  {
    route: 'DELETE /api/staff/lecturer/community/posts/:id',
    reason: 'A lecturer removing their own community post — the handler deletes only a post whose staff_id is the caller’s.',
  },
  {
    route: 'DELETE /api/staff/lecturer/community/comments/:id',
    reason: 'A lecturer removing their own comment, or a comment on their own post — nothing of a client’s record or money is removed.',
  },
]);

const routePattern = path => new RegExp(`^${String(path).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/:[A-Za-z_]+/g, '[^/]+')}/?$`);
const EXEMPT_MATCHERS = EXEMPT_DELETE_ROUTES.map(entry => {
  const [method, path] = entry.route.split(' ');
  return { method, pattern: routePattern(path), entry };
});

function exemptionFor(method, pathname) {
  const clean = String(pathname || '').split('?')[0];
  const verb = String(method || '').toUpperCase();
  return EXEMPT_MATCHERS.find(item => item.method === verb && item.pattern.test(clean))?.entry || null;
}

// tenantId → { at, value } — the list is asked on every DELETE and on every
// /api/auth/me, and changes only when the owner saves it.
const cache = new Map();

const invalidateDeleteRights = shared('delete-rights', function invalidateDeleteRightsHere(tenantId) {
  if (tenantId == null) cache.clear();
  else cache.delete(String(tenantId));
});

function storedIds(stored) {
  if (!stored || typeof stored !== 'object' || !Array.isArray(stored.staffIds)) return null;
  return [...new Set(stored.staffIds.map(id => String(id || '').trim()).filter(Boolean))].slice(0, 200);
}

/**
 * The tenant's list as it stands: { saved, staffIds, names }. `saved` is false
 * while the name-match default is in force.
 */
async function resolveDeleteRights(tenantId, { db = pool, fresh = false } = {}) {
  const key = String(tenantId || DEFAULT_TENANT_ID);
  const hit = cache.get(key);
  if (!fresh && hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;
  const [staff] = await db.query(
    `SELECT id, name FROM staff
      WHERE tenant_id=? AND is_active=1 AND deleted_at IS NULL
      ORDER BY name`,
    [key]
  );
  const stored = storedIds(await getTenantSetting(SETTING_KEY, { tenantId: key, fallback: null, db }));
  const chosen = stored
    ? staff.filter(row => stored.includes(String(row.id)))
    : staff.filter(row => DEFAULT_NAME_PATTERN.test(String(row.name || '')));
  const value = Object.freeze({
    saved: Boolean(stored),
    staffIds: Object.freeze(chosen.map(row => String(row.id))),
    names: Object.freeze(chosen.map(row => String(row.name || '').trim()).filter(Boolean)),
  });
  cache.set(key, { at: Date.now(), value });
  return value;
}

async function saveDeleteRights(tenantId, staffIds, { actorId = null, db = pool } = {}) {
  const ids = storedIds({ staffIds }) || [];
  await setTenantSetting(SETTING_KEY, { staffIds: ids, savedAt: new Date().toISOString(), savedBy: actorId }, { tenantId, actorId, db });
  invalidateDeleteRights(tenantId);
  return resolveDeleteRights(tenantId, { db, fresh: true });
}

/**
 * Until the owner saves the list, who may delete is whoever's NAME matches «وليد|حازم|مهاب» — a rule that follows a spelling, not a person: a
 * new employee called Mohab would hold the right the day they were hired, and a rename would take it away. This writes the people the rule
 * names today into the saved list once (nothing changes for anyone), so from then on it is those accounts, editable from «صلاحية الحذف».
 */
async function freezeDefaultDeleteRights(tenantId, { db = pool } = {}) {
  const stored = storedIds(await getTenantSetting(SETTING_KEY, { tenantId, fallback: null, db }));
  if (stored) return { frozen: false, reason: 'already saved' };
  const rights = await resolveDeleteRights(tenantId, { db, fresh: true });
  if (!rights.staffIds.length) return { frozen: false, reason: 'nobody matches yet' };
  await saveDeleteRights(tenantId, [...rights.staffIds], { actorId: null, db });
  return { frozen: true, names: [...rights.names] };
}

/** The caller's staff row, looked up once per request. */
async function callerStaff(req, db = pool) {
  if (req.staffRecord?.id) return req.staffRecord;
  if (req._deleteRightsStaff !== undefined) return req._deleteRightsStaff;
  const staff = req.user?.email
    ? await findActiveStaff(req, req.user.email, { query: db.query.bind(db) })
    : null;
  req._deleteRightsStaff = staff || null;
  return req._deleteRightsStaff;
}

async function isDeleteOwner(req, db = pool) {
  if (!req?.user) return false;
  // Required here, not at the top: middleware/auth pulls in half of lib/, and
  // this file is loaded by the app before any route.
  const { isInstituteOwner } = require('../middleware/auth');
  const tenantId = req.tenantId || req.user.tenant_id;
  if (isInstituteOwner({ email: req.user.email, uid: req.user.uid, tenantId })) return true;
  if (String(tenantId || DEFAULT_TENANT_ID) === DEFAULT_TENANT_ID) return false;
  const staff = await callerStaff(req, db);
  return String(staff?.role || '').toLowerCase() === 'admin';
}

/** May this request delete? The owner always; anyone else only from the list. */
async function canDelete(req, { db = pool } = {}) {
  if (!req?.user) return false;
  if (req._canDelete !== undefined) return req._canDelete;
  let allowed = await isDeleteOwner(req, db);
  if (!allowed) {
    const staff = await callerStaff(req, db);
    if (staff?.id) {
      const rights = await resolveDeleteRights(req.tenantId || req.user.tenant_id, { db });
      allowed = rights.staffIds.includes(String(staff.id));
    }
  }
  req._canDelete = allowed;
  return allowed;
}

const firstName = name => String(name || '').trim().split(/\s+/)[0] || '';

/** «الحذف لمهاب ووليد وحازم بس», from whoever the list names. */
function refusalMessage(names = []) {
  const people = [...new Set(names.map(firstName).filter(Boolean))];
  if (!people.length) return 'الحذف لصاحب المعهد بس';
  const joined = people.length === 1
    ? people[0]
    : `${people.slice(0, -1).join(' و')} و${people.at(-1)}`;
  return /^[\u0600-\u06FF]/.test(joined) ? `الحذف ل${joined} بس` : `الحذف لـ ${joined} بس`;
}

async function refuse(req, res, db = pool) {
  let names = [];
  try { names = (await resolveDeleteRights(req.tenantId, { db })).names; } catch (_) { /* the message falls back */ }
  return res.status(403).json({ error: refusalMessage(names), code: REFUSAL_CODE, allowed: names });
}

async function decideOrRefuse(req, res, next, db = pool) {
  try {
    if (await canDelete(req, { db })) return next();
    return refuse(req, res, db);
  } catch (error) {
    // Closed, not open: a deletion that cannot be checked does not happen.
    logger.error('[delete-rights]', error.message);
    return res.status(503).json({ error: 'مش قادرين نتأكد من صلاحية الحذف دلوقتي — جرّب تاني', code: 'DELETE_RIGHTS_UNAVAILABLE' });
  }
}

/**
 * Mounted on /api/admin and /api/staff ahead of every router. An HTTP DELETE
 * passes only for someone on the list, or on one of EXEMPT_DELETE_ROUTES.
 * `decide` is injectable so the route-walk test can run without a database.
 */
function createDeleteRightsGuard({ decide = decideOrRefuse } = {}) {
  return function deleteRightsGuard(req, res, next) {
    if (req.method !== 'DELETE') return next();
    const pathname = String(req.originalUrl || req.url || '').split('?')[0];
    if (exemptionFor('DELETE', pathname)) return next();
    if (req.user?.uid) return decide(req, res, next);
    // /api/staff has no global requireAuth in front of it; /api/admin does.
    const { requireAuth } = require('../middleware/auth');
    return requireAuth(req, res, () => decide(req, res, next));
  };
}

const deleteRightsGuard = createDeleteRightsGuard();

/**
 * For the deletions that are not an HTTP DELETE. Place after requireAuth.
 * A plain function (decideOrRefuse catches its own errors), so the async
 * wrapper in lib/registerRoutes.js leaves it — and its name — as it is.
 */
function requireDeleteRight(req, res, next) {
  return decideOrRefuse(req, res, next);
}

/** requireDeleteRight only when the body asks for the deleting variant. */
function requireDeleteRightWhen(predicate) {
  return function requireDeleteRightWhenAsked(req, res, next) {
    if (!predicate(req)) return next();
    return decideOrRefuse(req, res, next);
  };
}

module.exports = {
  DEFAULT_NAME_PATTERN,
  EXEMPT_DELETE_ROUTES,
  REFUSAL_CODE,
  SETTING_KEY,
  canDelete,
  createDeleteRightsGuard,
  deleteRightsGuard,
  exemptionFor,
  invalidateDeleteRights,
  isDeleteOwner,
  refusalMessage,
  requireDeleteRight,
  requireDeleteRightWhen,
  resolveDeleteRights,
  freezeDefaultDeleteRights,
  saveDeleteRights,
};
