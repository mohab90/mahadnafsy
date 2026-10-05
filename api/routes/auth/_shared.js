'use strict';
// What every part of routes/auth/ requires — one list, so the parts cannot
// drift onto different helpers for the same job.
const logger = require('../../lib/logger');

const bcrypt = require('../../lib/passwordHash');
const jwt    = require('jsonwebtoken');
const { createHmac } = require('crypto');
const { resolveSecret } = require('../../lib/secretResolver');
const { uuidv4 } = require('../../lib/id');
const { assertGrantable, heldByTarget } = require('../../lib/permissionGrant');
const { generateTemporaryPassword, generateNumericCode } = require('../../lib/secureCredentials');

const { pool, getStaffIdByEmail, requireDb } = require('../../lib/db');
const { queuePaymentReceipt } = require('../../lib/paymentReceipt');
const { resolveCatalogPrice } = require('../../lib/catalogPrice');
const { setAgreedPrice } = require('../../lib/agreedPrice');
const { sanitize, validate, EMAIL_RE, PHONE_RE } = require('../../lib/helpers');
const { sendEmail: sendEmailBase, htmlEmail, mailer } = require('../../lib/email');
const { describeReason, sendWhatsApp } = require('../../lib/whatsapp');
const { enqueueEmailSequence } = require('../../lib/emailSequence');
const { branchIdForBranch } = require('../../lib/branches');
const { grantCourseSelections } = require('../../lib/entitlements');
const {
  JWT_SECRET, signAccessToken, setAuthCookie, clearAuthCookie, tokenExpiryMs, revokeToken,
} = require('../../lib/token');
const {
  ADMIN_EMAILS, ADMIN_UIDS, requireAuth, requireAdmin, requireSuperAdmin,
  requireAdminOrOnlineManager, requireAdminOrStaff, requirePermission, invalidateIdentity,
} = require('../../middleware/auth');
const { registerLimiter, loginLimiter, otpLimiter, forgotPasswordLimiter, bulkOperationLimiter } = require('../../middleware/rateLimits');
const { isString, isEmail, validateBody } = require('../../middleware/validate');
const { postPaymentJournal, logPaymentAudit } = require('../../lib/finance');
const { assertWritable } = require('../../lib/periodLock');
const { logLoginAttempt } = require('../../lib/loginAudit');
const { hasPermission, FULL_ACCESS_ROLES, resolvePermissions } = require('../../constants/permissions');
const { getMfaPolicy, policyRequiresStaff } = require('../../lib/mfaPolicy');
const { requireTenantQuota } = require('../../middleware/tenantQuota');
const { resolveClientContext, getClientIp, hashClientIp } = require('../../lib/clientContext');
const { ensureLeadForUser } = require('../../lib/registrationLead');
const { recordPaymentCompensation } = require('../../lib/paymentCompensation');
const { createSessionBinding, rotateSingleSession, closeSingleSession } = require('../../lib/singleSession');
const { registerCustomerDevice } = require('../../lib/customerDevices');
const { getSharingLock, enforceSharingLimit } = require('../../lib/accountSharingGuard');
const {
  requestLoginCode, verifyLoginCode, CODE_TTL_MINUTES: WA_CODE_TTL_MINUTES,
  claimWhatsAppIdentity, normalizeWhatsAppNumber, isPlausibleNumber,
} = require('../../lib/whatsappOtp');
const { isRealPhone, toDialable, identitySpellings } = require('../../lib/phoneNumber');
const { cairoToday } = require('../../lib/dates');

module.exports = {
  logger,
  bcrypt,
  jwt,
  createHmac,
  resolveSecret,
  uuidv4,
  assertGrantable,
  heldByTarget,
  generateTemporaryPassword,
  generateNumericCode,
  pool,
  getStaffIdByEmail,
  requireDb,
  queuePaymentReceipt,
  resolveCatalogPrice,
  setAgreedPrice,
  sanitize,
  validate,
  EMAIL_RE,
  PHONE_RE,
  sendEmailBase,
  htmlEmail,
  mailer,
  describeReason,
  sendWhatsApp,
  enqueueEmailSequence,
  branchIdForBranch,
  grantCourseSelections,
  JWT_SECRET,
  signAccessToken,
  setAuthCookie,
  clearAuthCookie,
  tokenExpiryMs,
  revokeToken,
  ADMIN_EMAILS,
  ADMIN_UIDS,
  requireAuth,
  requireAdmin,
  requireSuperAdmin,
  requireAdminOrOnlineManager,
  requireAdminOrStaff,
  requirePermission,
  invalidateIdentity,
  registerLimiter,
  loginLimiter,
  otpLimiter,
  forgotPasswordLimiter,
  bulkOperationLimiter,
  isString,
  isEmail,
  validateBody,
  postPaymentJournal,
  logPaymentAudit,
  assertWritable,
  logLoginAttempt,
  hasPermission,
  FULL_ACCESS_ROLES,
  resolvePermissions,
  getMfaPolicy,
  policyRequiresStaff,
  requireTenantQuota,
  resolveClientContext,
  getClientIp,
  hashClientIp,
  ensureLeadForUser,
  recordPaymentCompensation,
  createSessionBinding,
  rotateSingleSession,
  closeSingleSession,
  registerCustomerDevice,
  getSharingLock,
  enforceSharingLimit,
  requestLoginCode,
  verifyLoginCode,
  WA_CODE_TTL_MINUTES,
  claimWhatsAppIdentity,
  normalizeWhatsAppNumber,
  isPlausibleNumber,
  isRealPhone,
  toDialable,
  identitySpellings,
  cairoToday,
};
