'use strict';
// A signed-in user changing their own name, contact or password.
// One part of routes/auth.js, which puts the parts back together in order.
const { Router } = require('express');
const {
  logger,
  bcrypt,
  pool,
  sanitize,
  clearAuthCookie,
  requireAuth,
  invalidateIdentity,
} = require('./_shared');

const router = Router();

// PUT /api/auth/update-profile
router.put('/api/auth/update-profile', requireAuth, async (req, res) => {
  const { name, nameEn } = req.body || {};
  const hasName = typeof name === 'string' && name.trim().length > 0;
  const hasNameEn = typeof nameEn === 'string' && nameEn.trim().length > 0;
  if (!hasName && !hasNameEn) return res.status(400).json({ error: 'Name or English name required' });
  const conn = await pool.getConnection();
  let transactionStarted = false;
  try {
    const safeName = hasName ? sanitize(name, 255) : null;
    const safeNameEn = hasNameEn ? sanitize(nameEn, 255) : null;
    const identityEmail = String(req.user.email || '').trim().toLowerCase();
    await conn.beginTransaction();
    transactionStarted = true;
    if (safeName) {
      await conn.execute('UPDATE users SET name = ? WHERE id = ? AND tenant_id=?', [safeName, req.user.uid, req.tenantId]);
    }
    const [subscriberUpdate] = await conn.execute(
      `UPDATE subscribers
          SET name=CASE WHEN ? IS NULL THEN name ELSE ? END,
              crm_json=CASE WHEN ? IS NULL THEN crm_json
                ELSE JSON_SET(
                  CASE WHEN JSON_VALID(crm_json) THEN crm_json ELSE JSON_OBJECT() END,
                  '$.nameEn', ?
                )
              END
        WHERE tenant_id=?
          AND (firebase_uid=? OR LOWER(TRIM(email))=LOWER(TRIM(?)))`,
      [safeName, safeName, safeNameEn, safeNameEn, req.tenantId, req.user.uid, identityEmail]
    );
    if (safeNameEn && !subscriberUpdate.affectedRows) {
      await conn.rollback();
      transactionStarted = false;
      return res.status(404).json({ error: 'Subscriber profile not found' });
    }
    await conn.commit();
    transactionStarted = false;
    res.json({ ok: true });
  } catch (err) {
    if (transactionStarted) await conn.rollback().catch(() => {});
    logger.error('[auth/update-profile]', err);
    res.status(500).json({ error: 'Update failed' });
  } finally { if (conn) conn.release(); }
});

// PUT /api/auth/update-password
router.put('/api/auth/update-password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Both passwords required' });
  if (newPassword.length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters' });
  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.execute('SELECT password_hash FROM users WHERE id = ? AND tenant_id=?', [req.user.uid, req.tenantId]);
    if (rows.length === 0) return res.status(404).json({ error: 'User not found' });
    const match = await bcrypt.compare(currentPassword, rows[0].password_hash);
    if (!match) return res.status(401).json({ error: 'Current password incorrect' });
    const hash = await bcrypt.hash(newPassword, 12);
    await conn.execute(
      `UPDATE users SET password_hash = ?, session_version=session_version+1,
        active_session_id=NULL, active_session_ip_hash=NULL,
        active_session_started_at=NULL, active_session_last_seen_at=NULL
       WHERE id = ? AND tenant_id=?`,
      [hash, req.user.uid, req.tenantId]
    );
    invalidateIdentity(req.tenantId, req.user.uid, req.user.email);
    clearAuthCookie(res);
    res.json({ ok: true, reauthenticationRequired: true });
  } catch (err) {
    logger.error('[auth/update-password]', err);
    res.status(500).json({ error: 'Update failed' });
  } finally { conn.release(); }
});

module.exports = router;
