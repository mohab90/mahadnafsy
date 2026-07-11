'use strict';
const logger = require('../../lib/logger');
const crypto   = require('crypto');
const express  = require('express');
const router   = express.Router();
const { uuidv4 } = require('../../lib/id');

const { pool, cacheInvalidate } = require('../../lib/db');
const { mailer, sendEmail, htmlEmail } = require('../../lib/email');
const { sendWhatsApp } = require('../../lib/whatsapp');
const { tryJson, sanitize, parseLimit, parseOffset, validate } = require('../../lib/helpers');
const { COURSE_COLS, mapCourse, mapBundle, mapTherapist, getNextClientCode } = require('../../lib/mappers');
const { createNotification } = require('../../lib/notification');
const { logPaymentAudit, logFinancialAudit, postJournalEntry, _paymentAccountCode, _expenseAccountCode, toEgp } = require('../../lib/finance');
const { assertWritable } = require('../../lib/periodLock');
const { syncLeadDealValue } = require('../public-orders');
const { logLeadEvent } = require('../../lib/crm');
const { enqueueEmailSequence } = require('../../lib/emailSequence');
const { ADMIN_EMAILS, ADMIN_UIDS, requireAuth, requireAdmin, requireSuperAdmin, requireAdminOrStaff, requirePermission } = require('../../middleware/auth');
const { paymobLimiter, whatsappSendLimiter, publicLimiter, contactLimiter } = require('../../middleware/rateLimits');
const { safeDateOnly } = require('../../lib/dates');
const { isString, validateBody } = require('../../middleware/validate');

