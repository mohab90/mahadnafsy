'use strict';
/**
 * Conversion funnel (business visibility). Aggregates each stage of the customer
 * journey and the drop-off between stages so the owner can *see* where money
 * leaks. Every probe is guarded so one missing table never fails the response.
 */
const logger = require('../lib/logger');
const express = require('express');
const router = express.Router();
const { pool, cached } = require('../lib/db');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const n = async (sql, params = []) => {
  try { const [[r]] = await pool.query(sql, params); return Number(Object.values(r)[0]) || 0; }
  catch { return 0; }
};

router.get('/api/admin/funnel', requireAuth, requireAdmin, async (_req, res) => {
  try {
    const data = await cached('funnel', 5 * 60 * 1000, async () => {
      const [leads, contacted, interested, converted, subscribers, paying, learners, certified, revenue] = await Promise.all([
        n("SELECT COUNT(*) FROM leads WHERE hidden=0"),
        n("SELECT COUNT(*) FROM leads WHERE hidden=0 AND LOWER(status) <> 'new'"),
        n("SELECT COUNT(*) FROM leads WHERE hidden=0 AND (LOWER(status)='interested' OR interest_level='HIGH')"),
        n("SELECT COUNT(*) FROM leads WHERE hidden=0 AND LOWER(status)='converted'"),
        n("SELECT COUNT(*) FROM subscribers"),
        n("SELECT COUNT(DISTINCT subscriber_id) FROM payments WHERE status='paid'"),
        n("SELECT COUNT(DISTINCT subscriber_id) FROM lecture_progress"),
        n("SELECT COUNT(DISTINCT subscriber_id) FROM issued_certificates"),
        n("SELECT COALESCE(SUM(amount),0) FROM payments WHERE status='paid' AND (currency IS NULL OR currency='EGP')"),
      ]);
      const stages = [
        { key: 'leads', label: 'عملاء محتملون', value: leads },
        { key: 'contacted', label: 'تم التواصل', value: contacted },
        { key: 'interested', label: 'مهتمّون', value: interested },
        { key: 'paying', label: 'دفعوا', value: paying },
        { key: 'learners', label: 'بدأوا التعلّم', value: learners },
        { key: 'certified', label: 'حصلوا على شهادة', value: certified },
      ];
      // rate vs first stage + step drop-off
      const top = stages[0].value || 1;
      stages.forEach((s, i) => {
        s.pctOfTop = Math.round((s.value / top) * 100);
        s.stepPct = i === 0 ? 100 : Math.round((s.value / (stages[i - 1].value || 1)) * 100);
        s.dropoff = i === 0 ? 0 : Math.max(0, (stages[i - 1].value || 0) - s.value);
      });
      // biggest leak
      let worst = null;
      for (let i = 1; i < stages.length; i++) {
        if (!worst || stages[i].stepPct < worst.stepPct) worst = { from: stages[i - 1].label, to: stages[i].label, stepPct: stages[i].stepPct, dropoff: stages[i].dropoff };
      }
      return {
        stages, subscribers, converted, revenueEGP: revenue,
        biggestLeak: worst,
        generatedAt: new Date().toISOString(),
      };
    });
    res.json(data);
  } catch (e) { logger.error('[funnel]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// ── Action Center (mission control) — what the team must act on NOW ──────────
router.get('/api/admin/action-center', requireAuth, requireAdmin, async (_req, res) => {
  try {
    const [pendingProofs, overdueFollowups, uncontacted, pendingCerts, newJoinUs, newContact, failedMsgs] = await Promise.all([
      n("SELECT COUNT(*) FROM payment_proofs WHERE status='PENDING'"),
      n("SELECT COUNT(*) FROM leads WHERE hidden=0 AND next_follow_up_date IS NOT NULL AND next_follow_up_date < NOW() AND LOWER(status) NOT IN ('converted','lost')"),
      n("SELECT COUNT(*) FROM leads WHERE hidden=0 AND LOWER(status)='new' AND created_at < (NOW() - INTERVAL 1 DAY)"),
      n("SELECT COUNT(*) FROM certificate_requests WHERE status='PENDING'"),
      n("SELECT COUNT(*) FROM join_us_applications WHERE LOWER(COALESCE(status,'new')) IN ('new','pending')"),
      n("SELECT COUNT(*) FROM contact_messages WHERE LOWER(COALESCE(status,'new')) IN ('new','pending','unread')"),
      n("SELECT COUNT(*) FROM message_outbox WHERE status IN ('failed','dead')"),
    ]);
    let proofList = [];
    try {
      const [rows] = await pool.query(
        `SELECT pp.id, pp.amount, pp.currency, pp.submitted_at, s.name AS subscriber_name
         FROM payment_proofs pp LEFT JOIN subscribers s ON s.id=pp.subscriber_id
         WHERE pp.status='PENDING' ORDER BY pp.submitted_at ASC LIMIT 8`);
      proofList = rows;
    } catch { /* table shape差 */ }
    const items = [
      { key: 'pending_proofs',     label: 'إيصالات تنتظر الاعتماد', count: pendingProofs,    severity: pendingProofs ? 'high' : 'ok',  link: 'payment_proofs' },
      { key: 'overdue_followups',  label: 'متابعات متأخرة',          count: overdueFollowups, severity: overdueFollowups ? 'high' : 'ok', link: 'leads' },
      { key: 'uncontacted',        label: 'عملاء جدد بلا تواصل',     count: uncontacted,      severity: uncontacted ? 'warn' : 'ok',    link: 'leads' },
      { key: 'pending_certs',      label: 'شهادات قيد الطلب',        count: pendingCerts,     severity: pendingCerts ? 'warn' : 'ok',   link: 'certificates' },
      { key: 'join_us',            label: 'طلبات توظيف جديدة',       count: newJoinUs,        severity: newJoinUs ? 'warn' : 'ok',      link: 'join_us' },
      { key: 'contact',            label: 'رسائل تواصل جديدة',       count: newContact,       severity: newContact ? 'warn' : 'ok',     link: 'messages' },
      { key: 'failed_msgs',        label: 'رسائل فشل إرسالها',       count: failedMsgs,       severity: failedMsgs ? 'high' : 'ok',     link: 'lifecycle' },
    ];
    res.json({ items, totalActions: items.reduce((s, i) => s + i.count, 0), pendingProofs: proofList, generatedAt: new Date().toISOString() });
  } catch (e) { logger.error('[action-center]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

module.exports = router;
