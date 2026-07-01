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

router.get('/api/admin/funnel', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { from, to, branch } = req.query;
    const br = branch && branch !== 'all' ? String(branch).toUpperCase() : null;
    // Build per-table WHERE fragments honouring date range (+ branch where present).
    const range = (col) => { const c = [], p = []; if (from) { c.push(`${col} >= ?`); p.push(from); } if (to) { c.push(`${col} < DATE_ADD(?, INTERVAL 1 DAY)`); p.push(to); } return { c, p }; };
    const lr = range('created_at'); const lw = ['hidden=0', ...lr.c, ...(br ? ['branch=?'] : [])].join(' AND '); const lp = [...lr.p, ...(br ? [br] : [])];
    const pr = range('date');       const pw = ["status='paid'", ...pr.c, ...(br ? ['branch=?'] : [])].join(' AND '); const pp = [...pr.p, ...(br ? [br] : [])];
    const sr = range('created_at'); const sw = ['1=1', ...sr.c, ...(br ? ['branch=?'] : [])].join(' AND '); const sp = [...sr.p, ...(br ? [br] : [])];
    const brJoin = br ? 'JOIN subscribers s ON s.id=t.subscriber_id WHERE s.branch=?' : 'WHERE 1=1';
    const brP = br ? [br] : [];
    const data = await cached(`funnel:${from || ''}:${to || ''}:${br || 'all'}`, 5 * 60 * 1000, async () => {
      const [leads, contacted, interested, converted, subscribers, paying, learners, certified, revenue] = await Promise.all([
        n(`SELECT COUNT(*) FROM leads WHERE ${lw}`, lp),
        n(`SELECT COUNT(*) FROM leads WHERE ${lw} AND LOWER(status) <> 'new'`, lp),
        n(`SELECT COUNT(*) FROM leads WHERE ${lw} AND (LOWER(status)='interested' OR interest_level='HIGH')`, lp),
        n(`SELECT COUNT(*) FROM leads WHERE ${lw} AND LOWER(status)='converted'`, lp),
        n(`SELECT COUNT(*) FROM subscribers WHERE ${sw}`, sp),
        n(`SELECT COUNT(DISTINCT subscriber_id) FROM payments WHERE ${pw}`, pp),
        n(`SELECT COUNT(DISTINCT t.subscriber_id) FROM lecture_progress t ${brJoin}`, brP),
        n(`SELECT COUNT(DISTINCT t.subscriber_id) FROM issued_certificates t ${brJoin}`, brP),
        n(`SELECT COALESCE(SUM(amount),0) FROM payments WHERE ${pw} AND (currency IS NULL OR currency='EGP')`, pp),
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
        filters: { from: from || null, to: to || null, branch: br || 'all' },
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
      { key: 'pending_proofs',     label: 'إيصالات تنتظر الاعتماد', count: pendingProofs,    severity: pendingProofs ? 'high' : 'ok',  link: 'orders' },
      { key: 'overdue_followups',  label: 'متابعات متأخرة',          count: overdueFollowups, severity: overdueFollowups ? 'high' : 'ok', link: 'followup_reminders' },
      { key: 'uncontacted',        label: 'عملاء جدد بلا تواصل',     count: uncontacted,      severity: uncontacted ? 'warn' : 'ok',    link: 'leads' },
      { key: 'pending_certs',      label: 'شهادات قيد الطلب',        count: pendingCerts,     severity: pendingCerts ? 'warn' : 'ok',   link: 'cert_requests' },
      { key: 'join_us',            label: 'طلبات انضمام جديدة',      count: newJoinUs,        severity: newJoinUs ? 'warn' : 'ok',      link: 'join_us' },
      { key: 'contact',            label: 'رسائل تواصل جديدة',       count: newContact,       severity: newContact ? 'warn' : 'ok',     link: 'support_inbox' },
      { key: 'failed_msgs',        label: 'رسائل فشل إرسالها',       count: failedMsgs,       severity: failedMsgs ? 'high' : 'ok',     link: 'system_settings' },
    ];
    res.json({ items, totalActions: items.reduce((s, i) => s + i.count, 0), pendingProofs: proofList, generatedAt: new Date().toISOString() });
  } catch (e) { logger.error('[action-center]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// ── Unified support inbox (tickets + contact messages in one feed) ───────────
router.get('/api/admin/support-inbox', requireAuth, requireAdmin, async (req, res) => {
  try {
    const kind = req.query.kind || 'all'; // all | ticket | contact | refund | cert
    const want = (k) => kind === 'all' || kind === k;
    const isOpen = (s, closedSet) => !closedSet.includes(String(s || '').toLowerCase()); // still needs attention
    let tickets = [], contacts = [], refunds = [], certs = [];
    if (want('ticket')) {
      try {
        const [rows] = await pool.query(
          `SELECT id, subscriber_name AS name, subscriber_email AS email, subject,
                  status, created_at FROM support_tickets WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 100`, [req.tenantId]);
        tickets = rows.map(r => ({ source: 'ticket', id: r.id, name: r.name, email: r.email, phone: null, subject: r.subject, preview: null, status: String(r.status || 'open').toLowerCase(), open: isOpen(r.status, ['closed', 'resolved']), at: r.created_at }));
      } catch { /* table shape */ }
    }
    if (want('contact')) {
      try {
        const [rows] = await pool.query(
          `SELECT id, name, email, phone, subject, message, status, created_at
           FROM contact_messages WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 100`, [req.tenantId]);
        contacts = rows.map(r => ({ source: 'contact', id: r.id, name: r.name, email: r.email, phone: r.phone, subject: r.subject || 'رسالة تواصل', preview: String(r.message || '').slice(0, 120), status: String(r.status || 'new').toLowerCase(), open: isOpen(r.status, ['closed', 'replied']), at: r.created_at }));
      } catch { /* table shape */ }
    }
    if (want('refund')) {
      try {
        const [rows] = await pool.query(
          `SELECT rr.id, s.name, s.email, s.phone, rr.amount, rr.currency, rr.reason, rr.status, rr.created_at
           FROM refund_requests rr LEFT JOIN subscribers s ON s.id = rr.subscriber_id
           ORDER BY rr.created_at DESC LIMIT 100`);
        refunds = rows.map(r => ({ source: 'refund', id: r.id, name: r.name, email: r.email, phone: r.phone, subject: `طلب استرداد ${Number(r.amount || 0).toLocaleString()} ${r.currency || ''}`, preview: r.reason || null, status: String(r.status || 'pending').toLowerCase(), open: isOpen(r.status, ['refunded', 'rejected', 'closed', 'done']), at: r.created_at }));
      } catch { /* table shape */ }
    }
    if (want('cert')) {
      try {
        const [rows] = await pool.query(
          `SELECT cr.id, s.name, s.email, s.phone, cr.type, cr.status, cr.requested_at
           FROM certificate_requests cr LEFT JOIN subscribers s ON s.id = cr.subscriber_id
           ORDER BY cr.requested_at DESC LIMIT 100`);
        certs = rows.map(r => ({ source: 'cert', id: r.id, name: r.name, email: r.email, phone: r.phone, subject: 'طلب شهادة', preview: r.type || null, status: String(r.status || 'pending').toLowerCase(), open: isOpen(r.status, ['issued', 'delivered', 'rejected']), at: r.requested_at }));
      } catch { /* table shape */ }
    }
    const all = [...tickets, ...contacts, ...refunds, ...certs].sort((a, b) => String(b.at).localeCompare(String(a.at)));
    const items = all.slice(0, 300);
    const openCount = (arr) => arr.filter(x => x.open).length;
    res.json({
      items,
      counts: {
        tickets: openCount(tickets), contacts: openCount(contacts),
        refunds: openCount(refunds), certs: openCount(certs), total: openCount(all),
      },
    });
  } catch (e) { logger.error('[support-inbox]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

module.exports = router;
