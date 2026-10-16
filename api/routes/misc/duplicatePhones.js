'use strict';

// GET /api/admin/subscribers/duplicate-phones — clients who share one number.
//
// «في عملاء مكررة: في رقم اوله 0 ورقم تاني لاء … نعالج النقطة دي». The numbers are compared by
// their identity (the ten digits of an Egyptian mobile — lib/phoneNumber.js), as the first OR the
// second number of a client. Rows stored before one form was kept (migration 283) can still hold
// the same person twice; this lists them for the managers to merge. It only reads.

const express = require('express');
const { pool } = require('../../lib/db');
const logger = require('../../lib/logger');
const { requireAuth, requireAdminOrStaff, requirePermission } = require('../../middleware/auth');

const router = express.Router();
const VIEWERS = new Set(['admin', 'manager', 'online_manager', 'sales_collection_manager', 'daqqi_manager', 'tagamoa_manager', 'accountant']);

// The identity key in SQL: digits only, a trunk 0 or the 20 of Egypt taken off the front of a mobile.
const KEY = column => `CASE
  WHEN REGEXP_REPLACE(${column}, '[^0-9]', '') REGEXP '^(0020|20|0)?1[0125][0-9]{8}$'
    THEN RIGHT(REGEXP_REPLACE(${column}, '[^0-9]', ''), 10)
  ELSE REGEXP_REPLACE(${column}, '[^0-9]', '') END`;

router.get('/api/admin/subscribers/duplicate-phones', requireAuth, requireAdminOrStaff, requirePermission('view_subscribers'), async (req, res) => {
  try {
    if (!req.isSuperAdmin && !VIEWERS.has(String(req.staffRecord?.role || '').toLowerCase())) {
      return res.status(403).json({ error: 'غير مصرح', code: 'MANAGERS_ONLY' });
    }
    const [rows] = await pool.query(
      `SELECT x.phone_key, s.id, s.client_code, s.name, s.phone, s.phone2, s.branch, s.created_at,
              COALESCE(s.assigned_cs_name, s.assigned_sales_name) AS owner_name
         FROM (
           SELECT tenant_id, phone_key FROM (
             SELECT tenant_id, ${KEY('phone')} AS phone_key, id FROM subscribers WHERE tenant_id = ? AND deleted_at IS NULL AND phone_slot = 0 AND phone IS NOT NULL AND phone <> ''
             UNION ALL
             SELECT tenant_id, ${KEY('phone2')} AS phone_key, id FROM subscribers WHERE tenant_id = ? AND deleted_at IS NULL AND phone_slot = 0 AND phone2 IS NOT NULL AND phone2 <> ''
           ) keyed GROUP BY tenant_id, phone_key HAVING COUNT(DISTINCT id) > 1
         ) x
         JOIN subscribers s ON s.tenant_id = x.tenant_id AND s.deleted_at IS NULL AND s.phone_slot = 0
          AND (${KEY('s.phone')} = x.phone_key OR ${KEY('s.phone2')} = x.phone_key)
        ORDER BY x.phone_key, s.created_at LIMIT 2000`,
      [req.tenantId, req.tenantId]);
    const groups = new Map();
    for (const row of rows) {
      if (!groups.has(row.phone_key)) groups.set(row.phone_key, []);
      groups.get(row.phone_key).push({
        id: row.id, clientCode: row.client_code || null, name: row.name || '', phone: row.phone || '', phone2: row.phone2 || '',
        branch: row.branch || null, owner: row.owner_name || null, createdAt: row.created_at,
      });
    }
    res.json({ groups: [...groups].map(([key, clients]) => ({ key, clients })), count: groups.size });
  } catch (error) {
    logger.error('[duplicate-phones]', error.message);
    res.status(500).json({ error: 'تعذّر فحص الأرقام المكررة' });
  }
});

// GET /api/admin/subscribers/phone-holder?phone= — who holds a number now, for the form that is being filled:
// it can then offer «ده شخص تاني بنفس الرقم» instead of waiting for the refusal. Name and code only.
router.get('/api/admin/subscribers/phone-holder', requireAuth, requireAdminOrStaff, requirePermission('view_subscribers'), async (req, res) => {
  try {
    const { clientHoldingPhone } = require('../../lib/phoneDuplicates');
    const { completeForBranch, toIdentity } = require('../../lib/phoneNumber');
    const phone = toIdentity(completeForBranch(String(req.query.phone || '').slice(0, 30), String(req.query.branch || '')));
    if (!phone || phone.length < 9) return res.json({ holder: null });
    const holder = await clientHoldingPhone(pool, { tenantId: req.tenantId, phones: [phone] });
    res.json({ holder: holder ? { id: holder.id, name: holder.name || '', clientCode: holder.client_code || null } : null });
  } catch (error) {
    logger.error('[phone-holder]', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
