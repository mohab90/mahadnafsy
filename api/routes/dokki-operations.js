'use strict';

const express = require('express');
const router = express.Router();

const { pool } = require('../lib/db');
const { writeAuditEvent } = require('../lib/auditTrail');
const { uuidv4 } = require('../lib/id');
const { sanitize } = require('../lib/helpers');
const logger = require('../lib/logger').child({ module: 'dokki-operations-route' });
const { DEFAULT_TENANT_ID, resolveTenantId } = require('../lib/tenantScope');
const { requireAuth, requireAdminOrStaff, requirePermission } = require('../middleware/auth');
const { requireDaqqiAccess, requireDaqqiManager } = require('../lib/daqqiAccess');
const { verifyAttendanceQr } = require('../lib/attendanceQr');

function scopedTenantId(req) {
  return req.tenantId || resolveTenantId(req) || DEFAULT_TENANT_ID;
}

function routeError(res, error, message = 'dokki operation failed') {
  logger.error(message, error);
  return res.status(500).json({ error: 'Internal server error' });
}

// GET /api/admin/dokki/classrooms
router.get('/api/admin/dokki/classrooms', requireAuth, requireAdminOrStaff, requirePermission('manage_daqqi'), requireDaqqiAccess, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT c.*,
        (SELECT COUNT(*) FROM classroom_bookings b
          WHERE b.classroom_id=c.id AND b.tenant_id=c.tenant_id AND b.end_time>=NOW()) AS upcoming_bookings
       FROM physical_classrooms c
       WHERE c.tenant_id=? AND c.is_active=1
       ORDER BY c.name ASC`,
      [scopedTenantId(req)]
    );
    res.json(rows);
  } catch (e) {
    routeError(res, e, 'dokki classrooms list failed');
  }
});

// POST /api/admin/dokki/classrooms
router.post('/api/admin/dokki/classrooms', requireAuth, requireAdminOrStaff, requirePermission('manage_daqqi'), requireDaqqiManager, async (req, res) => {
  let conn;
  try {
    const tenantId = scopedTenantId(req);
    const id = req.body?.id || uuidv4();
    const name = sanitize(req.body?.name || '', 200);
    const capacity = Number(req.body?.capacity);
    if (!name || !Number.isInteger(capacity) || capacity < 1 || capacity > 10000) {
      return res.status(400).json({ error: 'Valid name and capacity are required' });
    }
    conn = await pool.getConnection();
    await conn.beginTransaction();
    const [[existing]] = await conn.query(
      'SELECT tenant_id FROM physical_classrooms WHERE id=? FOR UPDATE',
      [id]
    );
    if (existing && existing.tenant_id !== tenantId) {
      await conn.rollback();
      return res.status(404).json({ error: 'Classroom not found' });
    }
    if (existing) {
      await conn.query(
        `UPDATE physical_classrooms
         SET name=?, capacity=?, branch_id=?, is_active=?
         WHERE id=? AND tenant_id=?`,
        [name, capacity, req.body?.branch_id || req.body?.branchId || 'branch-daqqi',
         req.body?.is_active === false ? 0 : 1, id, tenantId]
      );
    } else {
      await conn.query(
        `INSERT INTO physical_classrooms (id, tenant_id, branch_id, name, capacity, is_active)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [id, tenantId, req.body?.branch_id || req.body?.branchId || 'branch-daqqi',
         name, capacity, req.body?.is_active === false ? 0 : 1]
      );
    }
    await conn.commit();
    res.json({ ok: true, id });
  } catch (e) {
    if (conn) await conn.rollback().catch(() => {});
    routeError(res, e, 'dokki classroom save failed');
  } finally {
    conn?.release();
  }
});

