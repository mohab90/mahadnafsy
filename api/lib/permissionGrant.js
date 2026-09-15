'use strict';

/**
 * One place that decides whether a permission grant is allowed.
 *
 * Four routes wrote `staff.permissions_json` and each checked something
 * different:
 *
 *   hr/employees.js (update)  super-admin only, validated against the master
 *                             list — the strict one, and the model for this;
 *   staff.js (create)         refused a permission the caller did not hold,
 *                             but only when it arrived as `permissions`. Send
 *                             the same list as a `permissions_json` string and
 *                             the check never ran, because it tested
 *                             `Array.isArray(s.permissions)` while the value
 *                             actually stored came from `s.permissions_json`;
 *   hr/talent.js (hire)       validated the names, never asked whether the
 *                             caller held them;
 *   auth.js (staff-account)   took the list straight into the INSERT.
 *
 * The last one matters most. `manage_staff` is the right to onboard staff —
 * staff.js says so in its own comment about roles — and it was also the right
 * to mint an account holding any permission in the system, with a password the
 * creator chooses. Log in as it and the escalation is complete. The role guard
 * on that route blocks ADMIN and MANAGER; permissions are a separate axis and
 * were not guarded at all.
 *
 * Two rules, both needed:
 *   1. a permission must exist — a typo must not silently store a grant that
 *      resolves to nothing, or hide one that should have been there;
 *   2. nobody hands out what they were not given. A super-admin is exempt;
 *      that is what super-admin means.
 */

const { PERMISSIONS, resolvePermissions, getEffectiveRoleDefaults } = require('../constants/permissions');

const ALL_PERMISSIONS = new Set(Object.values(PERMISSIONS));

/**
 * Normalise whichever shape the caller used into an array, or undefined when
 * the request did not mention permissions at all.
 *
 * `permissions_json` is accepted because the admin sends it, and because
 * ignoring it is how the old guard was bypassed — a field that reaches the
 * INSERT has to reach the check too.
 */
function readRequestedPermissions(body = {}) {
  const raw = body.permissions !== undefined ? body.permissions : body.permissions_json;
  if (raw === undefined || raw === null) return undefined;
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      return Array.isArray(parsed) ? parsed.map(String) : null;   // null = malformed
    } catch { return null; }
  }
  return null;
}

/**
 * @returns {{ok: true, permissionsJson: string|null}
 *          |{ok: false, status: number, body: object}}
 *
 * `permissionsJson` is null when the request asked for no override, which
 * resolvePermissions reads as "fall back to the role defaults" — storing '[]'
 * instead would claim an explicit grant of nothing.
 */
function assertGrantable(req, body = {}, { alreadyHeld = [] } = {}) {
  const requested = readRequestedPermissions(body);
  if (requested === undefined) return { ok: true, permissionsJson: null };
  if (requested === null) {
    return { ok: false, status: 400, body: { error: 'permissions must be an array', code: 'PERMISSIONS_MALFORMED' } };
  }

  const unknown = requested.filter(permission => !ALL_PERMISSIONS.has(permission));
  if (unknown.length) {
    return {
      ok: false,
      status: 400,
      body: { error: `صلاحيات غير معروفة: ${unknown.join(', ')}`, code: 'PERMISSIONS_UNKNOWN' },
    };
  }

  if (!req?.isSuperAdmin) {
    const own = resolvePermissions(req?.staffRecord);
    const mine = own === '*' ? ALL_PERMISSIONS : new Set(own || []);
    // What the target already holds is not being granted by this caller. The
    // "create a login" screen re-sends the employee's whole record, stored
    // permissions included, and the role the caller picked brings its defaults
    // with or without a list — refusing either would block an action that
    // hands out nothing new. Only additions beyond both are the caller's grant.
    const held = new Set(Array.isArray(alreadyHeld) ? alreadyHeld.map(String) : []);
    const overreach = requested.filter(permission => !mine.has(permission) && !held.has(permission));
    if (overreach.length) {
      return {
        ok: false,
        status: 403,
        body: {
          error: `مش مسموح تمنح صلاحيات مش عندك: ${overreach.join(', ')}`,
          code: 'PERMISSION_OVERREACH',
        },
      };
    }
  }

  const unique = [...new Set(requested)];
  return { ok: true, permissionsJson: unique.length ? JSON.stringify(unique) : null };
}

/**
 * Everything a target already legitimately has: its stored record's effective
 * permissions and the defaults of the role it is being given. A role whose
 * defaults are '*' contributes nothing here — the privileged-role guards on the
 * calling routes decide who may assign those, not this.
 */
function heldByTarget({ existingStaff = null, role = null, tenantId } = {}) {
  const held = new Set();
  if (existingStaff) {
    const current = resolvePermissions(existingStaff);
    if (Array.isArray(current)) current.forEach(p => held.add(String(p)));
  }
  if (role) {
    const defaults = getEffectiveRoleDefaults(String(role).toLowerCase(), tenantId);
    if (Array.isArray(defaults)) defaults.forEach(p => held.add(String(p)));
  }
  return [...held];
}

module.exports = { ALL_PERMISSIONS, assertGrantable, heldByTarget, readRequestedPermissions };