router.post('/api/admin/staff', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const s = req.body;
    const id = s.id || uuidv4();
    // Accept both camelCase (frontend) and snake_case (direct DB) field names
    const role           = ((s.role || 'other').toUpperCase());  // DB ENUM is uppercase
    const firebaseUid    = s.firebaseUid    || s.firebase_uid    || null;
    // Normalise to a MySQL DATETIME literal — a raw ISO string ('...T...Z') is
    // rejected by DATETIME columns, which 500'd staff creation when no date was supplied.
    const joinedAt       = String(s.joinedAt || s.joined_at || new Date().toISOString()).slice(0, 19).replace('T', ' ');
    const commissionRate = s.commissionRate || s.commission_rate || null;
    const isActive       = s.is_active !== undefined ? s.is_active
                         : (s.status === 'inactive' ? 0 : 1);
    const permissionsJson = s.permissions_json
      || (Array.isArray(s.permissions) ? JSON.stringify(s.permissions) : null);
    // Sales-target / bonus fields (camelCase from frontend or snake_case direct).
    // `undefined` is coalesced to null so the field is cleared rather than left stale.
    const numOrNull = (v) => (v === undefined || v === null || v === '' ? null : Number(v));
    const monthlyTarget      = numOrNull(s.monthlyTarget      ?? s.monthly_target);
    const monthlyTargetType  = s.monthlyTargetType ?? s.monthly_target_type ?? null;
    const monthlyLeadsTarget = numOrNull(s.monthlyLeadsTarget ?? s.monthly_leads_target);
    const monthlyBonus       = numOrNull(s.monthlyBonus       ?? s.monthly_bonus);
    await pool.query(
      `INSERT INTO staff (id, firebase_uid, name, email, phone, role, image, specialization, joined_at, is_active, notes, commission_rate, permissions_json, monthly_target, monthly_target_type, monthly_leads_target, monthly_bonus)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE name=VALUES(name), phone=VALUES(phone), role=VALUES(role), image=VALUES(image), is_active=VALUES(is_active), notes=VALUES(notes), commission_rate=VALUES(commission_rate), permissions_json=VALUES(permissions_json), monthly_target=VALUES(monthly_target), monthly_target_type=VALUES(monthly_target_type), monthly_leads_target=VALUES(monthly_leads_target), monthly_bonus=VALUES(monthly_bonus)`,
      [id, firebaseUid, s.name||'', s.email||'', s.phone||'', role, s.image||null, s.specialization||null, joinedAt, isActive, s.notes||null, commissionRate, permissionsJson, monthlyTarget, monthlyTargetType, monthlyLeadsTarget, monthlyBonus]
    );
    res.json({ ok: true, id });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// GET /api/admin/staff
// (removed dead duplicate GET /api/admin/staff — live in an earlier-mounted router)

// GET /api/staff/me — any authenticated user can get their own staff record (for role-based dashboard)
router.get('/api/staff/me', requireAuth, async (req, res) => {
  try {
    const email = (req.user?.email || '').toLowerCase().trim();
    if (!email) return res.status(400).json({ error: 'No email in token' });
    const [rows] = await pool.query(
      'SELECT id, firebase_uid, name, email, phone, role, is_active, image, specialization, joined_at, created_at, notes, commission_rate, permissions_json FROM staff WHERE LOWER(email) COLLATE utf8mb4_unicode_ci = ? AND is_active = 1 LIMIT 1',
      [email]
    );
    if (!rows.length) return res.json(null);
    const r = rows[0];
    res.json({
      id: r.id,
      name: r.name || '',
      email: r.email || '',
      phone: r.phone || '',
      role: (r.role || 'other').toLowerCase(),
      status: r.is_active ? 'active' : 'inactive',
      image: r.image || null,
      specialization: r.specialization || null,
      joinedAt: r.joined_at || r.created_at || null,
      firebaseUid: r.firebase_uid || null,
      commissionRate: r.commission_rate || null,
      notes: r.notes || null,
      permissions: r.permissions_json ? tryJson(r.permissions_json, []) : [],
    });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// PATCH /api/staff/me — update own safe profile fields (name, phone, image)
router.patch('/api/staff/me', requireAuth, async (req, res) => {
  try {
    const email = (req.user?.email || '').toLowerCase().trim();
    if (!email) return res.status(400).json({ error: 'No email in token' });
    const { name, phone, image } = req.body || {};
    const fields = [];
    const vals = [];
    if (name !== undefined && typeof name === 'string') { fields.push('name = ?'); vals.push(name.slice(0, 120)); }
    if (phone !== undefined && typeof phone === 'string') { fields.push('phone = ?'); vals.push(phone.slice(0, 30)); }
    if (image !== undefined && (image === null || typeof image === 'string')) { fields.push('image = ?'); vals.push(image ? image.slice(0, 500) : null); }
    if (fields.length === 0) return res.status(400).json({ error: 'No updatable fields provided' });
    vals.push(email);
    await pool.query(`UPDATE staff SET ${fields.join(', ')} WHERE LOWER(email) COLLATE utf8mb4_unicode_ci = ?`, vals);
    res.json({ ok: true });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// GET /api/staff/me/preferences — own personal settings (WhatsApp number,
// message templates, custom tags). Stored server-side per staff so they follow
// the user across devices instead of living in localStorage.
router.get('/api/staff/me/preferences', requireAuth, async (req, res) => {
  try {
    const email = (req.user?.email || '').toLowerCase().trim();
    if (!email) return res.status(400).json({ error: 'No email in token' });
    const [[row]] = await pool.query(
      'SELECT preferences_json FROM staff WHERE LOWER(email) COLLATE utf8mb4_unicode_ci = ? LIMIT 1', [email]);
    res.json(row && row.preferences_json ? tryJson(row.preferences_json, {}) : {});
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// PUT /api/staff/me/preferences — replace own preferences blob (whitelisted keys)
router.put('/api/staff/me/preferences', requireAuth, async (req, res) => {
  try {
    const email = (req.user?.email || '').toLowerCase().trim();
    if (!email) return res.status(400).json({ error: 'No email in token' });
    const body = req.body || {};
    // Whitelist + cap sizes to keep the blob sane.
    const prefs = {
      waNumber: typeof body.waNumber === 'string' ? body.waNumber.slice(0, 30) : '',
      waTemplates: Array.isArray(body.waTemplates) ? body.waTemplates.slice(0, 50) : [],
      customTags: Array.isArray(body.customTags) ? body.customTags.slice(0, 100).map(t => String(t).slice(0, 40)) : [],
    };
    await pool.query(
      'UPDATE staff SET preferences_json = ? WHERE LOWER(email) COLLATE utf8mb4_unicode_ci = ?',
      [JSON.stringify(prefs), email]);
    res.json({ ok: true });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// GET /api/admin/consultations
router.get('/api/admin/consultations', requireAuth, requireAdmin, async (req, res) => {
  try {
    const limit = parseLimit(req.query.limit, 500, 2000);
    const [rows] = await pool.query(
      `SELECT c.*, t.name AS t_name, t.specialty AS t_specialty
       FROM consultations c
       LEFT JOIN therapists t ON t.id = c.therapist_id
       WHERE c.tenant_id = ?
       ORDER BY c.session_date DESC LIMIT ?`, [req.tenantId, limit]);
    res.json(rows);
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// GET /api/admin/activity-logs
module.exports = router;