// POST /api/admin/dokki/classrooms/book
router.post('/api/admin/dokki/classrooms/book', requireAuth, requireAdminOrStaff, requirePermission('manage_daqqi'), requireDaqqiAccess, async (req, res) => {
  let conn;
  try {
    const { classroom_id, course_id, staff_id, start_time, end_time, purpose } = req.body || {};
    if (!classroom_id || !start_time || !end_time) return res.status(400).json({ error: 'classroom_id, start_time and end_time required' });
    const startMs = new Date(start_time).getTime();
    const endMs = new Date(end_time).getTime();
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs >= endMs) {
      return res.status(400).json({ error: 'Valid start_time and end_time are required' });
    }

    const tenantId = scopedTenantId(req);
    conn = await pool.getConnection();
    await conn.beginTransaction();
    const [[classroom]] = await conn.query(
      'SELECT id FROM physical_classrooms WHERE id=? AND tenant_id=? AND is_active=1 FOR UPDATE',
      [classroom_id, tenantId]
    );
    if (!classroom) {
      await conn.rollback();
      return res.status(404).json({ error: 'Classroom not found' });
    }
    if (course_id) {
      const [[course]] = await conn.query(
        'SELECT id FROM courses WHERE id=? AND tenant_id=? AND deleted_at IS NULL LIMIT 1',
        [course_id, tenantId]
      );
      if (!course) {
        await conn.rollback();
        return res.status(404).json({ error: 'Course not found' });
      }
    }
    if (staff_id) {
      const [[staff]] = await conn.query(
        'SELECT id FROM staff WHERE id=? AND tenant_id=? AND is_active=1 AND deleted_at IS NULL LIMIT 1',
        [staff_id, tenantId]
      );
      if (!staff) {
        await conn.rollback();
        return res.status(404).json({ error: 'Staff member not found' });
      }
    }

    const [conflicts] = await conn.query(
      `SELECT id FROM classroom_bookings
       WHERE classroom_id = ? AND tenant_id=?
         AND start_time < ?
         AND end_time > ?
       LIMIT 1`,
      [classroom_id, tenantId, end_time, start_time]
    );
    if (conflicts.length) {
      await conn.rollback();
      return res.status(409).json({ error: 'Classroom is already booked for this time slot' });
    }

    const id = uuidv4();
    await conn.query(
      `INSERT INTO classroom_bookings
        (id, tenant_id, classroom_id, course_id, staff_id, start_time, end_time, purpose, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, tenantId, classroom_id, course_id || null, staff_id || null, start_time, end_time,
       sanitize(purpose || '', 255) || null, req.user?.email || req.user?.uid || null]
    );
    await conn.commit();
    res.json({ ok: true, id });
  } catch (e) {
    if (conn) await conn.rollback().catch(() => {});
    routeError(res, e, 'dokki classroom booking failed');
  } finally {
    conn?.release();
  }
});

// POST /api/admin/dokki/checkins
router.post('/api/admin/dokki/checkins', requireAuth, requireAdminOrStaff, requirePermission('manage_daqqi'), requireDaqqiAccess, async (req, res) => {
  let conn;
  try {
    const qr = String(req.body?.qr_code_content || req.body?.code || '').trim();
    if (!qr) return res.status(400).json({ error: 'qr_code_content required' });
    const tenantId = scopedTenantId(req);
    const verifiedQr = verifyAttendanceQr(qr, tenantId);
    if (!verifiedQr) return res.status(400).json({ error: 'Attendance QR is invalid or expired' });
    const [[subscriber]] = await pool.query(
      `SELECT id, name, tenant_id FROM subscribers
       WHERE tenant_id=? AND deleted_at IS NULL AND is_active=1
         AND id=?
       LIMIT 1`,
      [tenantId, verifiedQr.subscriberId]
    );
    if (!subscriber) return res.status(404).json({ error: 'Student not found' });

    const id = uuidv4();
    conn = await pool.getConnection();
    await conn.beginTransaction();
    const [[recent]] = await conn.query(
      `SELECT id FROM physical_checkins
        WHERE tenant_id=? AND subscriber_id=? AND branch_id=?
          AND checked_in_at>=DATE_SUB(NOW(),INTERVAL 5 MINUTE)
        LIMIT 1 FOR UPDATE`,
      [tenantId, subscriber.id, req.body?.branch_id || 'branch-daqqi']
    );
    if (recent) {
      await conn.rollback();
      return res.status(409).json({ error: 'Student was already checked in during the last 5 minutes', id: recent.id });
    }
    await conn.query(
      `INSERT INTO physical_checkins (id, tenant_id, subscriber_id, branch_id, source, checked_in_by, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, tenantId, subscriber.id, req.body?.branch_id || 'branch-daqqi',
       sanitize(req.body?.source || 'qr', 60), req.user?.email || req.user?.uid || null,
       sanitize(req.body?.notes || '', 1000) || null]
    );
    await writeAuditEvent({
      action: 'PHYSICAL_CHECKIN',
      entityType: 'SUBSCRIBER',
      entityId: subscriber.id,
      metadata: { branch: req.body?.branch || 'Dokki', checkin_id: id },
      req,
      db: conn,
    });
    await conn.commit();
    res.json({ ok: true, id, subscriber: { id: subscriber.id, name: subscriber.name } });
  } catch (e) {
    if (conn) await conn.rollback().catch(() => {});
    routeError(res, e, 'dokki checkin failed');
  } finally {
    conn?.release();
  }
});

