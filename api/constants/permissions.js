'use strict';
/**
 * MASTER PERMISSIONS CONSTANTS
 * ─────────────────────────────────────────────────────────────────────────────
 * Single source of truth for ALL role/permission logic across the entire system.
 * Both backend (auth.js, routes) AND frontend (permissions.ts) are derived from
 * this definition. DO NOT duplicate these values elsewhere.
 *
 * Architecture:
 *   - ROLES          : canonical role identifiers
 *   - PERMISSIONS    : every permission token in the system
 *   - ROLE_PERMS     : default permissions per role (use '*' for full access)
 *   - ROLE_DATA_SCOPE: server-side data filtering rules per role
 *   - FULL_ACCESS    : roles that bypass all permission checks
 */

// ── 1. ROLES ──────────────────────────────────────────────────────────────────
const ROLES = Object.freeze({
  ADMIN:                    'admin',
  MANAGER:                  'manager',
  ONLINE_MANAGER:           'online_manager',
  SALES_COLLECTION_MANAGER: 'sales_collection_manager',
  SALES:                    'sales',
  COLLECTION:               'collection',
  SUPPORT:                  'support',
  DAQQI_MANAGER:            'daqqi_manager',
  RECEPTION_DAQQI:          'reception_daqqi',
  HR:                       'hr',
  ACCOUNTANT:               'accountant',
  CONSULTANT:               'consultant',
  TRAINER:                  'trainer',
  INSTRUCTOR:               'instructor',
});

// ── 2. PERMISSIONS ────────────────────────────────────────────────────────────
const PERMISSIONS = Object.freeze({
  // Dashboard
  VIEW_DASHBOARD:           'view_dashboard',
  // Leads (pipeline)
  VIEW_LEADS:               'view_leads',
  MANAGE_LEADS:             'manage_leads',
  DELETE_LEADS:             'delete_leads',
  EXPORT_LEADS:             'export_leads',
  // Online Clients (subscribers)
  VIEW_SUBSCRIBERS:         'view_subscribers',
  MANAGE_SUBSCRIBERS:       'manage_subscribers',
  DELETE_SUBSCRIBERS:       'delete_subscribers',
  EXPORT_SUBSCRIBERS:       'export_subscribers',
  // Courses & catalog
  VIEW_COURSES:             'view_courses',
  MANAGE_COURSES:           'manage_courses',
  MANAGE_LECTURES:          'manage_lectures',
  MANAGE_INSTRUCTORS:       'manage_instructors',
  MANAGE_BUNDLES:           'manage_bundles',
  MANAGE_TESTIMONIALS:      'manage_testimonials',
  MANAGE_DISCOUNTS:         'manage_discounts',
  // Consultations
  VIEW_CONSULTATIONS:       'view_consultations',
  MANAGE_CONSULTATIONS:     'manage_consultations',
  // Community
  VIEW_COMMUNITY:           'view_community',
  MANAGE_COMMUNITY:         'manage_community',
  // Staff
  VIEW_STAFF:               'view_staff',
  MANAGE_STAFF:             'manage_staff',
  VIEW_HR:                  'view_hr',
  MANAGE_HR:                'manage_hr',
  // Orders & Financial
  VIEW_ORDERS:              'view_orders',
  MANAGE_ORDERS:            'manage_orders',
  VIEW_FINANCIAL:           'view_financial',
  MANAGE_FINANCIAL:         'manage_financial',
  // Reports
  VIEW_REPORTS:             'view_reports',
  VIEW_ACTIVITY:            'view_activity',
  // Messaging
  MANAGE_INBOX:             'manage_inbox',
  MANAGE_NOTIFICATIONS:     'manage_notifications',
  MANAGE_CHANNEL_SETTINGS:  'manage_channel_settings',
  // HR / Content
  VIEW_JOIN_US:             'view_join_us',
  MANAGE_JOIN_US:           'manage_join_us',
  VIEW_CONTACTS:            'view_contacts',
  MANAGE_CONTACTS:          'manage_contacts',
  MANAGE_CONTENT:           'manage_content',
  // Daqqi
  MANAGE_DAQQI:             'manage_daqqi',
  // Client unified DB
  VIEW_CLIENT_DB:           'view_client_db',
  // AI
  ASK_AI:                   'ask_ai',
  MANAGE_AI_SETTINGS:       'manage_ai_settings',
  AI_DEV:                   'ai_dev',
  // Automation
  MANAGE_AUTOMATION:        'manage_automation',
});

