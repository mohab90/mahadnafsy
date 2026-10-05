'use strict';
// Refund requests, from asking to paying out.
// One part of routes/finance.js, which puts the parts back together in order.
const { Router } = require('express');
const {
  pool,
  applyRefundReversal,
  applyUnlinkedRefund,
  itemTitle,
  parseItem,
  logClientEvent,
  createNotification,
  requireAuth,
  requireAdmin,
  requireAdminOrStaff,
  requirePermission,
  requireAnyPermission,
  financialRecordMatches,
  financialScopeClause,
  resolveFinancialScope,
  logFinancialAudit,
  logger,
} = require('./_shared');

const router = Router();

// ── Refund requests list & status update ──────────────────────────────────
// Customer service reads the list and escalates (manage_inbox) without the
// accounts screens; deciding and paying out stay on approve_refunds.

router.get('/api/admin/finance/refunds', requireAuth, requireAdminOrStaff, requireAnyPermission('view_financial', 'manage_inbox'), async (req, res) => {
  try {
    const scope = resolveFinancialScope(req, {
      requestedBranch: req.query.branch || null,
      allowAssigned: true,
    });
    const { sql: scopeSql, params: scopeParams } =
      financialScopeClause(scope, { branchColumn: 'rr.branch_id' });
    // Everything the refunds screen shows, resolved here rather than by the
    // browser making a request per row: which course the refund is against and
    // what it cost, how much of it the customer has actually paid across all
    // their payments, who owns them in sales and in customer service, and how
    // much of the course they attended — a refund request from someone who
    // never attended is a different conversation from one at the halfway mark.
    const [rows] = await pool.query(`
      SELECT rr.*, rr.admin_note AS admin_notes, rr.resolved_by AS handled_by,
             rr.resolved_at AS handled_at,
             s.name AS subscriber_name, s.email AS subscriber_email, s.phone AS subscriber_phone,
             s.client_code, s.branch AS subscriber_branch,
             s.assigned_sales_name, s.assigned_cs_name,
             st.name AS handler_name,
             esc.name AS escalated_by_name,
             blame.name AS blamed_staff_name,
             p.course_id, p.created_at AS booking_date,
             -- «ليه اسم الكورس مش بيظهر»: a refund for a track named no course,
             -- and one with no payment named nothing. The course or the track,
             -- from the payment, else from what the request was opened for.
             COALESCE(NULLIF(c.title_ar, ''), c.title, b.title) AS course_title,
             s.assigned_cs_id,
             -- The last contact about it, since it was asked for (the client's
             -- contact log — «ويتسجل في سجل التواصل … النتيجه والحاله»).
             (SELECT JSON_OBJECT('outcome', cm.outcome, 'notes', LEFT(cm.notes, 300), 'at', cm.date, 'by', cst.name, 'type', cm.type)
                FROM communications cm
                LEFT JOIN staff cst ON cst.id = cm.staff_id AND cst.tenant_id = cm.tenant_id
               WHERE cm.tenant_id = rr.tenant_id AND cm.subscriber_id = rr.subscriber_id AND cm.date >= rr.created_at
               ORDER BY cm.date DESC LIMIT 1) AS last_contact,
             (SELECT COUNT(*) FROM communications cm
               WHERE cm.tenant_id = rr.tenant_id AND cm.subscriber_id = rr.subscriber_id AND cm.date >= rr.created_at) AS contacts_count,
             -- Both figures are shown side by side to whoever approves the
             -- refund, so both have to mean the same thing.
             --
             -- course_total mixed units: course_expected is in the payment's
             -- own currency while price_egp is EGP, so a SAR payment printed
             -- its riyal figure next to Egyptian pounds. It is converted with
             -- the rate stored on the payment itself.
             COALESCE(p.course_expected * COALESCE(p.fx_rate_to_egp, 1), c.price_egp) AS course_total,
             -- paid_total counted every row in the table: pending payments
             -- awaiting review, failed ones, and the soft-deleted duplicates
             -- from the de-dupe cleanup — all in their raw currency. A
             -- customer who had paid 3,400 once could show 8,800 "paid"
             -- against a 3,400 course, and the refund was judged on that.
             (SELECT COALESCE(SUM(px.amount_egp),0) FROM payments px
               WHERE px.subscriber_id = rr.subscriber_id AND px.tenant_id = rr.tenant_id
                 AND px.status = 'paid' AND px.deleted_at IS NULL
                 AND (p.course_id IS NULL OR px.course_id = p.course_id)) AS paid_total,
             -- Online course progress. Daqqi attendance is a different thing
             -- entirely (daqqi_attendees.attended_lectures, per round) and is
             -- not merged in here: adding the two together would produce a
             -- number that means neither.
             --
             -- lecture_completions, not lecture_progress. The second table has
             -- the more obvious name, is empty, and nothing has ever written to
             -- it — api/lib/autoCertificate.js:26 says so in as many words, and
             -- this query read it anyway. So attended_count, the number a
             -- manager uses to judge «how much did they watch before asking for
             -- their money back», was always 0 and every refund looked fully
             -- justified.
             --
             -- Counted the same way the certificate rule counts it: a published
             -- lecture at 90% or marked complete. A player that stops two
             -- seconds short of the credits should not read as unwatched.
             (SELECT COUNT(*) FROM lecture_completions lp
                JOIN course_lectures cl ON cl.id = lp.lecture_id AND cl.is_published = 1
               WHERE lp.subscriber_id = rr.subscriber_id
                 AND (lp.progress_pct >= 90 OR lp.completed_at IS NOT NULL)
                 AND (p.course_id IS NULL OR lp.course_id = p.course_id)) AS attended_count
      FROM refund_requests rr
      LEFT JOIN subscribers s ON s.id = rr.subscriber_id AND s.tenant_id=rr.tenant_id
      LEFT JOIN staff st ON st.id = rr.resolved_by AND st.tenant_id=rr.tenant_id
      LEFT JOIN staff esc ON esc.id = rr.escalated_by AND esc.tenant_id=rr.tenant_id
      LEFT JOIN staff blame ON blame.id = rr.blamed_staff_id AND blame.tenant_id=rr.tenant_id
      LEFT JOIN payments p ON p.id = rr.payment_id AND p.tenant_id=rr.tenant_id
      LEFT JOIN courses c ON c.id = COALESCE(p.course_id, rr.course_item) AND c.tenant_id=rr.tenant_id
      LEFT JOIN bundles b ON b.id = COALESCE(p.bundle_id, IF(rr.course_item LIKE 'bundle:%', SUBSTRING(rr.course_item, 8), NULL))
                         AND b.tenant_id=rr.tenant_id
      WHERE rr.tenant_id=? AND rr.deleted_at IS NULL${scopeSql}
      ORDER BY rr.created_at DESC LIMIT 500
    `, [req.tenantId, ...scopeParams]);
    res.json(rows.map(row => {
      let lastContact = null;
      try { lastContact = row.last_contact ? JSON.parse(row.last_contact) : null; } catch { lastContact = null; }
      return { ...row, last_contact: lastContact, contacts_count: Number(row.contacts_count) || 0 };
    }));
  } catch (e) {
    logger.error('[finance/refunds]', e.message);
    res.status(e.status || 500).json({ error: e.status ? e.message : 'Internal server error', code: e.code });
  }
});

