'use strict';

const express = require('express');
const router = express.Router();

const { pool } = require('../lib/db');
const { uuidv4 } = require('../lib/id');
const logger = require('../lib/logger').child({ module: 'dokki-operations-route' });
const { DEFAULT_TENANT_ID, resolveTenantId } = require('../lib/tenantScope');
const { requireAuth, requireAdmin } = require('../middleware/auth');

function scopedTenantId(req) {
  return req.tenantId || resolveTenantId(req) || DEFAULT_TENANT_ID;
}

function routeError(res, error, message = 'dokki operation failed') {
  logger.error(message, error);
  return res.status(500).json({ error: 'Internal server error' });
}

// GET /api/admin/dokki/classrooms
router.get('/api/admin/dokki/classrooms', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT c.*,
        (SELECT COUNT(*) FROM classroom_bookings b WHERE b.classroom_id = c.id AND b.end_time >= NOW()) AS upcoming_bookings
       FROM physical_classrooms c
       WHERE c.is_active = 1
       ORDER BY c.name ASC`
    );
    res.json(rows);
  } catch (e) {
    routeError(res, e, 'dokki classrooms list failed');
  }
});

// POST /api/admin/dokki/classrooms
router.post('/api/admin/dokki/classrooms', requireAuth, requireAdmin, async (req, res) => {
  try {
    const id = req.body?.id || uuidv4();
    await pool.query(
      `INSERT INTO physical_classrooms (id, tenant_id, branch_id, name, capacity, is_active)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE name=VALUES(name), capacity=VALUES(capacity), branch_id=VALUES(branch_id), is_active=VALUES(is_active)`,
      [id, scopedTenantId(req), req.body?.branch_id || req.body?.branchId || 'branch-daqqi', req.body?.name || '', Number(req.body?.capacity || 0), req.body?.is_active === false ? 0 : 1]
    );
    res.json({ ok: true, id });
  } catch (e) {
    routeError(res, e, 'dokki classroom save failed');
  }
});

// POST /api/admin/dokki/classrooms/book
router.post('/api/admin/dokki/classrooms/book', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { classroom_id, course_id, staff_id, start_time, end_time, purpose } = req.body || {};
    if (!classroom_id || !start_time || !end_time) return res.status(400).json({ error: 'classroom_id, start_time and end_time required' });
    if (new Date(start_time) >= new Date(end_time)) return res.status(400).json({ error: 'end_time must be after start_time' });

    const [conflicts] = await pool.query(
      `SELECT id FROM classroom_bookings
       WHERE classroom_id = ?
         AND start_time < ?
         AND end_time > ?
       LIMIT 1`,
      [classroom_id, end_time, start_time]
    );
    if (conflicts.length) return res.status(409).json({ error: 'Classroom is already booked for this time slot' });

    const id = uuidv4();
    await pool.query(
      `INSERT INTO classroom_bookings
        (id, tenant_id, classroom_id, course_id, staff_id, start_time, end_time, purpose, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, scopedTenantId(req), classroom_id, course_id || null, staff_id || null, start_time, end_time, purpose || null, req.user?.email || req.user?.uid || null]
    );
    res.json({ ok: true, id });
  } catch (e) {
    routeError(res, e, 'dokki classroom booking failed');
  }
});

