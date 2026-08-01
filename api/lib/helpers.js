'use strict';
// ── Input Sanitization ────────────────────────────────────────────────────────
// Strips HTML tags and dangerous characters from user-supplied strings.
// Applied at system boundaries (lead/subscriber saves) to prevent XSS stored in DB.
function sanitize(str, maxLen = 1000) {
  if (!str || typeof str !== 'string') return str;
  return str
    .replace(/<script[\s\S]*?<\/script>/gi, '')  // strip script blocks
    .replace(/<[^>]*>/g, '')                       // strip all HTML tags
    .replace(/javascript:/gi, '')                  // strip javascript: URIs
    .replace(/on\w+=/gi, '')                       // strip inline event handlers
    .trim()
    .substring(0, maxLen);
}

// ── Input Validation Helpers ──────────────────────────────────────────────────
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;
const PHONE_RE = /^[+\d\s\-().]{7,20}$/;

// Collapses the three ways an Egyptian number shows up (01xxxxxxxxx, 0020xxxxxxxxxx,
// +20xxxxxxxxxx) to the same bare digits, so phone-based dedup checks actually match
// across formats instead of only catching byte-for-byte identical strings.
function normalizePhone(phone) {
  // Same value as before, now computed in one place — see lib/phoneNumber.js.
  // Note this is the *identity* key, not something you can send a message to;
  // use toDialable for that.
  return require('./phoneNumber').toIdentity(phone);
}
function validate(body, schema) {
  for (const [field, rule] of Object.entries(schema)) {
    const [type, maxStr] = rule.split('|');
    const max = maxStr ? Number(maxStr) : undefined;
    const val = body[field];
    if (type === 'required' || type === 'string') {
      if (!val || typeof val !== 'string' || !val.trim()) return `${field} is required`;
      if (max && val.length > max) return `${field} exceeds max length ${max}`;
    } else if (type === 'email') {
      if (!val || !EMAIL_RE.test(String(val))) return `${field} must be a valid email`;
      if (max && String(val).length > max) return `${field} exceeds max length ${max}`;
    } else if (type === 'phone') {
      if (val && !PHONE_RE.test(String(val))) return `${field} must be a valid phone number`;
    } else if (type === 'number') {
      if (val !== undefined && val !== null && isNaN(Number(val))) return `${field} must be a number`;
      if (max !== undefined && Number(val) > max) return `${field} exceeds max value ${max}`;
    } else if (type === 'optional') {
      if (val !== undefined && val !== null && max && String(val).length > max) return `${field} exceeds max length ${max}`;
    }
  }
  return null; // valid
}

// ── Lead Score Computation ───────────────────────────────────────────────────
// IMPORTANT: Keep this in sync with calcLeadScore() in:
//   admin/pages/dashboard/tabs/LeadsTab.tsx
function calcLeadScoreServer(status, interestLevel, commsArr, nextFollowUpDate, interestedCourseIds, createdAt) {
  const s = (status || 'new').toLowerCase();
  const statusScore = {
    new: 5, contacted: 15, interested: 35, interested_booking: 35, interested_followup: 35,
    postpone_month: 10, no_answer: 8, no_answer_wa: 8, no_answer_nowa: 8,
    wrong_number: 0, with_colleague: 10,
    not_interested: 0, not_interested_hidden: 0,
    closed: 50, converted: 100, lost: 0, other: 2,
  };
  let score = statusScore[s] ?? 0;
  const il = (interestLevel || '').toLowerCase();
  if (il === 'high') score += 30;
  else if (il === 'medium') score += 15;
  else score += 5;
  const comms = Array.isArray(commsArr) ? commsArr : [];
  score += Math.min(comms.length * 5, 25);
  if (nextFollowUpDate) score += 5;
  if ((Array.isArray(interestedCourseIds) ? interestedCourseIds.length : 0) > 0) score += 10;

  // ── Time-based decay (skip terminal states) ──
  if (!['converted','lost','not_interested','not_interested_hidden','wrong_number'].includes(s)) {
    const now = Date.now();
    let lastContactMs = null;
    for (const c of comms) {
      if (c.date) {
        const ms = new Date(c.date.slice(0, 10)).getTime();
        if (!isNaN(ms) && (lastContactMs === null || ms > lastContactMs)) lastContactMs = ms;
      }
    }
    if (lastContactMs !== null) {
      const daysSinceContact = Math.floor((now - lastContactMs) / 86400000);
      if (daysSinceContact > 7) score -= Math.min((daysSinceContact - 7) * 2, 30);
    } else if (createdAt) {
      const daysSinceCreated = Math.floor((now - new Date(createdAt).getTime()) / 86400000);
      if (daysSinceCreated > 14) score -= Math.min((daysSinceCreated - 14) * 1, 20);
    }
  }

  return Math.min(Math.max(score, 0), 100);
}

// ── Data helpers ──────────────────────────────────────────────────────────────
function tryJson(str, fallback) {
  try { return str ? JSON.parse(str) : fallback; } catch { return fallback; }
}

// parseCrm: like tryJson but also unwraps any nested crm_json key left by old buggy saves.
function parseCrm(str) {
  const raw = tryJson(str, {});
  if (raw && typeof raw.crm_json === 'object' && raw.crm_json !== null) {
    const nested = raw.crm_json;
    delete raw.crm_json;
    return { ...nested, ...raw };
  }
  return raw;
}

// ── Pagination helpers ────────────────────────────────────────────────────────
const parseLimit  = (v, def = 100, max = 1000) => Math.min(parseInt(v) || def, max);
const parseOffset = (v)                          => parseInt(v) || 0;

module.exports = { sanitize, validate, EMAIL_RE, PHONE_RE, calcLeadScoreServer, tryJson, parseCrm, parseLimit, parseOffset, normalizePhone };
