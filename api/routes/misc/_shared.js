'use strict';
const logger = require('../../lib/logger');
const { uuidv4 } = require('../../lib/id');
const { pool } = require('../../lib/db');
const { mailer, sendEmail } = require('../../lib/email');
const { sendWhatsApp } = require('../../lib/whatsapp');
const { requireAuth, requireAdmin, requireSuperAdmin, requireAdminOrStaff } = require('../../middleware/auth');
const { DEFAULT_TENANT } = require('../../middleware/tenantContext');
const { logLoginAttempt } = require('../../lib/loginAudit');
const { createNotification } = require('../../lib/notification');

async function forEachActiveTenant(task) {
  let tenantIds = [DEFAULT_TENANT];
  try {
    const [rows] = await pool.query("SELECT id FROM tenants WHERE status='active'");
    if (rows.length) tenantIds = rows.map((row) => row.id);
  } catch (_) { /* SaaS schema may not be installed during early bootstrap. */ }
  for (const tenantId of tenantIds) await task(tenantId);
}

async function logLogin(userId, email, req, status, failureReason = null) {
  return logLoginAttempt({ userId, email, req, status, failureReason });
}

// GET /api/admin/security/login-history?limit=50&email=&status=

async function sendDailyReport(tenantId = DEFAULT_TENANT) {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

    const [[{ revenue }]] = await pool.query(
      `SELECT COALESCE(SUM(amount_egp),0) AS revenue FROM payments WHERE tenant_id=? AND status='paid' AND created_at >= ? AND created_at < DATE_ADD(?, INTERVAL 1 DAY)`, [tenantId, today, today]);
    const [[{ new_leads }]] = await pool.query(
      `SELECT COUNT(*) AS new_leads FROM leads WHERE tenant_id=? AND created_at >= ? AND created_at < DATE_ADD(?, INTERVAL 1 DAY)`, [tenantId, today, today]);
    const [[{ new_clients }]] = await pool.query(
      `SELECT COUNT(*) AS new_clients FROM subscribers WHERE tenant_id=? AND created_at >= ? AND created_at < DATE_ADD(?, INTERVAL 1 DAY)`, [tenantId, today, today]);
    const [[{ pending_payments }]] = await pool.query(
      `SELECT COUNT(*) AS pending_payments FROM payments WHERE tenant_id=? AND status='pending'`, [tenantId]);
    const [[{ failed_logins }]] = await pool.query(
      `SELECT COUNT(*) AS failed_logins FROM login_history WHERE tenant_id=? AND status='failed' AND created_at >= ? AND created_at < DATE_ADD(?, INTERVAL 1 DAY)`, [tenantId, today, today]).catch(() => [[{ failed_logins: 0 }]]);
    const [[{ month_revenue }]] = await pool.query(
      `SELECT COALESCE(SUM(amount_egp),0) AS month_revenue FROM payments WHERE tenant_id=? AND status='paid' AND DATE_FORMAT(created_at,'%Y-%m')=DATE_FORMAT(NOW(),'%Y-%m')`, [tenantId]);

    // Get admin emails from DB settings
    const [adminStaff] = await pool.query(`SELECT email FROM staff WHERE tenant_id=? AND UPPER(role)='ADMIN' AND email IS NOT NULL LIMIT 5`, [tenantId]).catch(() => [[]]);

    if (!adminStaff.length) return;

    const smtpSettings = await pool.query("SELECT setting_key, setting_value FROM settings WHERE setting_key IN ('smtp_host','smtp_port','smtp_user','smtp_pass','smtp_from') LIMIT 10")
      .then(([rows]) => Object.fromEntries(rows.map(r => [r.setting_key, r.setting_value])))
      .catch(() => ({}));

    if (!smtpSettings.smtp_host || !smtpSettings.smtp_user) {
      // Try from env
      if (!process.env.SMTP_HOST) return;
    }

    const transporter = require('nodemailer').createTransport({
      host: smtpSettings.smtp_host || process.env.SMTP_HOST,
      port: parseInt(smtpSettings.smtp_port || process.env.SMTP_PORT || '587'),
      secure: false,
      auth: {
        user: smtpSettings.smtp_user || process.env.SMTP_USER,
        pass: smtpSettings.smtp_pass || process.env.SMTP_PASS,
      },
    });

    const html = `
      <div dir="rtl" style="font-family:Cairo,Arial,sans-serif;max-width:600px;margin:auto;padding:24px;background:#f8fafc;border-radius:12px;">
        <h2 style="color:#6C63FF;margin-bottom:4px;">📊 التقرير اليومي — ${today}</h2>
        <p style="color:#64748b;font-size:13px;margin-bottom:24px;">ملخص أداء المعهد النفسي</p>
        <table style="width:100%;border-collapse:collapse;">
          <tr style="background:#6C63FF;color:#fff;">
            <th style="padding:10px;text-align:right;">المؤشر</th>
            <th style="padding:10px;text-align:right;">اليوم</th>
          </tr>
          <tr style="background:#fff;"><td style="padding:10px;border-bottom:1px solid #f1f5f9;">💰 الإيرادات</td><td style="padding:10px;border-bottom:1px solid #f1f5f9;font-weight:bold;color:#16a34a;">${Number(revenue).toLocaleString('ar-EG')} ج.م</td></tr>
          <tr style="background:#f8fafc;"><td style="padding:10px;border-bottom:1px solid #f1f5f9;">👥 عملاء محتملون جدد</td><td style="padding:10px;border-bottom:1px solid #f1f5f9;font-weight:bold;">${new_leads}</td></tr>
          <tr style="background:#fff;"><td style="padding:10px;border-bottom:1px solid #f1f5f9;">✅ عملاء مسجلون جدد</td><td style="padding:10px;border-bottom:1px solid #f1f5f9;font-weight:bold;">${new_clients}</td></tr>
          <tr style="background:#f8fafc;"><td style="padding:10px;border-bottom:1px solid #f1f5f9;">⏳ مدفوعات معلقة</td><td style="padding:10px;border-bottom:1px solid #f1f5f9;font-weight:bold;color:#d97706;">${pending_payments}</td></tr>
          <tr style="background:#fff;"><td style="padding:10px;border-bottom:1px solid #f1f5f9;">🔴 محاولات دخول فاشلة</td><td style="padding:10px;border-bottom:1px solid #f1f5f9;font-weight:bold;color:${failed_logins >= 10 ? '#dc2626' : '#374151'};">${failed_logins}</td></tr>
          <tr style="background:#f8fafc;"><td style="padding:10px;">📈 إيرادات الشهر الحالي</td><td style="padding:10px;font-weight:bold;color:#6C63FF;">${Number(month_revenue).toLocaleString('ar-EG')} ج.م</td></tr>
        </table>
        <p style="color:#94a3b8;font-size:11px;margin-top:20px;text-align:center;">تم الإرسال تلقائياً من النظام — المعهد النفسي</p>
      </div>`;

    for (const admin of adminStaff) {
      await transporter.sendMail({
        from: smtpSettings.smtp_from || smtpSettings.smtp_user || process.env.SMTP_USER,
        to: admin.email,
        subject: `📊 تقرير يومي — ${today} | المعهد النفسي`,
        html,
      }).catch(e => logger.warn('[daily-report] send error:', e.message));
    }
    logger.info(`[daily-report] sent to ${adminStaff.length} admin(s)`);
  } catch (e) { logger.warn('[daily-report] error:', e.message); }
}