// ── 3. ROLE DEFAULT PERMISSIONS ───────────────────────────────────────────────
// '*' = wildcard (full access, bypasses all checks)
const ROLE_PERMS = Object.freeze({
  [ROLES.ADMIN]:                    '*',
  [ROLES.MANAGER]:                  '*',
  [ROLES.ONLINE_MANAGER]:           '*',
  [ROLES.DAQQI_MANAGER]:            '*',

  [ROLES.SALES_COLLECTION_MANAGER]: [
    'view_dashboard',
    'view_leads', 'manage_leads', 'export_leads', 'delete_leads',
    'view_subscribers', 'manage_subscribers', 'export_subscribers',
    'view_orders', 'manage_orders',
    'view_financial', 'manage_financial',
    'view_reports', 'view_activity',
    'view_staff',
    'view_client_db',
    'ask_ai',
  ],

  [ROLES.SALES]: [
    'view_dashboard',
    'view_leads', 'manage_leads', 'export_leads',
    'view_subscribers',
    'view_orders',
    'view_consultations',
    'ask_ai',
  ],

  [ROLES.COLLECTION]: [
    'view_dashboard',
    'view_subscribers', 'manage_subscribers', 'export_subscribers',
    'view_orders', 'manage_orders',
    'view_financial', 'manage_financial',
    'view_reports',
    'view_client_db',
    'ask_ai',
  ],

  [ROLES.SUPPORT]: [
    'view_dashboard',
    'view_leads', 'manage_leads',
    'view_subscribers', 'manage_subscribers',
    'view_orders',
    'manage_inbox', 'manage_notifications',
    'view_consultations',
    'view_reports',
    'view_client_db',
    'ask_ai',
  ],

  [ROLES.RECEPTION_DAQQI]: [
    'view_dashboard',
    'view_leads', 'manage_leads',
    'view_subscribers', 'manage_subscribers',
    'view_orders', 'manage_orders',
    'manage_inbox',
    'manage_daqqi',
  ],

  [ROLES.HR]: [
    'view_dashboard',
    'view_staff', 'manage_staff', 'view_hr', 'manage_hr',
    'view_leads',
    'view_subscribers',
    'view_reports', 'view_activity',
    'view_join_us', 'manage_join_us',
    'view_contacts', 'manage_contacts',
    'ask_ai',
  ],

  [ROLES.ACCOUNTANT]: [
    'view_dashboard',
    'view_orders', 'manage_orders',
    'view_financial', 'manage_financial',
    'view_reports',
  ],

  [ROLES.CONSULTANT]: [
    'view_dashboard',
    'view_consultations', 'manage_consultations',
    'view_subscribers',
    'view_leads',
    'view_reports',
  ],

  [ROLES.TRAINER]: [
    'view_dashboard',
    'view_courses', 'manage_lectures',
    'view_subscribers',
    'view_consultations',
  ],

  [ROLES.INSTRUCTOR]: [
    'view_dashboard',
    'view_courses', 'manage_lectures',
    'view_subscribers',
  ],
});

// ── 4. FULL ACCESS ROLES ──────────────────────────────────────────────────────
// These roles bypass requirePermission checks entirely (wildcard access)
const FULL_ACCESS_ROLES = Object.freeze([
  ROLES.ADMIN,
  ROLES.MANAGER,
  ROLES.ONLINE_MANAGER,
  ROLES.DAQQI_MANAGER,
]);

// ── 5. DATA SCOPE PER ROLE ────────────────────────────────────────────────────
// Determines what rows a role sees when calling the unified endpoints.
// Used by GET /api/staff/subscribers and GET /api/staff/leads server-side.
const DATA_SCOPE = Object.freeze({
  // Full access — see everything
  [ROLES.ADMIN]:                    'all',
  [ROLES.MANAGER]:                  'all',
  [ROLES.ONLINE_MANAGER]:           'all',
  [ROLES.SALES_COLLECTION_MANAGER]: 'all',

  // Branch-specific
  [ROLES.DAQQI_MANAGER]:  'branch:DAQQI',
  [ROLES.RECEPTION_DAQQI]: 'branch:DAQQI',

  // Assigned only
  [ROLES.SALES]:      'assigned_sales',   // WHERE assigned_sales_id = me
  [ROLES.COLLECTION]: 'assigned_cs',      // WHERE assigned_cs_id = me

  // View-only (subscribers they're linked to)
  [ROLES.SUPPORT]:     'all',
  [ROLES.HR]:          'all',
  [ROLES.ACCOUNTANT]:  'all',
  [ROLES.CONSULTANT]:  'assigned_sales',
  [ROLES.TRAINER]:     'all',
  [ROLES.INSTRUCTOR]:  'all',
});