router.put('/api/admin/finance/refunds/:id', requireAuth, requireAdminOrStaff, requirePermission('approve_refunds'), async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const scope = resolveFinancialScope(req, {
      requestedBranch: req.body?.branch || null,
      allowAssigned: true,
    });
    const { status, notes } = req.body;
    const normalizedStatus = String(status || '').toUpperCase();
    // HANDLING is for a request that is neither granted nor refused — moved to
    // a different course, credited, settled some other way. Before, those were
    // forced into approve or reject and the truth lived in the note.
    if (!['APPROVED', 'REJECTED', 'HANDLING'].includes(normalizedStatus))
      return res.status(400).json({ error: 'invalid status' });
    const decisionNote = String(req.body?.decision_note || '').trim().slice(0, 5000);
    if (normalizedStatus === 'REJECTED' && !decisionNote)
      return res.status(400).json({ error: 'سبب الرفض مطلوب' });
    if (normalizedStatus === 'HANDLING' && !decisionNote)
      return res.status(400).json({ error: 'اكتب ما تم عمله في الطلب' });
    const actor = req.staffRecord?.name || req.user?.email || 'admin';
    const tenantId = req.tenantId;
    await conn.beginTransaction();

    const [[rr]] = await conn.query(
      `SELECT rr.*, s.name AS subscriber_name, s.email AS subscriber_email,
              s.assigned_cs_id, s.assigned_sales_id
       FROM refund_requests rr
       LEFT JOIN subscribers s ON s.id = rr.subscriber_id AND s.tenant_id=rr.tenant_id
       WHERE rr.id = ? AND rr.tenant_id=? FOR UPDATE`,
      [req.params.id, tenantId]
    );
    if (!rr) {
      await conn.rollback();
      return res.status(404).json({ error: 'Refund request not found' });
    }
    if (!financialRecordMatches(scope, rr)) {
      await conn.rollback();
      return res.status(404).json({ error: 'Refund request not found' });
    }
    if (String(rr.status || '').toUpperCase() !== 'PENDING') {
      await conn.rollback();
      return res.status(409).json({ error: 'Refund request has already been resolved' });
    }
    // A refund for a course with no payment behind it is approved against the
    // course (lib/refunds.js#applyUnlinkedRefund); one with neither is not.
    if (normalizedStatus === 'APPROVED' && !rr.payment_id && !rr.course_item) {
      await conn.rollback();
      return res.status(409).json({ error: 'A refund cannot be approved without a linked payment' });
    }

    // What is actually returned is a decision in its own right, and is often
    // less than the customer asked for. Defaults to the requested amount so an
    // approval with no figure behaves exactly as it always did, and cannot
    // exceed it — refunding more than was requested is not an approval.
    let refundedAmount = null;
    if (normalizedStatus === 'APPROVED') {
      const requested = Number(rr.amount) || 0;
      refundedAmount = req.body?.refunded_amount === undefined || req.body.refunded_amount === null || req.body.refunded_amount === ''
        ? requested
        : Number(req.body.refunded_amount);
      if (!Number.isFinite(refundedAmount) || refundedAmount <= 0 || refundedAmount > requested) {
        await conn.rollback();
        return res.status(400).json({ error: `المبلغ المسترد يجب أن يكون بين 1 و ${requested}` });
      }
    }

    await conn.query(
      `UPDATE refund_requests
          SET status=?, admin_note=?, decision_note=?, refunded_amount=?,
              resolved_by=?, resolved_at=NOW()
        WHERE id=? AND tenant_id=?`,
      [normalizedStatus, notes || null, decisionNote || null, refundedAmount,
        req.staffRecord?.id || req.user?.email || null, req.params.id, tenantId]
    );

    if (normalizedStatus === 'APPROVED' && rr.payment_id) {
      await applyRefundReversal({
        paymentId: rr.payment_id,
        subscriberId: rr.subscriber_id,
        refundAmount: refundedAmount,
        refundCurrency: rr.currency,
        tenantId,
        actor,
        // A partial refund writes its own payment row, and the note on that row
        // is where anyone reading the ledger afterwards finds out what it was.
        // Without this it read «استرداد جزئي من دفعة <id>» and stopped there.
        reason: decisionNote || rr.reason || null,
      }, conn);
    } else if (normalizedStatus === 'APPROVED') {
      await applyUnlinkedRefund({
        subscriberId: rr.subscriber_id, item: rr.course_item, refundAmount: refundedAmount,
        refundCurrency: rr.currency, method: rr.refund_method, tenantId, actor,
        reason: decisionNote || rr.reason || null,
      }, conn);
    }
    const refundTitle = rr.course_item ? await itemTitle(conn, tenantId, parseItem(rr.course_item)) : null;
    await logClientEvent(conn, {
      tenantId, subscriberId: rr.subscriber_id, actor,
      action: `refund_${normalizedStatus.toLowerCase()}`,
      label: normalizedStatus === 'APPROVED'
        ? `اتعمل استرداد ${refundedAmount} ${rr.currency || 'EGP'}${refundTitle ? ` لـ«${refundTitle}»` : ''}${!rr.payment_id && rr.refund_method ? ` من ${rr.refund_method}` : ''}`
        : `طلب الاسترداد ${normalizedStatus === 'REJECTED' ? 'اترفض' : 'اتعالج'} — ${decisionNote}`,
    });

    await logFinancialAudit({
      entityType: 'refund_request',
      entityId: req.params.id,
      // HANDLING was written as 'rejected': the audit said a request was
      // refused when it had been settled another way.
      action: normalizedStatus.toLowerCase(),
      oldData: { status: rr.status, payment_id: rr.payment_id || null },
      newData: { status: normalizedStatus, notes: notes || null },
      amount: rr.amount,
      actor,
      tenantId,
      db: conn,
      strict: true,
    });
    await conn.commit();
    res.json({ ok: true });
  } catch (e) {
    try { await conn.rollback(); } catch (_) {}
    logger.error('[finance/refunds PUT]', e.message);
    res.status(e.status || 500).json({ error: e.status ? e.message : 'Internal server error' });
  } finally {
    conn.release();
  }
});