// Schedule: every day at 7:00 AM server time
function scheduleDailyReport() {
  const now = new Date();
  const next7am = new Date(now);
  next7am.setHours(7, 0, 0, 0);
  if (next7am <= now) next7am.setDate(next7am.getDate() + 1);
  const msUntil = next7am - now;
  setTimeout(() => {
    forEachActiveTenant(sendDailyReport);
    setInterval(() => forEachActiveTenant(sendDailyReport), 24 * 60 * 60 * 1000);
  }, msUntil);
  logger.info(`[daily-report] scheduled — next run in ${Math.round(msUntil / 3600000)}h`);
}
scheduleDailyReport();

// GET /api/admin/reports/daily-preview — preview what the daily report would look like

// pushAdminNotif() used to live here, writing into `admin_notifications` — a
// second, parallel notification table nothing in the admin UI ever read
// (NotifInboxMgmtTab.tsx was wired to yet a THIRD thing, the marketing-
// broadcast list — see NOT-01/NOT-03). createNotification() (lib/notification.js)
// writes the one real `notifications` table the header bell actually polls;
// callers below now use that instead.

async function runFollowUpReminders(tenantId = DEFAULT_TENANT) {
  try {
    const today = new Date().toISOString().slice(0, 10);
    // Leads due for follow-up today
    const [leads] = await pool.query(`
      SELECT l.id, l.name, l.phone, l.email,
             l.next_follow_up_date, l.status, l.source,
             st.name AS staff_name, st.phone AS staff_phone, st.email AS staff_email
      FROM leads l
      LEFT JOIN staff st ON st.id = l.assigned_sales_id AND st.tenant_id = l.tenant_id
      WHERE l.tenant_id = ? AND l.next_follow_up_date >= ? AND l.next_follow_up_date < DATE_ADD(?, INTERVAL 1 DAY)
        AND l.status NOT IN ('converted','disqualified','archived')
      LIMIT 100`, [tenantId, today, today]);

    let sent = 0;
    // Batch-check which leads were already reminded today (1 query instead of N)
    const _fuKeys = leads.map(l => `followup_${l.id}_${today}`);
    const [_fuSentRows] = leads.length ? await pool.query(
      `SELECT ref_id FROM reminder_log WHERE tenant_id=? AND type='followup' AND ref_id IN (${_fuKeys.map(() => '?').join(',')}) AND sent_at >= ? AND sent_at < DATE_ADD(?, INTERVAL 1 DAY)`, [tenantId, ..._fuKeys, today, today]
    ).catch(() => [[]]) : [[]];
    const _fuDone = new Set(_fuSentRows.map(r => r.ref_id));
    for (const lead of leads) {
      const logKey = `followup_${lead.id}_${today}`;
      if (_fuDone.has(logKey)) continue;

      // WhatsApp to assigned staff
      if (lead.staff_phone) {
        const msg = `🔔 تذكير متابعة\nالعميل المحتمل: ${lead.name}\nالهاتف: ${lead.phone || '—'}\nالمصدر: ${lead.source || '—'}\nالحالة: ${lead.status || '—'}\n\nيرجى التواصل اليوم 📞`;
        sendWhatsApp(lead.staff_phone.replace(/\D/g, ''), msg, { tenantId }).catch(() => {});
      }

      // Email to assigned staff
      if (lead.staff_email) {
        mailer.sendMail({
          tenantId,
          from: process.env.SMTP_FROM || process.env.SMTP_USER,
          to: lead.staff_email,
          subject: `🔔 تذكير متابعة — ${lead.name}`,
          html: `<div dir="rtl" style="font-family:Arial;padding:16px;background:#f8fafc;border-radius:8px;">
            <h3 style="color:#6C63FF;">تذكير متابعة عميل محتمل</h3>
            <table style="border-collapse:collapse;width:100%">
              <tr><td style="padding:6px 12px;font-weight:bold;">الاسم</td><td style="padding:6px 12px;">${lead.name}</td></tr>
              <tr style="background:#fff"><td style="padding:6px 12px;font-weight:bold;">الهاتف</td><td style="padding:6px 12px;">${lead.phone || '—'}</td></tr>
              <tr><td style="padding:6px 12px;font-weight:bold;">الحالة</td><td style="padding:6px 12px;">${lead.status || '—'}</td></tr>
              <tr style="background:#fff"><td style="padding:6px 12px;font-weight:bold;">المصدر</td><td style="padding:6px 12px;">${lead.source || '—'}</td></tr>
            </table>
            <p style="color:#94a3b8;font-size:12px;margin-top:16px;">أُرسل تلقائياً — المعهد النفسي</p>
          </div>`,
        }).catch(() => {});
      }

      // Push admin notification
      createNotification('info', `تذكير متابعة: ${lead.name}`,
        `موعد متابعة ${lead.name} (${lead.staff_name || 'غير محدد'}) — اليوم`,
        { link: '/dashboard?tab=leads', leadId: lead.id }, tenantId
      ).catch(() => {});

      // Log to avoid re-send
      pool.query(`INSERT IGNORE INTO reminder_log (type, ref_id, tenant_id) VALUES ('followup', ?, ?)`, [logKey, tenantId]).catch(() => {});
      sent++;
    }
    if (sent > 0) logger.info(`[followup-reminders] sent ${sent} reminder(s) for ${today}`);
  } catch (e) { logger.warn('[followup-reminders] error:', e.message); }
}

