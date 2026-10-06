'use strict';
// What every part of routes/admin/leads/ requires, and the helpers more than
// one of them uses — one list, so the parts cannot drift onto different
// helpers for the same job.
const logger = require('../../../lib/logger');
const crypto   = require('crypto');
const bcrypt   = require('../../../lib/passwordHash');
const { uuidv4 } = require('../../../lib/id');
const { generateTemporaryPassword } = require('../../../lib/secureCredentials');

const { pool, cacheInvalidate } = require('../../../lib/db');
const { pickCollectionOfficer, subscriberMarket } = require('../../../lib/collectionDistribution');
const { LEAD_STATUSES, isOpenLeadStatus, TERMINAL_LIST, TERMINAL_SQL } = require('../../../lib/leadStatuses');
const { mailer } = require('../../../lib/email');
const { sendWhatsApp } = require('../../../lib/whatsapp');
const { tryJson, sanitize, parseLimit, parseOffset, parseCrm, calcLeadScoreServer, ymd, sendRouteError } = require('../../../lib/helpers');
const { COURSE_COLS, mapCourse, getNextClientCode } = require('../../../lib/mappers');
const { createNotification } = require('../../../lib/notification');
const { logLeadEvent, logLeadEventStrict } = require('../../../lib/crm');
const { normalizeLeadStatus, transitionLead } = require('../../../lib/leadState');
const { createRepRotation, distributionMode, getNextSalesRep, listDistributableReps } = require('../../../lib/leadAssignment');
const { DEFAULT_ARCHIVE_SOURCE, excludeArchiveSourcesSql } = require('../../../lib/leadArchive');
const { appendLeadInteraction, queueLeadWhatsAppBatch } = require('../../../lib/leadInteractions');
const { grantCourseEntitlement } = require('../../../lib/entitlements');
const { leadScope, branchesFromScope, DAQQI_TEAM_ROLES, BRANCH_DESK_ROLES } = require('../../../lib/leadAccess');
const { claimWhatsAppIdentity, findAccountByPhone } = require('../../../lib/whatsappOtp');
const {
  archiveLead,
  communicationsByLead,
  findLeadById,
  findLeadByIdentity,
} = require('../../../lib/leadRepository');
const {
  findLeadDuplicateGroups,
  listLeadMergeHistory,
  mergeLeads,
  unmergeLead,
} = require('../../../lib/leadMerge');
const { enqueueEmailSequence } = require('../../../lib/emailSequence');
const { ADMIN_EMAILS, requireAuth, requireAdmin, requireAdminOrStaff, requirePermission, requireAnyPermission } = require('../../../middleware/auth');
const { VALID_BRANCHES, VALID_PAY_TYPES, VALID_SOURCES } = require('../../../constants/permissions');
const { safeIsoString, safeDateOnly, sqlCairoToday, sqlCairoDayStartUtc, cairoToday, addDaysToDateOnly, cairoDayStartUtc } = require('../../../lib/dates');
const { keyset } = require('../../../lib/pagination');
const { leadTableFilter, leadTableSearch } = require('../../../lib/leadTableFilter');
const { leadPoolFilter, poolBreakdown, POOL_REASON_COLUMN } = require('../../../lib/leadPoolFilter');
const { identitySpellings } = require('../../../lib/phoneNumber');
const { branchIdForBranch } = require('../../../lib/branches');
const { postPaymentJournal, logPaymentAudit } = require('../../../lib/finance');
const { bulkOperationLimiter } = require('../../../middleware/rateLimits');
const { assertWritable } = require('../../../lib/periodLock');
const { staffOwnsEmail, STAFF_EMAIL_REFUSAL } = require('../../../lib/staffEmailGuard');
function cleanLegacyLeadText(value) {
  if (typeof value !== 'string') return value;
  return value
    .replace(/الفرع:\s*اون_لاين_داخ(?:ل|�+|\?+)_مصر/gi, 'الفرع: أونلاين مصر')
    .replace(/اون_لاين_داخ(?:ل|�+|\?+)_مصر/gi, 'أونلاين مصر')
    .replace(/اونلاين_داخل_مصر/gi, 'أونلاين مصر');
}

