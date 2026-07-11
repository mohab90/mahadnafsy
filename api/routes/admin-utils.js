'use strict';
const logger = require('../lib/logger');
const express = require('express');
const router  = express.Router();
const { uuidv4 } = require('../lib/id');

const { pool } = require('../lib/db');
const { tryJson } = require('../lib/helpers');
const { sendEmail } = require('../lib/email');
const { sendWhatsApp } = require('../lib/whatsapp');
const { postJournalEntry, logPaymentAudit, toEgp, _paymentAccountCode } = require('../lib/finance');
const { syncLeadDealValue } = require('./public-orders');
const { requireAuth, requireAdmin, requireAdminOrStaff, requireAdminOrOnlineManagerOrCollection, requireAdminOrOnlineManager } = require('../middleware/auth');

// ═══════════════════════════════════════════════════════════════════════════
// NOTE: IP Whitelist routes moved to misc.js (uses dedicated ip_whitelist table)
// ═══════════════════════════════════════════════════════════════════════════
// ── FEATURE: GDPR — Export & Delete subscriber data ───────────────────────
// ═══════════════════════════════════════════════════════════════════════════

router.get('/api/admin/subscribers/:id/export-data', requireAuth, requireAdmin, async (req, res) => {
  try {
    const subId = req.params.id;
    const [[sub]] = await pool.query('SELECT id, name, email, phone, firebase_uid, is_active, source, notes, crm_json, client_code, created_at FROM subscribers WHERE id=? LIMIT 1', [subId]);
    if (!sub) return res.status(404).json({ error: 'Not found' });
    const [[user]] = await pool.query('SELECT id, email, name, role, created_at FROM users WHERE LOWER(TRIM(email))=? LIMIT 1', [sub.email?.toLowerCase().trim() || '']);
    const [payments] = await pool.query('SELECT id, subscriber_id, amount, currency, payment_type, payment_method, transaction_id, is_installment, course_id, bundle_id, note, status, staff_id, staff_name, from_account, source, item_title, created_at FROM payments WHERE subscriber_id=?', [subId]);
    const [enrollments] = await pool.query('SELECT id, subscriber_id, course_id, access_level, enrolled_at FROM enrollments WHERE subscriber_id=?', [subId]);
    const [completions] = await pool.query('SELECT id, subscriber_id, course_id, completed_at FROM course_completions WHERE subscriber_id=?', [subId]);
    const [tickets] = await pool.query('SELECT id, subscriber_id, subject, status, created_at FROM support_tickets WHERE subscriber_id=?', [subId]);
    const [nps] = await pool.query('SELECT id, subscriber_id, score, feedback, created_at FROM nps_responses WHERE subscriber_id=?', [subId]);
    const crm = tryJson(sub.crm_json, {});
    const exportData = {
      exportedAt: new Date().toISOString(),
      subscriber: { ...sub, crm_json: undefined },
      crmData: crm,
      userAccount: user || null,
      payments, enrollments, completions, tickets, nps,
    };
    res.setHeader('Content-Disposition', `attachment; filename="subscriber-${subId}-export.json"`);
    res.setHeader('Content-Type', 'application/json');
    res.json(exportData);
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

router.delete('/api/admin/subscribers/:id/delete-data', requireAuth, requireAdmin, async (req, res) => {
  try {
    const subId = req.params.id;
    const [[sub]] = await pool.query('SELECT email FROM subscribers WHERE id=? LIMIT 1', [subId]);
    if (!sub) return res.status(404).json({ error: 'Not found' });
    // Anonymize rather than delete (GDPR soft-delete)
    const anonEmail = `deleted-${subId}@anon.mahad`;
    await pool.query(
      "UPDATE subscribers SET name='[محذوف]', email=?, phone=NULL, crm_json='{}', is_active=0 WHERE id=?",
      [anonEmail, subId]
    );
    await pool.query("UPDATE users SET name='[محذوف]', email=?, is_active=0 WHERE LOWER(TRIM(email))=?", [anonEmail, sub.email?.toLowerCase().trim() || '']);
    await pool.query('DELETE FROM support_tickets WHERE subscriber_id=?', [subId]);
    await pool.query('DELETE FROM nps_responses WHERE subscriber_id=?', [subId]);
    await pool.query('DELETE FROM lecture_progress WHERE subscriber_id=?', [subId]);
    res.json({ ok: true, message: 'Subscriber data anonymized per GDPR' });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// ── FEATURE: Auto DB Backup status ────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

router.get('/api/admin/backup-status', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [[row]] = await pool.query("SELECT value FROM site_config WHERE `key`='last_backup_at' LIMIT 1");
    res.json({ lastBackupAt: row?.value || null });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

router.post('/api/admin/backup-now', requireAuth, requireAdmin, async (req, res) => {
  try {
    // Count rows to give a meaningful snapshot summary
    const tables = ['subscribers', 'leads', 'payments', 'enrollments', 'courses', 'support_tickets', 'tasks'];
    const counts = {};
    for (const t of tables) {
      const [[r]] = await pool.query(`SELECT COUNT(*) AS n FROM \`${t}\``).catch(() => [[{n:0}]]);
      counts[t] = r.n;
    }
    await pool.query(
      "INSERT INTO site_config (`key`, `value`) VALUES ('last_backup_at', ?) ON DUPLICATE KEY UPDATE `value`=VALUES(`value`)",
      [new Date().toISOString()]
    );
    res.json({ ok: true, triggeredAt: new Date().toISOString(), counts, note: 'Full mysqldump is triggered by cron on the server. Configure BACKUP_CRON in .env.' });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// GET /api/admin/backups — list backup logs from DB + check file existence
router.get('/api/admin/backups', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [logs] = await pool.query(
      'SELECT * FROM backup_logs ORDER BY created_at DESC LIMIT 30'
    ).catch(() => [[]]);

    const fs = require('fs');
    const BACKUP_DIR = process.env.BACKUP_DIR || '/tmp/mahad_backups';

    const withSize = logs.map(row => ({
      ...row,
      fileExists: row.filename ? fs.existsSync(require('path').join(BACKUP_DIR, row.filename)) : false,
    }));

    res.json({ backups: withSize, backupDir: BACKUP_DIR });
  } catch (e) { logger.error('[backups-list]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// GET /api/admin/backups/download/:filename — stream backup file to client
router.get('/api/admin/backups/download/:filename', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { filename } = req.params;
    // Security: only allow safe filenames (no path traversal)
    if (!filename || !/^mahad_backup_[\w.-]+\.sql(\.gz)?$/.test(filename)) {
      return res.status(400).json({ error: 'Invalid filename' });
    }
    const path = require('path');
    const fs   = require('fs');
    const BACKUP_DIR = process.env.BACKUP_DIR || '/tmp/mahad_backups';
    const filePath = path.join(BACKUP_DIR, filename);

    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });

    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', filename.endsWith('.gz') ? 'application/gzip' : 'application/sql');
    fs.createReadStream(filePath).pipe(res);
  } catch (e) { logger.error('[backup-download]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// ── FEATURE: Revenue Forecasting ─────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

router.get('/api/admin/forecast', requireAuth, requireAdmin, async (req, res) => {
  try {
    // Last 12 months actuals
    const [monthly] = await pool.query(`
      SELECT DATE_FORMAT(date, '%Y-%m') AS month, SUM(amount) AS revenue, COUNT(*) AS count
      FROM payments WHERE date >= DATE_SUB(NOW(), INTERVAL 12 MONTH) AND amount > 0
      GROUP BY month ORDER BY month ASC
    `);
    // Simple linear regression on last 6 months to forecast next 3
    const recent = monthly.slice(-6);
    let forecast = [];
    if (recent.length >= 2) {
      const n = recent.length;
      const xs = recent.map((_, i) => i);
      const ys = recent.map(r => parseFloat(r.revenue) || 0);
      const xMean = xs.reduce((s, x) => s + x, 0) / n;
      const yMean = ys.reduce((s, y) => s + y, 0) / n;
      const slope = xs.reduce((s, x, i) => s + (x - xMean) * (ys[i] - yMean), 0) /
                    xs.reduce((s, x) => s + Math.pow(x - xMean, 2), 0);
      const intercept = yMean - slope * xMean;
      const lastMonth = recent[recent.length - 1].month;
      for (let f = 1; f <= 3; f++) {
        const [year, mon] = lastMonth.split('-').map(Number);
        const d = new Date(year, mon - 1 + f, 1);
        const fMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        forecast.push({ month: fMonth, revenue: Math.max(0, Math.round(intercept + slope * (n - 1 + f))), isForecast: true });
      }
    }
    res.json({ monthly, forecast });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// ── FEATURE: CSV Export ───────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

// Helper: convert array of objects to CSV string
function toCSV(rows, columns) {
  if (!rows.length) return columns.map(c => c.label).join(',') + '\n';
  const escape = v => {
    if (v === null || v === undefined) return '';
    const s = String(v).replace(/"/g, '""');
    return /[",\n\r]/.test(s) ? `"${s}"` : s;
  };
  const header = columns.map(c => escape(c.label)).join(',');
  const body = rows.map(r => columns.map(c => escape(r[c.key])).join(',')).join('\n');
  return header + '\n' + body;
}

// GET /api/admin/export/subscribers — export subscribers as CSV
router.get('/api/admin/export/subscribers', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT s.id, s.name, s.email, s.phone, s.status, s.source, s.created_at,
              COUNT(DISTINCT e.course_id) AS courses_count,
              COALESCE(SUM(p.amount),0) AS total_paid
       FROM subscribers s
       LEFT JOIN enrollments e ON e.subscriber_id = s.id
       LEFT JOIN payments p ON p.subscriber_id = s.id AND p.status='paid'
       GROUP BY s.id ORDER BY s.created_at DESC LIMIT 10000`
    );
    const cols = [
      { key: 'id', label: 'ID' },
      { key: 'name', label: 'الاسم' },
      { key: 'email', label: 'الإيميل' },
      { key: 'phone', label: 'الهاتف' },
      { key: 'status', label: 'الحالة' },
      { key: 'source', label: 'المصدر' },
      { key: 'courses_count', label: 'عدد الكورسات' },
      { key: 'total_paid', label: 'إجمالي المدفوعات' },
      { key: 'created_at', label: 'تاريخ التسجيل' },
    ];
    const csv = toCSV(rows, cols);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="subscribers-${new Date().toISOString().slice(0,10)}.csv"`);
    res.send('\uFEFF' + csv); // BOM for Excel Arabic support
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// GET /api/admin/export/leads — export leads as CSV
router.get('/api/admin/export/leads', requireAuth, requireAdminOrStaff, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, name, email, phone, status, source, assigned_sales_name AS assigned_to_name, deal_value, next_follow_up_date AS follow_up_date, created_at
       FROM leads WHERE hidden=0 ORDER BY created_at DESC LIMIT 10000`
    );
    const cols = [
      { key: 'id', label: 'ID' },
      { key: 'name', label: 'الاسم' },
      { key: 'email', label: 'الإيميل' },
      { key: 'phone', label: 'الهاتف' },
      { key: 'status', label: 'المرحلة' },
      { key: 'source', label: 'المصدر' },
      { key: 'assigned_to_name', label: 'المسؤول' },
      { key: 'deal_value', label: 'قيمة الصفقة' },
      { key: 'follow_up_date', label: 'تاريخ المتابعة' },
      { key: 'created_at', label: 'تاريخ الإضافة' },
    ];
    const csv = toCSV(rows, cols);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="leads-${new Date().toISOString().slice(0,10)}.csv"`);
    res.send('\uFEFF' + csv);
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// GET /api/admin/export/payments — export payments as CSV
router.get('/api/admin/export/payments', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { dateFrom, dateTo } = req.query;
    let where = '1=1';
    const params = [];
    if (dateFrom) { where += ' AND p.date >= ?'; params.push(dateFrom); }
    if (dateTo)   { where += ' AND p.date <= ?'; params.push(dateTo); }
    const [rows] = await pool.query(
      `SELECT p.id, s.name AS subscriber_name, s.email AS subscriber_email,
              p.amount, p.currency, p.payment_type, p.payment_method, p.status,
              p.date, p.transaction_id, p.staff_name, p.note
       FROM payments p
       LEFT JOIN subscribers s ON s.id = p.subscriber_id
       WHERE ${where} ORDER BY p.date DESC LIMIT 20000`,
      params
    );
    const cols = [
      { key: 'id', label: 'ID' },
      { key: 'subscriber_name', label: 'اسم العميل' },
      { key: 'subscriber_email', label: 'الإيميل' },
      { key: 'amount', label: 'المبلغ' },
      { key: 'currency', label: 'العملة' },
      { key: 'payment_type', label: 'نوع الدفع' },
      { key: 'payment_method', label: 'طريقة الدفع' },
      { key: 'status', label: 'الحالة' },
      { key: 'date', label: 'التاريخ' },
      { key: 'transaction_id', label: 'رقم المعاملة' },
      { key: 'staff_name', label: 'الموظف' },
      { key: 'note', label: 'ملاحظة' },
    ];
    const csv = toCSV(rows, cols);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="payments-${new Date().toISOString().slice(0,10)}.csv"`);
    res.send('\uFEFF' + csv);
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// ── FEATURE: Daily Follow-up Reminder (runs at 9:00 AM Cairo time) ──────
// ═══════════════════════════════════════════════════════════════════════════
let _lastFollowUpReminderDay = '';
setInterval(async () => {
  try {
    const now = new Date();
    const cairoHour = (now.getUTCHours() + 2) % 24;
    const today = new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString().slice(0, 10);
    if (cairoHour !== 9 || today === _lastFollowUpReminderDay) return;
    _lastFollowUpReminderDay = today;
    // Find all overdue follow-ups with assigned staff emails
    const [overdue] = await pool.query(`
      SELECT l.id, l.name AS lead_name, l.phone, l.status,
             l.next_follow_up_date,
             DATEDIFF(CURDATE(), l.next_follow_up_date) AS days_overdue,
             st.name AS staff_name, st.email AS staff_email
      FROM leads l
      JOIN staff st ON st.id = l.assigned_sales_id
      WHERE l.hidden = 0
        AND l.next_follow_up_date < CURDATE()
        AND l.status NOT IN ('CONVERTED','LOST','CLOSED')
        AND st.email IS NOT NULL AND st.email != ''
      ORDER BY st.id, l.next_follow_up_date ASC
      LIMIT 500
    `);
    if (!overdue.length) return;
    // Group by staff email
    const byStaff = {};
    for (const row of overdue) {
      if (!byStaff[row.staff_email]) byStaff[row.staff_email] = { name: row.staff_name, leads: [] };
      byStaff[row.staff_email].leads.push(row);
    }
    let emailsSent = 0;
    for (const [email, { name, leads }] of Object.entries(byStaff)) {
      const rows = leads.map(l =>
        `<tr><td style="padding:6px 10px;border-bottom:1px solid #eee">${l.lead_name||'—'}</td>
         <td style="padding:6px 10px;border-bottom:1px solid #eee">${l.phone||'—'}</td>
         <td style="padding:6px 10px;border-bottom:1px solid #eee;color:#e53e3e;font-weight:bold">${l.days_overdue} يوم</td>
         <td style="padding:6px 10px;border-bottom:1px solid #eee">${l.next_follow_up_date}</td></tr>`
      ).join('');
      const html = `
        <div dir="rtl" style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;background:#f9fafb;border-radius:12px">
          <h2 style="color:#2d3748;margin-bottom:8px">📋 تذكير: متابعات متأخرة</h2>
          <p style="color:#4a5568">أهلاً ${name}، لديك <strong style="color:#e53e3e">${leads.length}</strong> متابعة متأخرة تحتاج إجراء اليوم:</p>
          <table style="width:100%;border-collapse:collapse;background:#fff;border-radius:8px;overflow:hidden;margin-top:12px">
            <thead><tr style="background:#fed7d7;color:#822727">
              <th style="padding:8px 10px;text-align:right">العميل</th>
              <th style="padding:8px 10px;text-align:right">الهاتف</th>
              <th style="padding:8px 10px;text-align:center">تأخر</th>
              <th style="padding:8px 10px;text-align:center">كان مقرراً</th>
            </tr></thead>
            <tbody>${rows}</tbody>
          </table>
          <p style="color:#718096;font-size:13px;margin-top:16px">يرجى تسجيل الدخول إلى النظام وإجراء المتابعات اللازمة.</p>
        </div>`;
      try {
        await sendEmail(email, `تذكير: ${leads.length} متابعة متأخرة — معهد الدراسات النفسية`, html);
        emailsSent++;
      } catch (_) {}
    }
    logger.info(`[FollowUpReminder] Sent ${emailsSent} emails for ${overdue.length} overdue leads`);
    await pool.query(
      'INSERT INTO activity_logs (id, action, entity, entity_id, label, actor) VALUES (?,?,?,?,?,?)',
      [uuidv4(), 'auto_reminder', 'leads', null, `تذكير متابعات تلقائي — ${overdue.length} ليد لـ ${emailsSent} موظف`, 'system']
    ).catch(() => {});
  } catch (e) { logger.warn('[FollowUpReminder] error:', e.message); }
}, 60 * 60 * 1000); // check every hour

// ═══════════════════════════════════════════════════════════════════════════
// ── FEATURE: Daily Installment Overdue Reminder (9 AM Cairo) ─────────────
// ── Finds active installment_plans with unpaid overdue installments and   ──
// ── sends WhatsApp to subscriber + email summary to admin.               ──
// ═══════════════════════════════════════════════════════════════════════════
let _lastInstallmentReminderDay = '';
setInterval(async () => {
  try {
    const now       = new Date();
    const cairoHour = (now.getUTCHours() + 2) % 24;
    const today     = new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString().slice(0, 10);
    if (cairoHour !== 9 || today === _lastInstallmentReminderDay) return;
    _lastInstallmentReminderDay = today;

    // Fetch all active installment plans with subscriber contact info
    const [plans] = await pool.query(`
      SELECT ip.id, ip.title, ip.total_amount, ip.currency,
             ip.installments_count, ip.installment_amounts, ip.due_dates, ip.paid_dates,
             s.id AS sub_id, s.name AS sub_name, s.phone AS sub_phone, s.email AS sub_email
      FROM installment_plans ip
      JOIN subscribers s ON s.id = ip.subscriber_id
      WHERE ip.status = 'active'
      LIMIT 2000
    `);

    if (!plans.length) return;

    const overdueList = [];
    for (const plan of plans) {
      const dueDates   = tryJson(plan.due_dates,   []);
      const paidDates  = tryJson(plan.paid_dates,  []);
      const amounts    = tryJson(plan.installment_amounts, []);

      for (let i = 0; i < plan.installments_count; i++) {
        const due = dueDates[i];
        if (!due || paidDates[i]) continue; // no due date or already paid
        if (due >= today) continue;          // not yet overdue
        overdueList.push({
          planId:    plan.id,
          planTitle: plan.title,
          subId:     plan.sub_id,
          subName:   plan.sub_name,
          subPhone:  plan.sub_phone,
          subEmail:  plan.sub_email,
          currency:  plan.currency,
          amount:    amounts[i] || (plan.total_amount / plan.installments_count),
          dueDate:   due,
          daysOverdue: Math.round((new Date(today) - new Date(due)) / 86400000),
          installmentNum: i + 1,
          totalInstallments: plan.installments_count,
        });
      }
    }

    if (!overdueList.length) return;

    let waSent = 0;
    // Send WhatsApp to each subscriber (deduplicated — one message per subscriber)
    const notifiedSubs = new Set();
    for (const item of overdueList) {
      if (!item.subPhone || notifiedSubs.has(item.subId)) continue;
      notifiedSubs.add(item.subId);

      // Collect all overdue installments for this subscriber
      const subItems = overdueList.filter(x => x.subId === item.subId);
      const lines = subItems.map(x =>
        `• ${x.planTitle} — القسط ${x.installmentNum}/${x.totalInstallments} (${x.amount.toLocaleString()} ${x.currency}) — متأخر ${x.daysOverdue} يوم`
      ).join('\n');

      const msg =
        `مرحباً ${item.subName}،\n\n` +
        `نود تذكيركم بأن لديكم أقساط متأخرة في معهد الدراسات النفسية:\n\n` +
        `${lines}\n\n` +
        `يُرجى التواصل مع الفريق لترتيب السداد.\nشكراً لتعاونكم 🙏`;

      const result = await sendWhatsApp(item.subPhone, msg);
      if (result.ok) waSent++;
    }

    // Send email summary to admin
    const tableRows = overdueList.map(item =>
      `<tr>
        <td style="padding:6px 10px;border-bottom:1px solid #eee">${item.subName || '—'}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee">${item.subPhone || '—'}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee">${item.planTitle}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee">${item.installmentNum}/${item.totalInstallments}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;font-weight:bold">${item.amount.toLocaleString()} ${item.currency}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;color:#e53e3e;font-weight:bold">${item.daysOverdue} يوم</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee">${item.dueDate}</td>
      </tr>`
    ).join('');

    const adminHtml = `
      <div dir="rtl" style="font-family:Arial,sans-serif;padding:20px;max-width:800px">
        <h2 style="color:#2d3748">تقرير الأقساط المتأخرة — ${today}</h2>
        <p style="color:#718096">يوجد <strong>${overdueList.length}</strong> قسط متأخر لـ <strong>${notifiedSubs.size}</strong> مشترك</p>
        <table style="width:100%;border-collapse:collapse;font-size:13px">
          <thead>
            <tr style="background:#f7fafc;text-align:right">
              <th style="padding:8px 10px;border-bottom:2px solid #e2e8f0">المشترك</th>
              <th style="padding:8px 10px;border-bottom:2px solid #e2e8f0">الهاتف</th>
              <th style="padding:8px 10px;border-bottom:2px solid #e2e8f0">الخطة</th>
              <th style="padding:8px 10px;border-bottom:2px solid #e2e8f0">القسط</th>
              <th style="padding:8px 10px;border-bottom:2px solid #e2e8f0">المبلغ</th>
              <th style="padding:8px 10px;border-bottom:2px solid #e2e8f0">التأخر</th>
              <th style="padding:8px 10px;border-bottom:2px solid #e2e8f0">تاريخ الاستحقاق</th>
            </tr>
          </thead>
          <tbody>${tableRows}</tbody>
        </table>
        <p style="margin-top:16px;color:#718096;font-size:12px">
          تم إرسال تذكير واتساب لـ ${waSent} مشترك.
        </p>
      </div>`;

    try {
      await sendEmail(
        process.env.SMTP_USER || 'info@mahadnafsy.com',
        `تقرير أقساط متأخرة — ${overdueList.length} قسط — ${today}`,
        adminHtml
      );
    } catch (_) {}

    await pool.query(
      'INSERT INTO activity_logs (id, action, entity, entity_id, label, actor) VALUES (?,?,?,?,?,?)',
      [uuidv4(), 'auto_reminder', 'installments', null,
       `تذكير أقساط تلقائي — ${overdueList.length} قسط متأخر، واتساب لـ ${waSent} مشترك`,
       'system']
    ).catch(() => {});

    logger.info(`[InstallmentReminder] ${overdueList.length} overdue installments, WA sent: ${waSent}`);
  } catch (e) { logger.warn('[InstallmentReminder] error:', e.message); }
}, 60 * 60 * 1000); // check every hour

// ═══════════════════════════════════════════════════════════════════════════
// ── FEATURE: Refund Requests System ──────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

// Ensure refund_requests table exists
pool.query(`
  CREATE TABLE IF NOT EXISTS refund_requests (
    id VARCHAR(36) PRIMARY KEY,
    subscriber_id VARCHAR(36) NOT NULL,
    payment_id VARCHAR(36) DEFAULT NULL,
    amount DECIMAL(10,2) NOT NULL DEFAULT 0,
    currency VARCHAR(10) DEFAULT 'EGP',
    reason TEXT,
    status ENUM('PENDING','APPROVED','REJECTED') DEFAULT 'PENDING',
    admin_note TEXT,
    refund_method VARCHAR(100) DEFAULT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    resolved_at DATETIME DEFAULT NULL,
    resolved_by VARCHAR(100) DEFAULT NULL,
    INDEX idx_subscriber (subscriber_id),
    INDEX idx_status (status)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`).catch(e => logger.warn('[Startup] refund_requests table check:', e.message));

// POST /api/me/refund-request — subscriber submits refund request
router.post('/api/me/refund-request', requireAuth, async (req, res) => {
  try {
    const uid = req.user?.uid;
    // Match by email too — a normal email/password customer's JWT uid is their
    // users-table id, not the subscriber's firebase_uid/id, so uid-only lookup
    // failed for real customers (refund request returned "Subscriber not found").
    const email = (req.user?.email || '').toLowerCase().trim();
    const [[sub]] = await pool.query(
      'SELECT id, name, email FROM subscribers WHERE firebase_uid=? OR id=? OR LOWER(TRIM(email))=? LIMIT 1',
      [uid, uid, email]);
    if (!sub) return res.status(404).json({ error: 'Subscriber not found' });
    const { payment_id, amount, currency = 'EGP', reason } = req.body;
    if (!reason || !amount) return res.status(400).json({ error: 'reason and amount are required' });
    const id = uuidv4();
    await pool.query(
      'INSERT INTO refund_requests (id, subscriber_id, payment_id, amount, currency, reason) VALUES (?,?,?,?,?,?)',
      [id, sub.id, payment_id || null, parseFloat(amount), currency, String(reason).substring(0, 1000)]
    );
    // Notify admin via email
    sendEmail(
      process.env.SMTP_USER || 'info@mahadnafsy.com',
      `طلب استرداد جديد — ${sub.name}`,
      `<div dir="rtl" style="font-family:Arial,sans-serif;padding:20px">
        <h2 style="color:#2d3748">طلب استرداد جديد</h2>
        <p><strong>العميل:</strong> ${sub.name} (${sub.email || '—'})</p>
        <p><strong>المبلغ:</strong> ${amount} ${currency}</p>
        <p><strong>السبب:</strong> ${reason}</p>
        <p style="color:#718096;font-size:13px">تسجيل الدخول للنظام لمراجعة الطلب</p>
      </div>`
    ).catch(() => {});
    res.json({ ok: true, id });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// POST /api/admin/refund-requests/by-admin — admin initiates a refund request for a subscriber
router.post('/api/admin/refund-requests/by-admin', requireAuth, requireAdminOrOnlineManagerOrCollection, async (req, res) => {
  try {
    const { subscriber_id, amount, currency = 'EGP', reason, refund_method } = req.body;
    if (!subscriber_id || !reason) return res.status(400).json({ error: 'subscriber_id and reason are required' });
    const actor = req.staffRecord?.name || req.user?.email || 'admin';
    // Skip if a PENDING refund request already exists for this subscriber
    const [[existing]] = await pool.query(
      "SELECT id FROM refund_requests WHERE subscriber_id=? AND status='PENDING' LIMIT 1",
      [subscriber_id]
    );
    if (existing) return res.json({ ok: true, id: existing.id, skipped: true });
    const id = uuidv4();
    await pool.query(
      'INSERT INTO refund_requests (id, subscriber_id, amount, currency, reason, refund_method, status) VALUES (?,?,?,?,?,?,?)',
      [id, subscriber_id, parseFloat(amount) || 0, currency, String(reason).substring(0, 1000), refund_method || null, 'PENDING']
    );
    await pool.query(
      'INSERT INTO activity_logs (id, action, entity, entity_id, label, actor) VALUES (?,?,?,?,?,?)',
      [uuidv4(), 'refund_created', 'refund_requests', id, `طلب استرداد بقيمة ${amount} ${currency} — بواسطة ${actor}`, actor]
    ).catch(() => {});
    res.json({ ok: true, id });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// GET /api/admin/refund-requests — list all refund requests
router.get('/api/admin/refund-requests', requireAuth, requireAdminOrOnlineManagerOrCollection, async (req, res) => {
  try {
    const { status } = req.query;
    let sql = `
      SELECT r.*, s.name AS subscriber_name, s.email AS subscriber_email, s.phone AS subscriber_phone,
             p.payment_type, p.payment_method, p.date AS payment_date
      FROM refund_requests r
      JOIN subscribers s ON s.id = r.subscriber_id
      LEFT JOIN payments p ON p.id = r.payment_id
    `;
    const params = [];
    if (status && status !== 'all') { sql += ' WHERE r.status = ?'; params.push(status); }
    sql += ' ORDER BY r.created_at DESC LIMIT 500';
    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// PATCH /api/admin/refund-requests/:id — approve or reject
router.patch('/api/admin/refund-requests/:id', requireAuth, requireAdminOrOnlineManagerOrCollection, async (req, res) => {
  try {
    const { id } = req.params;
    const { status, admin_note, refund_method } = req.body;
    if (!['APPROVED', 'REJECTED'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
    const actor = req.staffRecord?.name || req.user?.email || 'admin';
    await pool.query(
      'UPDATE refund_requests SET status=?, admin_note=?, refund_method=?, resolved_at=NOW(), resolved_by=? WHERE id=?',
      [status, admin_note || null, refund_method || null, actor, id]
    );
    // If APPROVED: mark linked payment as failed (refunded) and log audit
    const [[rr]] = await pool.query(
      'SELECT r.*, s.name AS sname, s.email AS semail FROM refund_requests r JOIN subscribers s ON s.id=r.subscriber_id WHERE r.id=?',
      [id]
    );
    if (status === 'APPROVED' && rr?.payment_id) {
      const [[oldPay]] = await pool.query('SELECT status, amount, currency, payment_type, subscriber_id, course_id, bundle_id FROM payments WHERE id=? LIMIT 1', [rr.payment_id]).catch(() => [[null]]);
      if (oldPay) {
        await pool.query('UPDATE payments SET status=\'failed\', note=CONCAT(COALESCE(note,\'\'),(IF(note IS NOT NULL AND note!=\'\',\' | \',\'\')),(\' مسترد — \',?)) WHERE id=?',
          [actor, rr.payment_id]).catch(() => {});
        logPaymentAudit(rr.payment_id, 'refund', oldPay.status, 'failed', oldPay.amount, oldPay.subscriber_id, actor).catch(() => {});
        syncLeadDealValue(rr.subscriber_id).catch(() => {});
        // Cancel related commission (staff shouldn't earn on refunded payment)
        pool.query(
          "UPDATE crm_commissions SET status='CANCELLED', note=CONCAT(COALESCE(note,''),' | ملغى بسبب الاسترداد') WHERE payment_id=? AND status IN ('PENDING','INCLUDED_IN_PAYROLL')",
          [rr.payment_id]
        ).catch(e => logger.warn('[refund] commission cancel:', e.message));
        // Remove enrollment if course/bundle payment was refunded
        if (oldPay.course_id || oldPay.bundle_id) {
          pool.query(
            'DELETE FROM enrollments WHERE subscriber_id=? AND course_id<=>? AND bundle_id<=>? LIMIT 1',
            [oldPay.subscriber_id, oldPay.course_id || null, oldPay.bundle_id || null]
          ).catch(e => logger.warn('[refund] enrollment remove:', e.message));
        }
        // Post reversal journal entry (normalised to EGP like all journal postings)
        const amt = parseFloat(oldPay.amount) || 0;
        if (amt > 0) {
          // Reverse against the SAME revenue account the original payment credited
          // (e.g. a refunded COURSE sale debits 4100, not a generic 4900) so the
          // reversal is symmetric and revenue per category nets to zero.
          const [revCode, revName] = _paymentAccountCode((oldPay.payment_type || 'OTHER').toUpperCase());
          toEgp(amt, oldPay.currency).then(amtEgp =>
            postJournalEntry('refund', rr.payment_id, new Date().toISOString().slice(0,10),
              `استرداد مبلغ ${amt} ${oldPay.currency || 'EGP'} (= ${amtEgp} EGP) — موافقة بواسطة ${actor}`,
              [
                { account_code: revCode, account_name: revName,        debit: amtEgp, credit: 0 },
                { account_code: '1100',  account_name: 'نقدية وبنوك',   debit: 0,      credit: amtEgp },
              ],
              actor
            )
          ).catch(() => {});
        }
      }
    }
    if (rr && rr.semail) {
      const statusAr = status === 'APPROVED' ? '✅ تمت الموافقة' : '❌ تم الرفض';
      sendEmail(rr.semail, `طلب الاسترداد — ${statusAr}`,
        `<div dir="rtl" style="font-family:Arial,sans-serif;padding:20px;max-width:500px">
          <h2 style="color:${status==='APPROVED'?'#2f855a':'#c53030'}">${statusAr} على طلب الاسترداد</h2>
          <p>أهلاً ${rr.sname}، بخصوص طلب الاسترداد بمبلغ <strong>${rr.amount} ${rr.currency}</strong>:</p>
          ${admin_note ? `<p style="background:#f7fafc;padding:12px;border-right:3px solid #4299e1;color:#2d3748"><strong>ملاحظة الإدارة:</strong> ${admin_note}</p>` : ''}
          ${status==='APPROVED' && refund_method ? `<p><strong>طريقة الاسترداد:</strong> ${refund_method}</p>` : ''}
          <p style="color:#718096;font-size:13px">معهد الدراسات النفسية — info@mahadnafsy.com</p>
        </div>`
      ).catch(() => {});
    }
    await pool.query(
      'INSERT INTO activity_logs (id, action, entity, entity_id, label, actor) VALUES (?,?,?,?,?,?)',
      [uuidv4(), status === 'APPROVED' ? 'refund_approved' : 'refund_rejected', 'refund_requests', id,
       `استرداد ${status === 'APPROVED' ? 'موافق عليه' : 'مرفوض'} — ${rr?.sname || id}`, actor]
    ).catch(() => {});
    res.json({ ok: true });
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// ── FEATURE: Weekly Performance Summary Email ─────────────────────────────
// Sent every Sunday at 8:00 AM Cairo time (UTC+2) to all admin emails.
// Covers the last 7 days: revenue, new leads, new subscribers, top staff.
// ═══════════════════════════════════════════════════════════════════════════
let _lastWeeklySummaryDate = '';
setInterval(async () => {
  try {
    const now = new Date();
    const cairoHour = (now.getUTCHours() + 2) % 24;
    const cairoDow  = new Date(now.getTime() + 2 * 60 * 60 * 1000).getDay(); // 0=Sunday
    const today     = new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString().slice(0, 10);
    if (cairoDow !== 0 || cairoHour !== 8 || today === _lastWeeklySummaryDate) return;
    _lastWeeklySummaryDate = today;

    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    // Revenue (last 7 days)
    const [[{ revenue }]] = await pool.query(
      `SELECT COALESCE(SUM(amount), 0) AS revenue FROM payments
       WHERE date >= ? AND status = 'paid'`, [weekAgo]
    ).catch(() => [[{ revenue: 0 }]]);

    // New leads
    const [[{ newLeads }]] = await pool.query(
      `SELECT COUNT(*) AS newLeads FROM leads WHERE created_at >= ?`, [weekAgo]
    ).catch(() => [[{ newLeads: 0 }]]);

    // New subscribers
    const [[{ newSubs }]] = await pool.query(
      `SELECT COUNT(*) AS newSubs FROM subscribers WHERE created_at >= ?`, [weekAgo]
    ).catch(() => [[{ newSubs: 0 }]]);

    // Conversion rate
    const convRate = newLeads > 0 ? Math.round((newSubs / newLeads) * 100) : 0;

    // Top 3 performing staff by commissions this week
    const [topStaff] = await pool.query(
      `SELECT s.name, COALESCE(SUM(c.commission_amount),0) AS earned
       FROM crm_commissions c
       LEFT JOIN staff s ON s.id = c.staff_id
       WHERE c.created_at >= ?
       GROUP BY c.staff_id ORDER BY earned DESC LIMIT 3`, [weekAgo]
    ).catch(() => [[]]);

    const topStaffHtml = topStaff.length > 0
      ? topStaff.map((s, i) => `<li>${['🥇','🥈','🥉'][i]} <strong>${s.name || 'غير معروف'}</strong> — ${Number(s.earned).toLocaleString()} ج</li>`).join('')
      : '<li>لا توجد بيانات</li>';

    // Previous week comparison
    const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const [[{ prevRevenue }]] = await pool.query(
      `SELECT COALESCE(SUM(amount), 0) AS prevRevenue FROM payments
       WHERE date >= ? AND date < ? AND status = 'paid'`, [twoWeeksAgo, weekAgo]
    ).catch(() => [[{ prevRevenue: 0 }]]);

    const revenueChange = prevRevenue > 0
      ? ((revenue - prevRevenue) / prevRevenue * 100).toFixed(1)
      : 'N/A';
    const revenueArrow = revenue >= prevRevenue ? '📈' : '📉';

    const adminEmails = (process.env.ADMIN_EMAILS || '').split(',').filter(Boolean);
    if (!adminEmails.length) return;

    const subject = `📊 التقرير الأسبوعي — ${today} | مهاد النفسي`;
    const html = `
      <div dir="rtl" style="font-family:Tahoma,Arial,sans-serif;max-width:600px;margin:0 auto;background:#f8fafc;padding:24px;border-radius:12px">
        <h2 style="color:#1e3a5f;margin-bottom:4px">📊 التقرير الأسبوعي</h2>
        <p style="color:#64748b;font-size:13px">الفترة: ${weekAgo} ← ${today}</p>
        <hr style="border:none;border-top:2px solid #e2e8f0;margin:16px 0">

        <table style="width:100%;border-collapse:collapse">
          <tr>
            <td style="padding:12px;background:#fff;border-radius:8px;text-align:center;width:25%">
              <div style="font-size:24px;font-weight:900;color:#10b981">${Number(revenue).toLocaleString()}</div>
              <div style="font-size:11px;color:#64748b">إيراد الأسبوع (ج)</div>
              <div style="font-size:11px">${revenueArrow} ${revenueChange}% من الأسبوع السابق</div>
            </td>
            <td style="width:8px"></td>
            <td style="padding:12px;background:#fff;border-radius:8px;text-align:center;width:25%">
              <div style="font-size:24px;font-weight:900;color:#3b82f6">${Number(newLeads)}</div>
              <div style="font-size:11px;color:#64748b">ليدات جديدة</div>
            </td>
            <td style="width:8px"></td>
            <td style="padding:12px;background:#fff;border-radius:8px;text-align:center;width:25%">
              <div style="font-size:24px;font-weight:900;color:#8b5cf6">${Number(newSubs)}</div>
              <div style="font-size:11px;color:#64748b">مشتركون جدد</div>
            </td>
            <td style="width:8px"></td>
            <td style="padding:12px;background:#fff;border-radius:8px;text-align:center;width:25%">
              <div style="font-size:24px;font-weight:900;color:#f59e0b">${convRate}%</div>
              <div style="font-size:11px;color:#64748b">معدل التحويل</div>
            </td>
          </tr>
        </table>

        <div style="background:#fff;border-radius:8px;padding:16px;margin-top:16px">
          <h3 style="color:#374151;margin:0 0 10px">🏆 أفضل الموظفين هذا الأسبوع</h3>
          <ul style="padding-right:20px;margin:0;color:#374151;line-height:2">${topStaffHtml}</ul>
        </div>

        <p style="color:#94a3b8;font-size:11px;text-align:center;margin-top:20px">
          هذا التقرير يُرسَل تلقائياً كل أحد الساعة 8 صباحاً — مهاد النفسي
        </p>
      </div>`;

    for (const email of adminEmails) {
      await sendEmail({ to: email, subject, html }).catch(e =>
        logger.warn('[WeeklyEmail] send error:', e.message)
      );
    }
    logger.info(`[WeeklyEmail] Sent to ${adminEmails.length} admin(s) for week ${today}`);
  } catch (e) { logger.warn('[WeeklyEmail] error:', e.message); }
}, 60 * 60 * 1000);

module.exports = router;