// Run daily at 8:00 AM
function scheduleFollowUpReminders() {
  const now = new Date();
  const next8am = new Date(now);
  next8am.setHours(8, 0, 0, 0);
  if (next8am <= now) next8am.setDate(next8am.getDate() + 1);
  const ms = next8am - now;
  setTimeout(() => {
    forEachActiveTenant(runFollowUpReminders);
    setInterval(() => forEachActiveTenant(runFollowUpReminders), 24 * 60 * 60 * 1000);
  }, ms);
  logger.info(`[followup-reminders] scheduled — next run in ${Math.round(ms / 3600000)}h`);
}
scheduleFollowUpReminders();

// GET /api/admin/leads/due-today — list leads due for follow-up today

async function runPaymentDueReminders(tenantId = DEFAULT_TENANT) {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const in3days = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
    const in1day  = new Date(Date.now() + 1 * 86400000).toISOString().slice(0, 10);

    // Find pending installment payments coming due
    const [pending] = await pool.query(`
      SELECT p.id, p.subscriber_id, p.amount, p.currency, p.date AS due_date,
             s.name, s.phone, s.email, s.client_code
      FROM payments p
      JOIN subscribers s ON s.id = p.subscriber_id AND s.tenant_id = p.tenant_id
      WHERE p.tenant_id = ? AND p.status = 'pending'
        AND p.is_installment = 1
        AND DATE(p.date) IN (?, ?)
      LIMIT 200`, [tenantId, in3days, in1day]);

    let sent = 0;
    // Batch-check which payments were already reminded today (1 query instead of N)
    const _pdKeys = pending.map(p => `payment_due_${p.id}_${today}`);
    const [_pdSentRows] = pending.length ? await pool.query(
      `SELECT ref_id FROM reminder_log WHERE tenant_id=? AND type='payment_due' AND ref_id IN (${_pdKeys.map(() => '?').join(',')}) AND sent_at >= ? AND sent_at < DATE_ADD(?, INTERVAL 1 DAY)`, [tenantId, ..._pdKeys, today, today]
    ).catch(() => [[]]) : [[]];
    const _pdDone = new Set(_pdSentRows.map(r => r.ref_id));
    for (const p of pending) {
      const logKey = `payment_due_${p.id}_${today}`;
      if (_pdDone.has(logKey)) continue;

      const daysLeft = Math.round((new Date(p.due_date) - new Date(today)) / 86400000);
      const amountFmt = `${Number(p.amount).toLocaleString('ar-EG')} ${p.currency || 'ج.م'}`;

      // WhatsApp to client
      if (p.phone) {
        const msg = `مرحباً ${p.name} 👋\nهذا تذكير بموعد دفعتك القادمة:\n💰 المبلغ: ${amountFmt}\n📅 الموعد: ${p.due_date} (خلال ${daysLeft} يوم${daysLeft === 1 ? '' : 'أ'})\n\nشكراً لثقتك في معهد مهاد 💚`;
        sendWhatsApp(p.phone.replace(/\D/g, ''), msg, { tenantId }).catch(() => {});
      }

      // Email to client
      if (p.email) {
        mailer.sendMail({
          tenantId,
          from: process.env.SMTP_FROM || process.env.SMTP_USER,
          to: p.email,
          subject: `تذكير بموعد الدفع — ${p.due_date}`,
          html: `<div dir="rtl" style="font-family:Cairo,Arial;max-width:500px;margin:auto;padding:24px;background:#f8fafc;border-radius:12px;">
            <h3 style="color:#6C63FF;">تذكير بموعد دفعة</h3>
            <p>مرحباً <strong>${p.name}</strong>،</p>
            <p>نودّ تذكيرك بموعد دفعتك القادمة:</p>
            <div style="background:#fff;border-radius:8px;padding:16px;border:1px solid #e2e8f0;">
              <p>💰 <strong>المبلغ:</strong> ${amountFmt}</p>
              <p>📅 <strong>تاريخ الاستحقاق:</strong> ${p.due_date}</p>
              <p>⏳ <strong>المتبقي:</strong> ${daysLeft} يوم</p>
            </div>
            <p style="margin-top:16px;">شكراً لثقتك في <strong>معهد مهاد للدراسات النفسية</strong> 💚</p>
            <p style="color:#94a3b8;font-size:11px;">أُرسل تلقائياً</p>
          </div>`,
        }).catch(() => {});
      }

      pool.query(`INSERT IGNORE INTO reminder_log (type, ref_id, tenant_id) VALUES ('payment_due', ?, ?)`, [logKey, tenantId]).catch(() => {});
      sent++;
    }
    if (sent > 0) logger.info(`[payment-reminders] sent ${sent} reminder(s)`);
  } catch (e) { logger.warn('[payment-reminders] error:', e.message); }
}