// Row → LeadItem, shared by every route that returns whole leads.
//
// This was inline in GET /api/admin/leads and nowhere else, because that route
// was the only way to get a lead out of the database. The reminders route needs
// the identical shape — same crm_json precedence, same lowercased status, same
// branch normalisation — and a second copy of it would drift.
function mapLeadRow(r, communicationsByLead) {
  const crm = parseCrm(r.crm_json);
  // client_code column is authoritative; crm_json clientCode is a fallback
  const clientCode = r.client_code || crm.clientCode || null;
  // Normalize status to lowercase (schema stores ENUM as uppercase: 'NEW','CONVERTED', etc.)
  const status = (r.status || 'new').toLowerCase();
  // DB columns take precedence over crm_json values for branch and interestedCourseIds
  const rawBranch = r.branch || crm.branch || null;

  const normB = rawBranch ? rawBranch.toUpperCase().replace(/[-\s]/g,'_') : null;
  const branch = (normB && VALID_BRANCHES.has(normB)) ? normB : rawBranch;
  const interestedCourseIds = tryJson(r.interested_course_ids_json, crm.interestedCourseIds || []);
  const dealValue = r.deal_value != null ? Number(r.deal_value) : (crm.dealValue || null);
  const canonicalCommunications = communicationsByLead.get(r.id);
  const communications = canonicalCommunications || [];
  // crm_json spread goes FIRST so explicit DB columns always win
  return { ...crm,
    id: r.id, name: r.name, email: r.email, phone: r.phone,
    source: r.source, status, notes: cleanLegacyLeadText(r.notes), createdAt: r.created_at,
    branch, rawBranch: cleanLegacyLeadText(crm.rawBranch || rawBranch || ''), interestedCourseIds, clientCode, dealValue,
    assignedSalesId: r.assigned_sales_id || null,
    assignedSalesName: r.assigned_sales_name || null,
    assignedCsId: r.assigned_cs_id || null,
    assignedCsName: r.assigned_cs_name || null,
    interestLevel: r.interest_level || crm.interestLevel || null,
    // ymd(), because next_follow_up_date is a DATETIME: mysql2 hands it back as
    // a Date, JSON turns that into '2026-08-23T00:00:00.000Z', and the reminders
    // panel compares it with === against a plain '2026-08-23'. That comparison
    // could never be true, so the "due today" column was always empty and today's
    // follow-ups were being listed under "upcoming" instead.
    nextFollowUpDate: ymd(r.next_follow_up_date) || crm.nextFollowUpDate || null,
    lastFollowUp: r.last_follow_up || crm.lastFollowUp || null,
    communications,
    communicationCount: Number(r.communication_count || 0),
    communications_count: Number(r.communication_count || 0),
  };
}

module.exports = {
  uuidv4,
  generateTemporaryPassword,
  pool,
  cacheInvalidate,
  pickCollectionOfficer,
  subscriberMarket,
  LEAD_STATUSES,
  isOpenLeadStatus,
  TERMINAL_LIST,
  TERMINAL_SQL,
  mailer,
  sendWhatsApp,
  tryJson,
  sanitize,
  parseLimit,
  parseOffset,
  parseCrm,
  calcLeadScoreServer,
  ymd,
  sendRouteError,
  COURSE_COLS,
  mapCourse,
  getNextClientCode,
  createNotification,
  logLeadEvent,
  logLeadEventStrict,
  normalizeLeadStatus,
  transitionLead,
  createRepRotation,
  distributionMode,
  getNextSalesRep,
  listDistributableReps,
  DEFAULT_ARCHIVE_SOURCE,
  excludeArchiveSourcesSql,
  appendLeadInteraction,
  queueLeadWhatsAppBatch,
  grantCourseEntitlement,
  leadScope,
  branchesFromScope,
  DAQQI_TEAM_ROLES,
  BRANCH_DESK_ROLES,
  claimWhatsAppIdentity,
  findAccountByPhone,
  archiveLead,
  communicationsByLead,
  findLeadById,
  findLeadByIdentity,
  findLeadDuplicateGroups,
  listLeadMergeHistory,
  mergeLeads,
  unmergeLead,
  enqueueEmailSequence,
  ADMIN_EMAILS,
  requireAuth,
  requireAdmin,
  requireAdminOrStaff,
  requirePermission,
  requireAnyPermission,
  VALID_BRANCHES,
  VALID_PAY_TYPES,
  VALID_SOURCES,
  safeIsoString,
  safeDateOnly,
  sqlCairoToday,
  sqlCairoDayStartUtc,
  cairoToday,
  addDaysToDateOnly,
  cairoDayStartUtc,
  keyset,
  leadTableFilter,
  leadTableSearch,
  leadPoolFilter,
  poolBreakdown,
  POOL_REASON_COLUMN,
  identitySpellings,
  branchIdForBranch,
  postPaymentJournal,
  logPaymentAudit,
  bulkOperationLimiter,
  assertWritable,
  staffOwnsEmail,
  STAFF_EMAIL_REFUSAL,
  logger,
  crypto,
  bcrypt,
  cleanLegacyLeadText,
  mapLeadRow,
};