// POST /api/admin/dokki/checkins
router.post('/api/admin/dokki/checkins', requireAuth, requireAdmin, async (req, res) => {
  try {
    const qr = String(req.body?.qr_code_content || req.body?.code || '').trim();
    if (!qr) return res.status(400).json({ error: 'qr_code_content required' });
    const [[subscriber]] = await pool.query(
      `SELECT id, name, tenant_id FROM subscribers
       WHERE id = ? OR client_code = ? OR LOWER(TRIM(email)) = LOWER(TRIM(?))
       LIMIT 1`,
      [qr, qr, qr]
    );
    if (!subscriber) return res.status(404).json({ error: 'Student not found' });

    const id = uuidv4();
    await pool.query(
      `INSERT INTO physical_checkins (id, tenant_id, subscriber_id, branch_id, source, checked_in_by, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, subscriber.tenant_id || scopedTenantId(req), subscriber.id, req.body?.branch_id || 'branch-daqqi', req.body?.source || 'qr', req.user?.email || req.user?.uid || null, req.body?.notes || null]
    );
    await pool.query(
      `INSERT INTO activity_logs (entity_type, entity_id, action, ip_address, description)
       VALUES ('SUBSCRIBER', ?, 'PHYSICAL_CHECKIN', ?, ?)`,
      [subscriber.id, req.ip, `Physical check-in at ${req.body?.branch || 'Dokki'}`]
    ).catch(() => {});
    res.json({ ok: true, id, subscriber: { id: subscriber.id, name: subscriber.name } });
  } catch (e) {
    routeError(res, e, 'dokki checkin failed');
  }
});

// GET /api/admin/dokki/inventory
router.get('/api/admin/dokki/inventory', requireAuth, requireAdmin, async (_req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM inventory_items WHERE is_active = 1 ORDER BY name ASC');
    res.json(rows);
  } catch (e) {
    routeError(res, e, 'dokki inventory list failed');
  }
});

// POST /api/admin/dokki/inventory/items
router.post('/api/admin/dokki/inventory/items', requireAuth, requireAdmin, async (req, res) => {
  try {
    const id = req.body?.id || uuidv4();
    await pool.query(
      `INSERT INTO inventory_items (id, tenant_id, name, sku, stock_quantity, unit, branch_id, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE name=VALUES(name), sku=VALUES(sku), unit=VALUES(unit), branch_id=VALUES(branch_id), is_active=VALUES(is_active)`,
      [id, scopedTenantId(req), req.body?.name || '', req.body?.sku || null, Number(req.body?.stock_quantity || 0), req.body?.unit || null, req.body?.branch_id || 'branch-daqqi', req.body?.is_active === false ? 0 : 1]
    );
    res.json({ ok: true, id });
  } catch (e) {
    routeError(res, e, 'dokki inventory item save failed');
  }
});

// POST /api/admin/dokki/inventory/transactions
router.post('/api/admin/dokki/inventory/transactions', requireAuth, requireAdmin, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { item_id, type, quantity, reason } = req.body || {};
    const qty = Math.max(1, parseInt(quantity, 10) || 0);
    const txType = String(type || '').toUpperCase();
    if (!item_id || !['IN', 'OUT', 'ADJUST'].includes(txType) || qty <= 0) {
      return res.status(400).json({ error: 'item_id, valid type and positive quantity required' });
    }

    await conn.beginTransaction();
    const [[item]] = await conn.query('SELECT id, tenant_id, stock_quantity FROM inventory_items WHERE id = ? FOR UPDATE', [item_id]);
    if (!item) {
      await conn.rollback();
      return res.status(404).json({ error: 'Inventory item not found' });
    }
    const delta = txType === 'IN' ? qty : txType === 'OUT' ? -qty : qty - Number(item.stock_quantity || 0);
    const nextQty = Number(item.stock_quantity || 0) + delta;
    if (nextQty < 0) {
      await conn.rollback();
      return res.status(409).json({ error: 'Insufficient stock' });
    }

    await conn.query('UPDATE inventory_items SET stock_quantity = ? WHERE id = ?', [nextQty, item_id]);
    const id = uuidv4();
    await conn.query(
      `INSERT INTO inventory_transactions (id, tenant_id, item_id, type, quantity, reason, performed_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, item.tenant_id || scopedTenantId(req), item_id, txType, qty, reason || null, req.user?.email || req.user?.uid || null]
    );
    await conn.commit();
    res.json({ ok: true, id, stock_quantity: nextQty });
  } catch (e) {
    await conn.rollback().catch(() => {});
    routeError(res, e, 'dokki inventory transaction failed');
  } finally {
    conn.release();
  }
});

module.exports = router;