// The rest of what a refund desk does, none of which fitted in a status field.
// Each is deliberately its own endpoint rather than more flags on the PUT: they
// are different authorities. Deciding a refund is one permission; raising it to
// management, attributing it to a colleague's mistake, confirming the money has
// left, and archiving the record are separate acts with separate consequences.

// Raise to senior management. Does not change the status: a request stays in
// whatever state it was in while somebody senior looks at it.
router.post('/api/admin/finance/refunds/:id/escalate', requireAuth, requireAdminOrStaff, requireAnyPermission('view_financial', 'manage_inbox'), async (req, res) => {
  try {
    const note = String(req.body?.note || '').trim().slice(0, 2000);
    const [result] = await pool.query(
      `UPDATE refund_requests
          SET escalated_at=NOW(), escalated_by=?,
              admin_note=CONCAT(COALESCE(admin_note,''), IF(admin_note IS NULL OR admin_note='','','\n'), ?)
        WHERE id=? AND tenant_id=? AND deleted_at IS NULL`,
      [req.staffRecord?.id || null, `رفع للإدارة العليا: ${note || 'بدون ملاحظة'}`, req.params.id, req.tenantId]
    );
    if (!result.affectedRows) return res.status(404).json({ error: 'الطلب غير موجود' });
    createNotification('refund', '⚠️ طلب استرداد مرفوع للإدارة',
      note || 'طلب استرداد يحتاج قرار الإدارة العليا',
      { refundId: req.params.id }, req.tenantId, null).catch(() => {});
    res.json({ ok: true, message: 'تم رفع الطلب للإدارة العليا' });
  } catch (e) { logger.error('[finance/refunds escalate]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// Attribute the refund to a staff mistake. Admin only, and never inferred —
// this is a judgement about a colleague, so it is only ever set deliberately.
router.post('/api/admin/finance/refunds/:id/blame', requireAuth, requireAdmin, async (req, res) => {
  try {
    const staffId = String(req.body?.staff_id || '').trim();
    const note = String(req.body?.note || '').trim().slice(0, 2000);
    if (!staffId) {
      const [cleared] = await pool.query(
        'UPDATE refund_requests SET blamed_staff_id=NULL, blame_note=NULL WHERE id=? AND tenant_id=?',
        [req.params.id, req.tenantId]);
      if (!cleared.affectedRows) return res.status(404).json({ error: 'الطلب غير موجود' });
      return res.json({ ok: true, message: 'تم إلغاء تحديد المسؤول' });
    }
    const [[staff]] = await pool.query(
      'SELECT id, name FROM staff WHERE id=? AND tenant_id=? AND deleted_at IS NULL LIMIT 1',
      [staffId, req.tenantId]);
    if (!staff) return res.status(404).json({ error: 'الموظف غير موجود' });
    const [result] = await pool.query(
      'UPDATE refund_requests SET blamed_staff_id=?, blame_note=? WHERE id=? AND tenant_id=? AND deleted_at IS NULL',
      [staff.id, note || null, req.params.id, req.tenantId]);
    if (!result.affectedRows) return res.status(404).json({ error: 'الطلب غير موجود' });
    res.json({ ok: true, message: `تم تسجيل المسؤولية على ${staff.name}` });
  } catch (e) { logger.error('[finance/refunds blame]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// The money has actually left the account. Separate from approval because the
// gap between the two is exactly what the refund desk is chasing.
router.post('/api/admin/finance/refunds/:id/mark-refunded', requireAuth, requireAdminOrStaff, requirePermission('approve_refunds'), async (req, res) => {
  try {
    // The same row-level rule the decision itself (PUT above) applies: a branch
    // accountant confirmed another branch's refunds by id.
    const scope = resolveFinancialScope(req, { requestedBranch: null, allowAssigned: true });
    const [[rr]] = await pool.query(
      `SELECT rr.status, rr.branch_id, s.assigned_cs_id, s.assigned_sales_id
         FROM refund_requests rr
         LEFT JOIN subscribers s ON s.id = rr.subscriber_id AND s.tenant_id = rr.tenant_id
        WHERE rr.id=? AND rr.tenant_id=? AND rr.deleted_at IS NULL LIMIT 1`,
      [req.params.id, req.tenantId]);
    if (!rr || !financialRecordMatches(scope, rr)) return res.status(404).json({ error: 'الطلب غير موجود' });
    if (String(rr.status).toUpperCase() !== 'APPROVED') {
      return res.status(409).json({ error: 'لا يمكن تأكيد رد المبلغ قبل اعتماد الطلب' });
    }
    // Conditional, so two confirmations at once write one REFUNDED.
    const [done] = await pool.query(
      "UPDATE refund_requests SET status='REFUNDED', refunded_at=NOW() WHERE id=? AND tenant_id=? AND status='APPROVED'",
      [req.params.id, req.tenantId]);
    if (!done.affectedRows) return res.status(409).json({ error: 'الطلب اتأكد قبل كده' });
    res.json({ ok: true, message: 'تم تأكيد رد المبلغ للعميل' });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    logger.error('[finance/refunds mark-refunded]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Archive, not erase: a money decision keeps its trail.
router.delete('/api/admin/finance/refunds/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [result] = await pool.query(
      'UPDATE refund_requests SET deleted_at=NOW() WHERE id=? AND tenant_id=? AND deleted_at IS NULL',
      [req.params.id, req.tenantId]);
    if (!result.affectedRows) return res.status(404).json({ error: 'الطلب غير موجود' });
    res.json({ ok: true, message: 'تم حذف طلب الاسترداد' });
  } catch (e) { logger.error('[finance/refunds delete]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

module.exports = router;