// Run daily at 9:00 AM
function schedulePaymentReminders() {
  const now = new Date();
  const next9am = new Date(now);
  next9am.setHours(9, 0, 0, 0);
  if (next9am <= now) next9am.setDate(next9am.getDate() + 1);
  const ms = next9am - now;
  setTimeout(() => {
    forEachActiveTenant(runPaymentDueReminders);
    setInterval(() => forEachActiveTenant(runPaymentDueReminders), 24 * 60 * 60 * 1000);
  }, ms);
  logger.info(`[payment-reminders] scheduled — next run in ${Math.round(ms / 3600000)}h`);
}
schedulePaymentReminders();

// GET /api/admin/payments/due-upcoming?days=7 — payments due soon

async function getSysConfig(section, tenantId) {
  const { getTenantSetting } = require('../../lib/tenantSettings');
  return getTenantSetting(`sys_${section}`, { tenantId, fallback: null });
}
// Helper to save system config section
async function setSysConfig(section, value, tenantId, actorId = null) {
  const { setTenantSetting } = require('../../lib/tenantSettings');
  await setTenantSetting(`sys_${section}`, value, { tenantId, actorId });
}

// Default system config (used when nothing saved yet)
const SYS_DEFAULTS = {
  branches: [
    { key: 'DAQQI',        label: 'دقي',               is_active: true },
    { key: 'TAGAMOA',      label: 'التجمع الخامس',      is_active: true },
    { key: 'ONLINE_EGYPT', label: 'أونلاين - مصر',      is_active: true },
    { key: 'ONLINE_SAUDI', label: 'أونلاين - السعودية', is_active: true },
    { key: 'ONLINE_ABROAD', label: 'أونلاين - الخارج',  is_active: true },
    { key: 'OTHER',        label: 'أخرى',               is_active: true },
  ],
  currencies: [
    { code: 'EGP', symbol: 'ج.م', name: 'جنيه مصري',    is_default: true,  is_active: true },
    { code: 'SAR', symbol: 'ر.س', name: 'ريال سعودي',   is_default: false, is_active: true },
    { code: 'USD', symbol: '$',   name: 'دولار أمريكي', is_default: false, is_active: true },
    { code: 'EUR', symbol: '€',   name: 'يورو',          is_default: false, is_active: false },
  ],
  countries: [
    { code: 'EG', name: 'مصر',        flag: '🇪🇬', is_active: true },
    { code: 'SA', name: 'السعودية',   flag: '🇸🇦', is_active: true },
    { code: 'AE', name: 'الإمارات',   flag: '🇦🇪', is_active: true },
    { code: 'KW', name: 'الكويت',     flag: '🇰🇼', is_active: true },
    { code: 'QA', name: 'قطر',        flag: '🇶🇦', is_active: true },
    { code: 'JO', name: 'الأردن',     flag: '🇯🇴', is_active: true },
    { code: 'LB', name: 'لبنان',      flag: '🇱🇧', is_active: true },
    { code: 'MA', name: 'المغرب',     flag: '🇲🇦', is_active: true },
    { code: 'SD', name: 'السودان',    flag: '🇸🇩', is_active: true },
    { code: 'OTHER', name: 'أخرى',   flag: '🌍', is_active: true },
  ],
  payment_methods: [
    { key: 'cash',          label: 'كاش',              icon: '💵', is_active: true },
    { key: 'visa',          label: 'فيزا / بطاقة',     icon: '💳', is_active: true },
    { key: 'instapay',      label: 'إنستاباي',         icon: '📱', is_active: true },
    { key: 'bank_transfer', label: 'تحويل بنكي',       icon: '🏦', is_active: true },
    { key: 'paymob',        label: 'PayMob',            icon: '🔌', is_active: false },
    { key: 'vodafone_cash', label: 'فودافون كاش',      icon: '📲', is_active: true },
    { key: 'other',         label: 'أخرى',             icon: '📦', is_active: true },
  ],
  session_types: [
    { key: 'INDIVIDUAL', label: 'فردي',    is_active: true },
    { key: 'COUPLE',     label: 'زوجي',    is_active: true },
    { key: 'FAMILY',     label: 'عائلي',   is_active: true },
    { key: 'GROUP',      label: 'جماعي',   is_active: false },
  ],
  lead_sources: [
    { key: 'facebook',    label: 'فيسبوك',       is_active: true },
    { key: 'instagram',   label: 'إنستجرام',     is_active: true },
    { key: 'website',     label: 'الموقع',       is_active: true },
    { key: 'referral',    label: 'توصية',         is_active: true },
    { key: 'whatsapp',    label: 'واتساب',        is_active: true },
    { key: 'call',        label: 'اتصال مباشر',  is_active: true },
    { key: 'other',       label: 'أخرى',         is_active: true },
  ],
  expense_categories: [
    { key: 'rent',        label: 'إيجار',        is_active: true },
    { key: 'salaries',    label: 'رواتب',         is_active: true },
    { key: 'marketing',   label: 'تسويق',        is_active: true },
    { key: 'utilities',   label: 'فواتير',       is_active: true },
    { key: 'supplies',    label: 'مستلزمات',     is_active: true },
    { key: 'maintenance', label: 'صيانة',        is_active: true },
    { key: 'software',    label: 'برامج / تقنية', is_active: true },
    { key: 'travel',      label: 'مواصلات',      is_active: true },
    { key: 'other',       label: 'أخرى',         is_active: true },
  ],
  general: {
    institute_name:    'معهد الدراسات النفسية',
    institute_name_en: 'Institute of Psychological Studies',
    website_url:       'https://mahadnafsy.com',
    support_email:     'info@mahadnafsy.com',
    support_phone:     '',
    default_currency:  'EGP',
    default_timezone:  'Africa/Cairo',
    vat_percent:       14,
    invoice_prefix:    'INV',
    session_duration_default: 60,
    working_days:      ['Sunday','Monday','Tuesday','Wednesday','Thursday'],
  },
  nationalities: [
    { key: 'EGYPTIAN',             label: 'مصري',                   is_active: true },
    { key: 'NON_EGYPTIAN_EGYPT',   label: 'غير مصري (مقيم بمصر)',   is_active: true },
    { key: 'SAUDI_RESIDENT',       label: 'مقيم بالسعودية',         is_active: true },
    { key: 'INTERNATIONAL',        label: 'دولي',                   is_active: true },
  ],
  staff_roles: [
    { key: 'ADMIN',           label: 'مدير',              is_active: true },
    { key: 'MANAGER',         label: 'مشرف',              is_active: true },
    { key: 'SALES',           label: 'مبيعات',            is_active: true },
    { key: 'CONSULTANT',      label: 'مستشار / معالج',    is_active: true },
    { key: 'INSTRUCTOR',      label: 'محاضر',             is_active: true },
    { key: 'TRAINER',         label: 'مدرب',              is_active: true },
    { key: 'SUPPORT',         label: 'دعم عملاء',         is_active: true },
    { key: 'COLLECTION',      label: 'تحصيل',             is_active: true },
    { key: 'ACCOUNTANT',      label: 'محاسب',             is_active: true },
    { key: 'RECEPTION_DAQQI', label: 'استقبال دقي',       is_active: true },
    { key: 'EXPERT',          label: 'خبير',              is_active: false },
    { key: 'OTHER',           label: 'أخرى',              is_active: true },
  ],
  cert_pricing: [
    { type: 'social_solidarity',  label: 'شهادة تضامن اجتماعي', price_egyptian: 500,  price_non_egyptian: 700,  price_saudi: 800,  price_international: 1000 },
    { type: 'ain_shams',          label: 'جامعة عين شمس',        price_egyptian: 800,  price_non_egyptian: 1000, price_saudi: 1200, price_international: 1500 },
    { type: 'experience_external',label: 'خبرة خارجي',           price_egyptian: 400,  price_non_egyptian: 600,  price_saudi: 700,  price_international: 900  },
    { type: 'practice_external',  label: 'مزاولة خارجي',         price_egyptian: 400,  price_non_egyptian: 600,  price_saudi: 700,  price_international: 900  },
    { type: 'national_council',   label: 'المجلس القومي',         price_egyptian: 600,  price_non_egyptian: 800,  price_saudi: 1000, price_international: 1200 },
    { type: 'american_board',     label: 'البورد الأمريكي',       price_egyptian: 1200, price_non_egyptian: 1500, price_saudi: 1800, price_international: 2000 },
    { type: 'institute',          label: 'شهادة معهد',            price_egyptian: 300,  price_non_egyptian: 450,  price_saudi: 500,  price_international: 700  },
  ],
  financial: {
    consultation_price:        400,
    installment_down_pct:       30,
    max_installment_months:     12,
    default_lead_sla_hours:     24,
    lead_auto_archive_days:     90,
    vat_percent:                14,
    invoice_prefix:          'INV',
    session_duration_default:   60,
  },
};

// GET /api/admin/sys-config — get all sections or specific section

const KV_ALLOWED_KEYS = ['tasks_board', 'support_tickets', 'sales_motiv_posts', 'automation_rules'];

// GET /api/admin/kv/:key

module.exports = { logLogin, sendDailyReport, scheduleDailyReport, runFollowUpReminders, scheduleFollowUpReminders, runPaymentDueReminders, schedulePaymentReminders, getSysConfig, setSysConfig, SYS_DEFAULTS, KV_ALLOWED_KEYS };