// ── 6. HELPER: resolve permissions for a staff record ─────────────────────────
/**
 * Returns the effective permission list for a staff record.
 * Priority: custom permissions_json override > role defaults > []
 *
 * @param {object} staffRecord  - { role, permissions_json }
 * @returns {string[]|'*'}
 */
// ── Runtime role overrides (RBAC from Settings) ──────────────────────────────
// Mirrors the frontend: the admin edits per-role permissions in the Settings page
// (saved to site_config content['rbac.roleOverrides']); the API loads them at
// startup + on change (see lib/rbacOverrides.js) and enforces them here.
// Full-access roles are NEVER restricted (prevents locking out admins).
let _roleOverrides = Object.create(null);

function setRoleOverrides(obj) {
  const next = Object.create(null);
  if (obj && typeof obj === 'object') {
    for (const [role, perms] of Object.entries(obj)) {
      const r = String(role).toLowerCase();
      if (FULL_ACCESS_ROLES.includes(r)) continue; // never override full-access roles
      if (Array.isArray(perms)) next[r] = perms.map(String);
    }
  }
  _roleOverrides = next;
  return _roleOverrides;
}

function getRoleOverrides() {
  return _roleOverrides;
}

// Effective default permissions for a role: an admin-defined override (if any)
// wins over the hard-coded ROLE_PERMS default; full-access roles are untouched.
function getEffectiveRoleDefaults(role) {
  const r = (role || '').toLowerCase();
  if (FULL_ACCESS_ROLES.includes(r)) return ROLE_PERMS[r];
  const override = _roleOverrides[r];
  if (Array.isArray(override)) return override;
  return ROLE_PERMS[r];
}

function resolvePermissions(staffRecord) {
  if (!staffRecord) return [];
  const role = (staffRecord.role || '').toLowerCase();

  // Custom per-user override stored in DB
  if (staffRecord.permissions_json) {
    try {
      const custom = typeof staffRecord.permissions_json === 'string'
        ? JSON.parse(staffRecord.permissions_json)
        : staffRecord.permissions_json;
      if (Array.isArray(custom) && custom.length > 0) return custom;
    } catch (_) { /* ignore */ }
  }

  // Role default (with admin-defined override applied)
  const def = getEffectiveRoleDefaults(role);
  if (def === '*') return '*';
  return Array.isArray(def) ? def : [];
}

/**
 * Returns true if the staff record has the given permission.
 */
function hasPermission(staffRecord, permission) {
  if (!staffRecord) return false;
  if (FULL_ACCESS_ROLES.includes((staffRecord.role || '').toLowerCase())) return true;
  const perms = resolvePermissions(staffRecord);
  if (perms === '*') return true;
  return perms.includes(permission);
}

// ── Shared domain constants (single source of truth for all routes) ──────────
const VALID_BRANCHES = new Set(['DAQQI','TAGAMOA','ONLINE_EGYPT','ONLINE_SAUDI','ONLINE_ABROAD','OTHER']);
const VALID_PAY_TYPES = new Set(['COURSE','CERTIFICATE','CONSULTATION','BOOK','CARNEH','OTHER']);
const VALID_SOURCES   = new Set(['web','staff','reception','daqqi','paymob','system']);

module.exports = {
  ROLES,
  PERMISSIONS,
  ROLE_PERMS,
  FULL_ACCESS_ROLES,
  DATA_SCOPE,
  resolvePermissions,
  hasPermission,
  setRoleOverrides,
  getRoleOverrides,
  getEffectiveRoleDefaults,
  VALID_BRANCHES,
  VALID_PAY_TYPES,
  VALID_SOURCES,
};
