'use strict';
// An admin resetting someone else's password or sign-in details.
// One part of routes/auth.js, which puts the parts back together in order.
const { Router } = require('express');
const {
  logger,
  bcrypt,
  generateTemporaryPassword,
  pool,
  ADMIN_EMAILS,
  requireAuth,
  requireSuperAdmin,
  requireAdminOrOnlineManager,
  invalidateIdentity,
  claimWhatsAppIdentity,
} = require('./_shared');

const router = Router();

// POST /api/admin/force-reset-password — direct password reset by email (super-admin only:
// it can reset ANY account incl. admins, so online/daqqi managers must not have it).
router.post('/api/admin/force-reset-password', requireAuth, requireSuperAdmin, async (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: 'Email required' });
  const newPassword = generateTemporaryPassword();
  const conn = await pool.getConnection();
  try {
    const hash = await bcrypt.hash(newPassword, 12);
    const normalizedEmail = email.toLowerCase().trim();
    const [result] = await conn.execute(
      `UPDATE users SET password_hash = ?, session_version=session_version+1,
        active_session_id=NULL, active_session_ip_hash=NULL,
        active_session_started_at=NULL, active_session_last_seen_at=NULL
       WHERE tenant_id=? AND email = ?`,
      [hash, req.tenantId, normalizedEmail]
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: 'User not found' });
    invalidateIdentity(req.tenantId, '', normalizedEmail);
    // The screen says «سلّمها للموظف» — it needs the password to hand over.
    res.json({ ok: true, temporaryPassword: newPassword });
  } catch (err) {
    logger.error('[admin/force-reset-password]', err);
    res.status(500).json({ error: 'Reset failed' });
  } finally { conn.release(); }
});