// GET /api/admin/dokki/inventory
router.get('/api/admin/dokki/inventory', requireAuth, requireAdminOrStaff, requirePermission('manage_daqqi'), requireDaqqiManager, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT * FROM inventory_items WHERE tenant_id=? AND is_active=1 ORDER BY name ASC',
      [scopedTenantId(req)]
    );
    res.json(rows);
  } catch (e) {
    routeError(res, e, 'dokki inventory list failed');
  }
});

// POST /api/admin/dokki/inventory/items
router.post('/api/admin/dokki/inventory/items', requireAuth, requireAdminOrStaff, requirePermission('manage_daqqi'), requireDaqqiManager, async (req, res) => {
  let conn;
  try {
    const tenantId = scopedTenantId(req);
    const id = req.body?.id || uuidv4();
    const name = sanitize(req.body?.name || '', 255);
    const stockQuantity = Number(req.body?.stock_quantity ?? 0);
    if (!name || !Number.isInteger(stockQuantity) || stockQuantity < 0 || stockQuantity > 100000000) {
      return res.status(400).json({ error: 'Valid name and non-negative stock_quantity are required' });
    }
    conn = await pool.getConnection();
    await conn.beginTransaction();
    const [[existing]] = await conn.query(
      'SELECT tenant_id FROM inventory_items WHERE id=? FOR UPDATE',
      [id]
    );
    if (existing && existing.tenant_id !== tenantId) {
      await conn.rollback();
      return res.status(404).json({ error: 'Inventory item not found' });
    }
    if (existing) {
      await conn.query(
        `UPDATE inventory_items
         SET name=?, sku=?, unit=?, branch_id=?, is_active=?
         WHERE id=? AND tenant_id=?`,
        [name, sanitize(req.body?.sku || '', 100) || null, sanitize(req.body?.unit || '', 40) || null,
         req.body?.branch_id || 'branch-daqqi', req.body?.is_active === false ? 0 : 1, id, tenantId]
      );
    } else {
      await conn.query(
        `INSERT INTO inventory_items
           (id, tenant_id, name, sku, stock_quantity, unit, branch_id, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, tenantId, name, sanitize(req.body?.sku || '', 100) || null, stockQuantity,
         sanitize(req.body?.unit || '', 40) || null, req.body?.branch_id || 'branch-daqqi',
         req.body?.is_active === false ? 0 : 1]
      );
    }
    await conn.commit();
    res.json({ ok: true, id });
  } catch (e) {
    if (conn) await conn.rollback().catch(() => {});
    routeError(res, e, 'dokki inventory item save failed');
  } finally {
    conn?.release();
  }
});

// POST /api/admin/dokki/inventory/transactions
router.post('/api/admin/dokki/inventory/transactions', requireAuth, requireAdminOrStaff, requirePermission('manage_daqqi'), requireDaqqiManager, async (req, res) => {
  let conn;
  try {
    const { item_id, type, quantity, reason } = req.body || {};
    const qty = Number(quantity);
    const txType = String(type || '').toUpperCase();
    const invalidQuantity = !Number.isInteger(qty) || qty > 100000000
      || (txType === 'ADJUST' ? qty < 0 : qty <= 0);
    if (!item_id || !['IN', 'OUT', 'ADJUST'].includes(txType) || invalidQuantity) {
      return res.status(400).json({ error: 'item_id, valid type and valid quantity required' });
    }

    const tenantId = scopedTenantId(req);
    conn = await pool.getConnection();
    await conn.beginTransaction();
    const [[item]] = await conn.query(
      'SELECT id, tenant_id, stock_quantity FROM inventory_items WHERE id=? AND tenant_id=? AND is_active=1 FOR UPDATE',
      [item_id, tenantId]
    );
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

    await conn.query(
      'UPDATE inventory_items SET stock_quantity=? WHERE id=? AND tenant_id=?',
      [nextQty, item_id, tenantId]
    );
    const id = uuidv4();
    await conn.query(
      `INSERT INTO inventory_transactions (id, tenant_id, item_id, type, quantity, reason, performed_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, tenantId, item_id, txType, qty, sanitize(reason || '', 255) || null,
       req.user?.email || req.user?.uid || null]
    );
    await conn.commit();
    res.json({ ok: true, id, stock_quantity: nextQty });
  } catch (e) {
    if (conn) await conn.rollback().catch(() => {});
    routeError(res, e, 'dokki inventory transaction failed');
  } finally {
    conn?.release();
  }
});

module.exports = router;
