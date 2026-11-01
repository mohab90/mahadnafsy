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

// ── An employee's own email and photo (1 Nov 2026: «لكل موظف يغير ايميله أو صورته أو الباسورد بتاعه») ──────────────────────────────
// The password has PUT /api/auth/update-password. The email is the login, so it changes only after the new address proves it is theirs: a
// code is mailed to it (lib/loginEmailCode.js, kept under its own key so it can never be used to sign in), and the current password is asked
// for first, so a session left open on a desk cannot move the account to someone else's address.
const { EMAIL_RE } = require('../../lib/helpers');
const loginEmailCode = require('../../lib/loginEmailCode');
const { storeMediaImage } = require('../../lib/mediaImages');
const changeKey = uid => `email-change:${uid}`;

async function staffOfCaller(req) {
  const email = String(req.user?.email || '').trim().toLowerCase();
  if (!email) return null;
  const [[row]] = await pool.query(
    'SELECT id, name, email FROM staff WHERE tenant_id=? AND LOWER(TRIM(email))=? AND is_active=1 AND deleted_at IS NULL LIMIT 1', [req.tenantId, email]);
  return row || null;
}

router.post('/api/staff/me/email/request', requireAuth, async (req, res) => {
  try {
    const staff = await staffOfCaller(req);
    if (!staff) return res.status(403).json({ error: 'تغيير الإيميل من هنا للموظفين بس' });
    const { newEmail, currentPassword } = req.body || {};
    const address = String(newEmail || '').trim().toLowerCase();
    if (!EMAIL_RE.test(address)) return res.status(400).json({ error: 'الإيميل الجديد مش صحيح', code: 'INVALID_EMAIL' });
    if (address === String(staff.email).trim().toLowerCase()) return res.status(400).json({ error: 'ده الإيميل الحالي', code: 'SAME_EMAIL' });
    const [[user]] = await pool.query('SELECT password_hash FROM users WHERE id=? AND tenant_id=? LIMIT 1', [req.user.uid, req.tenantId]);
    if (!user || !currentPassword || !(await bcrypt.compare(String(currentPassword), user.password_hash))) {
      return res.status(401).json({ error: 'كلمة المرور الحالية غلط', code: 'CURRENT_PASSWORD_INCORRECT' });
    }
    // Taken by another account (a user, or another employee)?
    const [[takenUser]] = await pool.query('SELECT id FROM users WHERE tenant_id=? AND LOWER(TRIM(email))=? AND id<>? LIMIT 1', [req.tenantId, address, req.user.uid]);
    const [[takenStaff]] = await pool.query('SELECT id FROM staff WHERE tenant_id=? AND LOWER(TRIM(email))=? AND id<>? AND deleted_at IS NULL LIMIT 1', [req.tenantId, address, staff.id]);
    if (takenUser || takenStaff) return res.status(409).json({ error: 'الإيميل ده مستخدم في حساب تاني', code: 'EMAIL_TAKEN' });
    await loginEmailCode.sendLoginCode(pool, {
      tenantId: req.tenantId, userId: changeKey(req.user.uid), email: address, name: staff.name,
      subject: 'كود تأكيد الإيميل الجديد', lead: 'كود تأكيد إيميلك الجديد في النظام:',
    });
    res.json({ ok: true, sentTo: loginEmailCode.maskEmail(address) });
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ error: error.message, code: error.code });
    logger.error('[staff/me/email/request]', error.message);
    res.status(500).json({ error: 'Update failed' });
  }
});

router.post('/api/staff/me/email/confirm', requireAuth, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const staff = await staffOfCaller(req);
    if (!staff) return res.status(403).json({ error: 'تغيير الإيميل من هنا للموظفين بس' });
    const address = String(req.body?.newEmail || '').trim().toLowerCase();
    // The code was mailed to one address: it confirms that address and no other.
    const [[pending]] = await conn.query(
      `SELECT email FROM login_email_codes WHERE tenant_id=? AND user_id=? AND used_at IS NULL AND expires_at > NOW() ORDER BY created_at DESC LIMIT 1`,
      [req.tenantId, changeKey(req.user.uid)]);
    if (!pending || String(pending.email).toLowerCase() !== address) return res.status(400).json({ error: 'الكود منتهي — اطلب كود جديد', code: 'CODE_EXPIRED' });
    const checked = await loginEmailCode.checkLoginCode(conn, { tenantId: req.tenantId, userId: changeKey(req.user.uid), code: req.body?.code });
    if (!checked.ok) return res.status(400).json({ error: checked.reason === 'expired' ? 'الكود منتهي — اطلب كود جديد' : 'الكود غلط', code: checked.reason === 'expired' ? 'CODE_EXPIRED' : 'CODE_WRONG' });
    await conn.beginTransaction();
    await conn.query('UPDATE users SET email=?, email_unverified=0 WHERE id=? AND tenant_id=?', [address, req.user.uid, req.tenantId]);
    await conn.query('UPDATE staff SET email=? WHERE id=? AND tenant_id=?', [address, staff.id, req.tenantId]);
    await conn.commit();
    invalidateIdentity(req.tenantId, req.user.uid, req.user.email);
    invalidateIdentity(req.tenantId, req.user.uid, address);
    res.json({ ok: true, email: address });
  } catch (error) {
    await conn.rollback().catch(() => {});
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'الإيميل ده مستخدم في حساب تاني', code: 'EMAIL_TAKEN' });
    logger.error('[staff/me/email/confirm]', error.message);
    res.status(500).json({ error: 'Update failed' });
  } finally { conn.release(); }
});

// The employee's own photo: stored like every other picture of the site (resized, WebP) and linked on their row. Everyone may change their
// own; the upload route of the content screens needs a content permission an employee does not have.
router.post('/api/staff/me/photo', requireAuth, async (req, res) => {
  try {
    const staff = await staffOfCaller(req);
    if (!staff) return res.status(403).json({ error: 'الصورة من هنا للموظفين بس' });
    if (req.body?.remove === true) {
      await pool.query('UPDATE staff SET image=NULL WHERE id=? AND tenant_id=?', [staff.id, req.tenantId]);
      return res.json({ ok: true, image: null });
    }
    const stored = await storeMediaImage({ tenantId: req.tenantId, dataUrl: req.body?.dataUrl, kind: 'photo' });
    await pool.query('UPDATE staff SET image=? WHERE id=? AND tenant_id=?', [String(stored.url).slice(0, 500), staff.id, req.tenantId]);
    res.json({ ok: true, image: stored.url });
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
    logger.error('[staff/me/photo]', error.message);
    res.status(500).json({ error: 'Update failed' });
  }
});

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
          AND (firebase_uid=? OR (?<>'' AND LOWER(TRIM(email))=LOWER(TRIM(?))))`,
      // An account with no (proven) email matches by its link alone: an empty
      // address compared to the column matched every client stored without one.
      [safeName, safeName, safeNameEn, safeNameEn, req.tenantId, req.user.uid, identityEmail, identityEmail]
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