// PUT /api/admin/subscribers/:id/credentials  — admin/online_manager changes login email and/or password
router.put('/api/admin/subscribers/:id/credentials', requireAuth, requireAdminOrOnlineManager, async (req, res) => {
  const { id } = req.params;
  const { currentEmail, newEmail, newPassword } = req.body || {};
  if (!newEmail && !newPassword) return res.status(400).json({ error: 'Nothing to update' });
  const conn = await pool.getConnection();
  try {
    // Validate minimal password length
    if (newPassword && newPassword.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

    // This handler used to require `currentEmail` and address the account by
    // email alone — so a phone-only customer (an ordinary case here: WhatsApp
    // OTP sign-in, no email on file) could never have their password reset.
    // The online manager just got "currentEmail required". Resolve the account
    // from the subscriber instead, and only fall back to email matching.
    const [[subscriber]] = await conn.execute(
      'SELECT id, name, email, phone FROM subscribers WHERE id=? AND tenant_id=? LIMIT 1',
      [id, req.tenantId]
    );
    let account = null;
    const emailKey = String(currentEmail || subscriber?.email || '').toLowerCase().trim();
    if (emailKey) {
      [[account]] = await conn.execute(
        'SELECT id, email FROM users WHERE tenant_id=? AND LOWER(TRIM(email))=? LIMIT 1', [req.tenantId, emailKey]);
    }
    if (!account && subscriber) {
      // Accounts created from a subscriber reuse the subscriber id (see the
      // INSERT below), and phone is the other stable identifier.
      [[account]] = await conn.execute(
        'SELECT id, email FROM users WHERE tenant_id=? AND id=? LIMIT 1', [req.tenantId, subscriber.id]);
      if (!account && subscriber.phone) {
        [[account]] = await conn.execute(
          'SELECT id, email FROM users WHERE tenant_id=? AND phone=? LIMIT 1', [req.tenantId, subscriber.phone]);
      }
    }
    if (!account && !subscriber) return res.status(404).json({ error: 'لم يُعثر على المشترك.' });
    // Validate new email not already taken by another user
    const newEmailKey = newEmail ? newEmail.toLowerCase().trim() : null;
    if (newEmailKey && newEmailKey !== String(account?.email || '').toLowerCase().trim()) {
      // The same door as create-account, reached from the other side.
      //
      // This route sets a customer's email and password together, and only
      // checked the users table for a collision. Pointing a subscriber at a
      // manager's address — one of the six active staff with no login row —
      // and choosing the password made that manager's identity available to
      // whoever asked, because every privileged check resolves staff by email
      // alone. Closing create-account without closing this would have left the
      // takeover one route to the left.
      const [[protectedStaff]] = await conn.execute(
        'SELECT id FROM staff WHERE tenant_id=? AND LOWER(TRIM(email)) COLLATE utf8mb4_unicode_ci = ? AND is_active = 1 LIMIT 1',
        [req.tenantId, newEmailKey]
      );
      if (protectedStaff || ADMIN_EMAILS.some(e => e.toLowerCase() === newEmailKey)) {
        return res.status(403).json({
          error: 'لا يمكن تحويل حساب عميل إلى بريد موظف',
          code: 'STAFF_INVITATION_REQUIRED',
        });
      }
      const [[existing]] = await conn.execute(
        'SELECT id FROM users WHERE tenant_id=? AND LOWER(TRIM(email))=? LIMIT 1', [req.tenantId, newEmailKey]);
      if (existing && existing.id !== account?.id) {
        return res.status(409).json({ error: `البريد الإلكتروني ${newEmail} مسجل بالفعل لمستخدم آخر` });
      }
    }
    // Build dynamic UPDATE for users table
    const sets = [];
    const params = [];
    if (newEmailKey) { sets.push('email = ?'); params.push(newEmailKey); }
    if (newPassword) { sets.push('password_hash = ?'); params.push(await bcrypt.hash(newPassword, 12)); }
    sets.push('session_version = session_version + 1');
    sets.push('active_session_id = NULL', 'active_session_ip_hash = NULL',
      'active_session_started_at = NULL', 'active_session_last_seen_at = NULL');
    // Address the row by id — the account was resolved above by email, id or
    // phone, so this works for a customer with no email at all.
    let result = { affectedRows: 0 };
    if (account) {
      params.push(req.tenantId, account.id);
      [result] = await conn.execute(`UPDATE users SET ${sets.join(', ')} WHERE tenant_id=? AND id = ?`, params);
    }
    if (result.affectedRows === 0) {
      // No user account yet — create one using the subscriber's data
      if (!newPassword) return res.status(404).json({ error: 'لم يُعثر على حساب لهذا العميل. يرجى تعيين كلمة مرور لإنشاء الحساب.' });
      const sub = subscriber;
      if (!sub) return res.status(404).json({ error: 'لم يُعثر على المشترك.' });
      const finalEmailRaw = newEmail || sub.email;
      // A phone-only account is legitimate: the customer signs in with WhatsApp
      // OTP. Only refuse when there is neither an email nor a number to bind to.
      if (!finalEmailRaw && !sub.phone) {
        return res.status(400).json({ error: 'لا يوجد بريد إلكتروني ولا رقم هاتف — أضف أحدهما أولًا' });
      }
      const finalEmail = finalEmailRaw ? finalEmailRaw.toLowerCase().trim() : null;
      // Carry the subscriber's number onto the account, or it is created unable
      // to sign in — WhatsApp OTP has no number and email sign-in is off.
      const phoneForUser = await claimWhatsAppIdentity(conn, { tenantId: req.tenantId, phone: sub.phone });
      await conn.execute(
        'INSERT INTO users (id, tenant_id, email, phone, password_hash, name, role) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [sub.id, req.tenantId, finalEmail, phoneForUser, await bcrypt.hash(newPassword, 12), sub.name || '', 'client']
      );
      if (finalEmail && finalEmail !== (sub.email || '').toLowerCase().trim()) {
        await conn.execute('UPDATE subscribers SET email = ? WHERE id = ? AND tenant_id=?', [finalEmail, id, req.tenantId]);
      }
    } else if (newEmailKey) {
      // If email changed, sync subscribers table too
      await conn.execute('UPDATE subscribers SET email = ? WHERE id = ? AND tenant_id=?', [newEmailKey, id, req.tenantId]);
    }
    if (result.affectedRows) {
      const previousEmail = account?.email || currentEmail;
      if (previousEmail) invalidateIdentity(req.tenantId, '', previousEmail);
      if (newEmailKey) invalidateIdentity(req.tenantId, '', newEmailKey);
    }
    res.json({ ok: true, temporaryPassword: newPassword });
  } catch (err) {
    logger.error('[admin/subscribers/credentials]', err);
    res.status(500).json({ error: 'Internal server error' });
  } finally { conn.release(); }
});

module.exports = router;
