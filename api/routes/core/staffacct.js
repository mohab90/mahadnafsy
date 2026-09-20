'use strict';

const express = require('express');
const router = express.Router();
const logger = require('../../lib/logger');
const { pool } = require('../../lib/db');
const { tryJson, parseLimit } = require('../../lib/helpers');
const { requireAuth, requireAdmin, requireAdminOrStaff, requirePermission } = require('../../middleware/auth');

router.get('/api/staff/me/preferences', requireAuth, async (req, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(400).json({ error: 'Tenant context required' });
    const email = String(req.user?.email || '').toLowerCase().trim();
    if (!email) return res.status(400).json({ error: 'No email in token' });
    const [[row]] = await pool.query(
      'SELECT preferences_json FROM staff WHERE tenant_id=? AND LOWER(TRIM(email))=? AND is_active=1 LIMIT 1',
      [tenantId, email]
    );
    // An owner or super-admin signed in by email has no staff row, and personal
    // preferences for such an account are legitimately empty — that is "nothing
    // set", not "not found". Answering 404 put one on every dashboard load for
    // those accounts: noise in the log, and a false alarm to anything watching
    // the error rate.
    if (!row) return res.json({});
    res.json(row.preferences_json ? tryJson(row.preferences_json, {}) : {});
  } catch (error) {
    logger.error('[staff-preferences]', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/api/staff/me/preferences', requireAuth, async (req, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(400).json({ error: 'Tenant context required' });
    const email = String(req.user?.email || '').toLowerCase().trim();
    if (!email) return res.status(400).json({ error: 'No email in token' });
    const body = req.body || {};
    const preferences = {
      waNumber: typeof body.waNumber === 'string' ? body.waNumber.slice(0, 30) : '',
      waTemplates: Array.isArray(body.waTemplates) ? body.waTemplates.slice(0, 50).map((template) => ({
        id: String(template?.id || '').slice(0, 80),
        title: String(template?.title || '').slice(0, 120),
        body: String(template?.body || '').slice(0, 4000),
      })).filter((template) => template.id && template.title) : [],
      customTags: Array.isArray(body.customTags) ? body.customTags.slice(0, 100).map(tag => String(tag).slice(0, 40)) : [],
    };
    const [result] = await pool.query(
      'UPDATE staff SET preferences_json=? WHERE tenant_id=? AND LOWER(TRIM(email))=? AND is_active=1',
      [JSON.stringify(preferences), tenantId, email]
    );
    if (!result.affectedRows) return res.status(404).json({ error: 'Staff not found' });
    res.json({ ok: true });
  } catch (error) {
    logger.error('[staff-preferences]', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/api/admin/consultations', requireAuth, requireAdminOrStaff, requirePermission('view_consultations'), async (req, res) => {
  try {
    const limit = parseLimit(req.query.limit, 500, 2000);
    const [rows] = await pool.query(
      `SELECT c.*, t.name AS t_name, t.specialty AS t_specialty
         FROM consultations c LEFT JOIN therapists t ON t.id=c.therapist_id
        WHERE c.tenant_id=? AND c.deleted_at IS NULL
        ORDER BY c.session_date DESC LIMIT ?`,
      [req.tenantId, limit]
    );
    // Mapped, like the therapist portal already does with this same table.
    //
    // These rows went out raw while every consultations screen in the admin
    // reads camelCase, so client, doctor and type all drew «—», the date read
    // «بدون تاريخ», the calendar was empty in every month, and «تأكيد» never
    // appeared. The status and session type are lower-cased for the same
    // reason: both enums are stored upper case and every screen compares them
    // in lower, so the counts on «القادمة» and its filters all read zero.
    res.json(rows.map(row => ({
      id: row.id,
      clientName: row.client_name,
      clientEmail: row.client_email || undefined,
      clientPhone: row.client_phone || undefined,
      therapistId: row.therapist_id,
      therapistName: row.t_name || undefined,
      therapistSpecialty: row.t_specialty || undefined,
      sessionType: String(row.session_type || 'INDIVIDUAL').toLowerCase(),
      sessionDate: row.session_date,
      slotId: row.slot_id || undefined,
      timezone: row.timezone || undefined,
      status: String(row.status || 'PENDING').toLowerCase(),
      notes: row.notes || '',
      amount: row.amount === null ? undefined : Number(row.amount),
      currency: row.currency || undefined,
      sessionDurationMinutes: row.session_duration_minutes || undefined,
      meetingLink: row.meeting_link || undefined,
      subscriberId: row.subscriber_id || undefined,
      branchId: row.branch_id || undefined,
      createdAt: row.created_at,
    })));
  } catch (error) {
    logger.error('[admin-consultations]', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
