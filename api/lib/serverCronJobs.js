'use strict';

const { transitionLead } = require('./leadState');
const { getTenantSetting, setTenantSetting } = require('./tenantSettings');
const { invalidateFxCache } = require('./finance');

function startServerCronJobs({
  pool,
  tryJson,
  sendWhatsApp,
  logger,
  createNotification,
  cacheInvalidate,
  uuidv4,
  port,
  loadBlacklistFromDB,
}) {
  const PORT = port;

  // Load token blacklist from DB so revoked tokens survive restarts
  loadBlacklistFromDB().catch(() => {});

  // -- Installment reminder Cron (runs once per hour, checks due in 3 days) --
  const CRON_INTERVAL_MS = 60 * 60 * 1000; // every hour
  // Guard: track which (subscriberId+dueDate) pairs received a reminder today
  // Prevents duplicate sends on server restart or repeated cron runs within same day.
  const _installmentReminderSentToday = new Set(); // key: `${subId}:${dueDate}`
  let _installmentReminderLastReset = new Date().toISOString().slice(0, 10);
  async function installmentReminderCron() {
    try {
      // Reset daily tracking set at midnight
      const today = new Date().toISOString().slice(0, 10);
      if (today !== _installmentReminderLastReset) {
        _installmentReminderSentToday.clear();
        _installmentReminderLastReset = today;
      }

      // Find subscribers whose installment plan has a due_date = today+3 (stored in crm_json)
      // crm_json may contain: installmentPlans: [{dueDate:"2026-04-18", amount, paid, courseId}]
      const targetDate = new Date();
      targetDate.setDate(targetDate.getDate() + 3);
      const target = targetDate.toISOString().slice(0, 10); // "YYYY-MM-DD"

      // Filter at DB level - only subscribers who have installment data (crm_json LIKE check)
      // Avoids loading entire subscribers table into memory on large datasets.
      const [subs] = await pool.query(
        "SELECT id, tenant_id, name, phone, crm_json FROM subscribers WHERE is_active=1 AND crm_json LIKE '%installmentPlans%' LIMIT 2000"
      );
      let sentCount = 0;
      for (const sub of subs) {
        const crm = tryJson(sub.crm_json, {});
        const plans = crm.installmentPlans || [];
        for (const plan of plans) {
          for (const entry of (plan.entries || [])) {
            const dueDate = (entry.dueDate || '').slice(0, 10);
            if (dueDate !== target) continue;
            if (entry.paidAt) continue; // already paid
            if (!sub.phone) continue;
            // Dedup: skip if already sent today for this entry
            const dedupeKey = `${sub.tenant_id}:${sub.id}:${dueDate}:${plan.courseId || ''}`;
            if (_installmentReminderSentToday.has(dedupeKey)) continue;
            _installmentReminderSentToday.add(dedupeKey);
            const courseName = plan.courseTitle || 'غير محدد';
            const msg = `تذكير: باقي من القسط ${entry.amount} ${plan.currency || 'EGP'} مستحق خلال 3 أيام (${dueDate}) - ${courseName}. يرجى السداد في الموعد المحدد. - معهد الدراسات النفسية`;
            try { await sendWhatsApp(sub.phone, msg, { tenantId: sub.tenant_id }); } catch (_) {}
            sentCount++;
            // Rate-limit WA sends to avoid being flagged as spam (max 1 msg/2s)
            if (sentCount % 5 === 0) await new Promise(r => setTimeout(r, 2000));
          }
        }
      }
      if (sentCount) logger.info(`[Cron] installmentReminder: sent ${sentCount} WA reminders`);
    } catch (e) {
      logger.warn('[Cron] installmentReminderCron error:', e.message);
    }
  }
  // Run once at startup then every hour
  installmentReminderCron();
  setInterval(installmentReminderCron, CRON_INTERVAL_MS);

  // -- Pending payment reminder (runs daily - reminds clients with pending > 3 days) --
  async function pendingPaymentReminderCron() {
    try {
      const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const [pendingRows] = await pool.query(
        `SELECT p.id, p.tenant_id, p.amount, p.currency, p.date, s.name, s.phone
         FROM payments p JOIN subscribers s ON s.id = p.subscriber_id AND s.tenant_id=p.tenant_id
         WHERE p.status = 'pending' AND p.date <= ? AND s.phone IS NOT NULL AND s.phone != ''
         LIMIT 50`,
        [threeDaysAgo]
      );
      for (const row of pendingRows) {
        const msg = `تذكير: مراجعة دفع معلق ${row.amount} ${row.currency || 'EGP'} بتاريخ ${String(row.date || '').slice(0,10)}. يرجى السداد في الموعد المحدد. - معهد الدراسات النفسية`;
        await sendWhatsApp(row.phone, msg, { tenantId: row.tenant_id });
        // Avoid WhatsApp spam - short delay between messages
        await new Promise(r => setTimeout(r, 2000));
      }
      if (pendingRows.length) {
        logger.info(`[Cron] pendingPaymentReminder: sent ${pendingRows.length} reminders`);
        const counts = pendingRows.reduce((map, row) => map.set(row.tenant_id, (map.get(row.tenant_id) || 0) + 1), new Map());
        for (const [tenantId, count] of counts) {
          await createNotification('reminder', 'مراجعة دفع معلق', `يوجد ${count} عمليات دفع تحتاج مراجعة`, { count }, tenantId);
        }
      }
    } catch (e) { logger.warn('[Cron] pendingPaymentReminderCron error:', e.message); }
  }
  // Run daily (24h interval), first run after 2 min startup delay
  setTimeout(() => {
    pendingPaymentReminderCron();
    setInterval(pendingPaymentReminderCron, 24 * 60 * 60 * 1000);
  }, 2 * 60 * 1000);

  // -- FX Rates auto-refresh (runs on startup + every 24h) ------------------
  async function refreshFxRatesAuto() {
    try {
      const response = await fetch('https://open.er-api.com/v6/latest/EGP', { signal: AbortSignal.timeout(8000) });
      if (!response.ok) return;
      const data = await response.json();
      if (!data.rates?.SAR || !data.rates?.USD) return;
      const sar_to_egp = parseFloat((1 / data.rates.SAR).toFixed(4));
      const usd_to_egp = parseFloat((1 / data.rates.USD).toFixed(4));
      const [tenants] = await pool.query("SELECT id FROM tenants WHERE status='active'");
      for (const tenant of tenants) {
        const existing = await getTenantSetting('content', { tenantId: tenant.id, fallback: {} });
        const merged = { ...existing, 'exchange.sar_to_egp': String(sar_to_egp), 'exchange.usd_to_egp': String(usd_to_egp) };
        await setTenantSetting('content', merged, { tenantId: tenant.id, actorId: 'fx-refresh' });
        invalidateFxCache(tenant.id);
      }
      cacheInvalidate('site_content');
      logger.info(`[FX] Auto-refreshed: SAR=${sar_to_egp}, USD=${usd_to_egp}`);
    } catch (e) { logger.warn('[FX] Auto-refresh failed:', e.message); }
  }
  // Run on startup (after 30s), then every 24h
  setTimeout(() => {
    refreshFxRatesAuto();
    setInterval(refreshFxRatesAuto, 24 * 60 * 60 * 1000);
  }, 30 * 1000);

  // -- Automation Engine: daily auto-run -------------------------------------
  // Runs all enabled workflows once per day automatically (no manual button needed).
  // First run is delayed 90s after startup to avoid DB load during boot.
  async function runAutomationEngine() {
    try {
      const [workflows] = await pool.query(
        `SELECT id, tenant_id, name, \`trigger\`, action, enabled, conditions_json AS conditions, action_config_json AS action_config,
         last_triggered_at, trigger_count, created_at
         FROM automation_workflows WHERE enabled = 1 ORDER BY created_at ASC`
      );
      if (!workflows.length) return;
      const todayStr = new Date().toISOString().slice(0, 10);
      let totalActions = 0;
      for (const wf of workflows) {
        const actionCfg = tryJson(wf.action_config, {});
        let matchedLeads = [];
        if (wf.trigger === 'no_contact_x_days') {
          const days = parseInt(actionCfg.days || '7');
          const [rows] = await pool.query(`SELECT l.id,l.name,l.phone,l.assigned_sales_name FROM leads l LEFT JOIN (SELECT lead_id,MAX(date) AS last_date FROM communications GROUP BY lead_id) c ON c.lead_id=l.id WHERE l.tenant_id=? AND l.hidden=0 AND l.status NOT IN ('converted','lost','not_interested','no_answer_nowa','wrong_number') AND DATEDIFF(NOW(),COALESCE(c.last_date,l.last_follow_up,l.created_at))>=?`, [wf.tenant_id, days]);
          matchedLeads = rows;
        } else if (wf.trigger === 'lead_score_threshold') {
          const threshold = parseInt(actionCfg.scoreThreshold || '70');
          const [rows] = await pool.query(`SELECT l.id,l.name,l.phone,l.assigned_sales_name,(CASE l.status WHEN 'interested_booking' THEN 100 WHEN 'interested_followup' THEN 80 WHEN 'interested' THEN 60 WHEN 'contacted' THEN 40 WHEN 'new' THEN 20 ELSE 10 END+CASE l.interest_level WHEN 'high' THEN 30 WHEN 'medium' THEN 15 ELSE 5 END) AS score FROM leads l WHERE l.tenant_id=? AND l.hidden=0 AND l.status NOT IN ('converted','lost') HAVING score>=?`, [wf.tenant_id, threshold]);
          matchedLeads = rows;
        } else if (wf.trigger === 'new_lead') {
          const sinceDays = parseInt(actionCfg.days || '1');
          const [rows] = await pool.query(`SELECT id,name,phone,assigned_sales_name FROM leads WHERE tenant_id=? AND hidden=0 AND status='new' AND created_at>=DATE_SUB(NOW(),INTERVAL ? DAY)`, [wf.tenant_id, sinceDays]);
          matchedLeads = rows;
        } else if (wf.trigger === 'subscription_expiring_soon') {
          const days = parseInt(actionCfg.days || '7');
          const [rows] = await pool.query(`SELECT s.id,s.name,s.email,s.phone,srh.expires_at FROM subscribers s LEFT JOIN subscriber_role_history srh ON srh.subscriber_id=s.id WHERE s.tenant_id=? AND s.status='active' AND srh.expires_at IS NOT NULL AND DATEDIFF(srh.expires_at,NOW()) BETWEEN 0 AND ? GROUP BY s.id`, [wf.tenant_id, days]);
          matchedLeads = rows;
        } else if (wf.trigger === 'subscriber_inactive_x_days') {
          const days = parseInt(actionCfg.days || '30');
          const [rows] = await pool.query(`SELECT s.id,s.name,s.email,s.phone,MAX(lp.completed_at) AS last_progress FROM subscribers s LEFT JOIN lecture_completions lp ON lp.subscriber_id=s.id AND lp.tenant_id=s.tenant_id WHERE s.tenant_id=? AND s.status='active' GROUP BY s.id HAVING last_progress IS NULL OR DATEDIFF(NOW(),last_progress)>=?`, [wf.tenant_id, days]);
          matchedLeads = rows;
        }
        let actionsRun = 0;
        for (const lead of matchedLeads) {
          if (wf.action === 'add_followup_reminder' && lead.id) {
            const newDate = new Date(); newDate.setDate(newDate.getDate() + parseInt(actionCfg.days || '3'));
            await pool.query('UPDATE leads SET next_follow_up_date=? WHERE id=? AND tenant_id=? AND (next_follow_up_date IS NULL OR next_follow_up_date<NOW())', [newDate.toISOString().slice(0,10), lead.id, wf.tenant_id]);
            await pool.query(
              `INSERT INTO lead_timeline (id,tenant_id,lead_id,event_type,description,meta_json,at) VALUES (?,?,?,'followup_set',?,?,NOW())`,
              [uuidv4(), wf.tenant_id, lead.id, `Automation scheduled follow-up for ${newDate.toISOString().slice(0,10)}`, JSON.stringify({ workflowId: wf.id, automation: true })]
            );
            actionsRun++;
          } else if (wf.action === 'update_lead_status' && actionCfg.status && lead.id) {
            await transitionLead({
              tenantId: wf.tenant_id, leadId: lead.id, toStatus: actionCfg.status,
              actor: 'scheduled-automation', reason: `Automation changed status to ${actionCfg.status}`,
              metadata: { workflowId: wf.id, automation: true },
            });
            actionsRun++;
          } else if (wf.action === 'add_note' && lead.id) {
            const msg = (actionCfg.message || '').replace(/\{\{name\}\}/g, lead.name||'').replace(/\{\{phone\}\}/g, lead.phone||'');
            if (msg) { await pool.query(`INSERT IGNORE INTO communications (id,lead_id,type,date,notes,outcome) VALUES (?,?,'note',?,?,'auto')`, [`auto-${Date.now()}-${Math.random().toString(36).slice(2,7)}`, lead.id, todayStr, `[أتمتة: ${wf.name}] ${msg}`]); actionsRun++; }
          } else if (wf.action === 'notify_admin') {
            try { await pool.query(`INSERT IGNORE INTO automation_log (id,tenant_id,workflow_id,lead_id,action,triggered_at) VALUES (?,?,?,?,?,NOW())`, [uuidv4(), wf.tenant_id, wf.id, lead.id||null, wf.action]); } catch(_){}
            actionsRun++;
          }
        }
        if (actionsRun > 0) {
          await pool.query('UPDATE automation_workflows SET trigger_count=trigger_count+?,last_triggered_at=? WHERE id=? AND tenant_id=?', [actionsRun, new Date().toISOString(), wf.id, wf.tenant_id]);
        }
        totalActions += actionsRun;
      }
      logger.info(`[auto-cron] Automation engine ran: ${workflows.length} workflows, ${totalActions} actions executed`);
    } catch (e) {
      logger.warn('[auto-cron] Automation engine error:', e.message);
    }
  }
  // First run delayed 90s after boot, then every 24 hours
  setTimeout(() => {
    runAutomationEngine();
    setInterval(runAutomationEngine, 24 * 60 * 60 * 1000);
  }, 90 * 1000);

  // -- Daqqi Session Reminders (24h + 2h before session) --------------------
  // Sends WhatsApp reminder to daqqi clients before their session.
  async function daqqiSessionReminderCron() {
    try {
      const now = new Date();
      // Find sessions starting in 23-25 hours (24h reminder window)
      const h24from = new Date(now.getTime() + 23 * 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');
      const h24to   = new Date(now.getTime() + 25 * 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');
      // Find sessions starting in 1h50m-2h10m (2h reminder window)
      const h2from  = new Date(now.getTime() + 110 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');
      const h2to    = new Date(now.getTime() + 130 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');

      for (const [wFrom, wTo, label] of [[h24from, h24to, '24 ساعة'], [h2from, h2to, 'قريبًا']]) {
        // daqqi_rounds with sessions in this window
        // round.start_date + current_lecture * 7 days - next session
        const [sessions] = await pool.query(`
          SELECT dr.code, dr.tenant_id, dr.day_of_week, dr.time_slot,
                 DATE_ADD(dr.start_date, INTERVAL (dr.current_lecture * 7) DAY) AS next_session,
                 da.subscriber_id, s.phone, s.name,
                 c.title AS course_title
          FROM daqqi_rounds dr
          JOIN daqqi_attendees da ON da.round_id = dr.id AND da.tenant_id=dr.tenant_id
          JOIN subscribers s ON s.id = da.subscriber_id AND s.tenant_id=dr.tenant_id
          JOIN courses c ON c.id = dr.course_id AND c.tenant_id=dr.tenant_id
          WHERE dr.status = 'ACTIVE'
            AND DATE_ADD(dr.start_date, INTERVAL (dr.current_lecture * 7) DAY) BETWEEN ? AND ?
        `, [wFrom, wTo]);

        let sent = 0;
        for (const row of sessions) {
          if (!row.phone) continue;
          const sessionDate = new Date(row.next_session).toLocaleDateString('ar-EG', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
          const timeLabel = row.time_slot === 'MORNING' ? 'الصباح' : row.time_slot === 'NOON' ? 'الظهر' : 'المساء';
          const msg = `مرحبًا ${row.name}
تذكير بموعد المحاضرة:
الكورس: ${row.course_title}
التاريخ: ${sessionDate}
الوقت: ${timeLabel}

في انتظارك!
- معهد الدراسات النفسية`;
          await sendWhatsApp(row.phone, msg, { tenantId: row.tenant_id }).catch(() => {});
          sent++;
        }
        if (sent) logger.info(`[Cron] daqqiReminder (${label}): sent ${sent} reminders`);
      }
    } catch (e) { logger.warn('[Cron] daqqiSessionReminderCron error:', e.message); }
  }
  // Run every hour
  setTimeout(() => {
    daqqiSessionReminderCron();
    setInterval(daqqiSessionReminderCron, 60 * 60 * 1000);
  }, 3 * 60 * 1000);

  // -- Lead Retargeting: auto-message unconverted leads after 30 days ---------
  async function leadRetargetingCron() {
    try {
      const [leads] = await pool.query(`
        SELECT l.id, l.tenant_id, l.name, l.phone, l.email
        FROM leads l
        WHERE l.hidden = 0
          AND l.status NOT IN ('converted','lost','not_interested','no_answer')
          AND (l.retargeting_sent_at IS NULL OR l.retargeting_sent_at < DATE_SUB(NOW(), INTERVAL 30 DAY))
          AND l.created_at < DATE_SUB(NOW(), INTERVAL 30 DAY)
          AND l.phone IS NOT NULL AND l.phone != ''
        LIMIT 50
      `);
      if (!leads.length) return;
      let sent = 0;
      for (const lead of leads) {
        const msg = `مرحبًا ${lead.name}
مرحبًا بك - فريق مهاد نفسي معك

يسعدنا نساعدك في اختيار البرنامج المناسب.
اكتب لنا أي سؤال وسنتابع معك خطوة بخطوة

مع تحيات فريق مهاد نفسي`;
        const res = await sendWhatsApp(lead.phone, msg, { tenantId: lead.tenant_id }).catch(() => ({ ok: false }));
        if (res.ok) {
          await pool.query(
            'UPDATE leads SET retargeting_sent_at=NOW() WHERE id=? AND tenant_id=?',
            [lead.id, lead.tenant_id]
          ).catch(() => {});
          await pool.query(
            `INSERT IGNORE INTO retargeting_log (id, lead_id, channel, template, status, sent_at)
             VALUES (UUID(), ?, 'WHATSAPP', 'reactivation_30d', 'SENT', NOW())`,
            [lead.id]
          ).catch(() => {});
          sent++;
        }
      }
      if (sent) logger.info(`[Cron] leadRetargeting: sent ${sent} reactivation messages`);
    } catch (e) { logger.warn('[Cron] leadRetargetingCron error:', e.message); }
  }
  // Run daily (first run after 5min)
  setTimeout(() => {
    leadRetargetingCron();
    setInterval(leadRetargetingCron, 24 * 60 * 60 * 1000);
  }, 5 * 60 * 1000);

  // -- Auto Daily Backup -----------------------------------------------------
  // Dumps MySQL DB to /tmp/backups and keeps last 7 days
  async function autoDailyBackup() {
    const { execSync, exec } = require('child_process');
    const fs = require('fs');
    const bkDir = '/tmp/mahad_backups';
    try {
      if (!fs.existsSync(bkDir)) fs.mkdirSync(bkDir, { recursive: true });
      const dbHost = process.env.DB_HOST || 'localhost';
      const dbUser = process.env.DB_USER || 'root';
      const dbPass = process.env.DB_PASS || '';
      const dbName = process.env.DB_NAME || '';
      if (!dbName) { logger.warn('[Backup] DB_NAME not set - skipping backup'); return; }
      const filename = `backup_${new Date().toISOString().slice(0,10)}.sql.gz`;
      const filepath = `${bkDir}/${filename}`;
      const cmd = `mysqldump -h${dbHost} -u${dbUser} -p'${dbPass}' --single-transaction --quick ${dbName} | gzip > ${filepath}`;
      execSync(cmd, { timeout: 120000, shell: '/bin/bash' });
      const size = fs.statSync(filepath).size;
      // Log to DB
      await pool.query(
        `INSERT IGNORE INTO backup_logs (id, filename, size_bytes, status) VALUES (UUID(), ?, ?, 'SUCCESS')`,
        [filename, size]
      ).catch(() => {});
      logger.info(`[Backup] Daily backup done: ${filename} (${Math.round(size/1024)}KB)`);
      // Cleanup backups older than 7 days
      exec(`find ${bkDir} -name 'backup_*.sql.gz' -mtime +7 -delete`, () => {});
    } catch (e) {
      logger.warn('[Backup] autoDailyBackup error:', e.message);
      await pool.query(
        `INSERT IGNORE INTO backup_logs (id, filename, size_bytes, status, error) VALUES (UUID(), 'backup_failed', 0, 'FAILED', ?)`,
        [e.message?.slice(0, 500) || 'unknown']
      ).catch(() => {});
    }
  }
  // Run once per day at 2am (first run after server start with 10min delay)
  setTimeout(() => {
    const now = new Date();
    const nextRun = new Date(now);
    nextRun.setHours(2, 0, 0, 0);
    if (nextRun <= now) nextRun.setDate(nextRun.getDate() + 1);
    const msToFirst = nextRun - now;
    setTimeout(() => {
      autoDailyBackup();
      setInterval(autoDailyBackup, 24 * 60 * 60 * 1000);
    }, msToFirst);
    logger.info(`[Backup] Scheduled daily backup at 02:00 (in ${Math.round(msToFirst / 60000)}min)`);
  }, 10 * 60 * 1000);

  // -- Waitlist Auto-Notify: when Daqqi round opens a spot ------------------
  // Checks every 30min if any waitlisted subscriber should be notified
  async function waitlistNotifyCron() {
    try {
      // Find courses where capacity > enrolled AND has waitlist entries with notify_sent=0
      const [waitlisted] = await pool.query(`
        SELECT cw.id, cw.tenant_id, cw.subscriber_id, cw.course_id, cw.position,
               s.name, s.phone, c.title AS course_title
        FROM course_waitlist cw
        JOIN subscribers s ON s.id = cw.subscriber_id AND s.tenant_id=cw.tenant_id
        JOIN courses c ON c.id = cw.course_id AND c.tenant_id=cw.tenant_id
        WHERE cw.notify_sent = 0
          AND cw.status = 'waiting'
          AND c.capacity IS NOT NULL
          AND (SELECT COUNT(*) FROM enrollments e WHERE e.course_id = cw.course_id AND e.tenant_id=cw.tenant_id) < c.capacity
        ORDER BY cw.position ASC
        LIMIT 20
      `).catch(() => [[]]);

      for (const w of waitlisted) {
        if (!w.phone) continue;
        const msg = `مرحبًا ${w.name}
تم فتح مقعد في الكورس:
${w.course_title}

يمكنك الحجز خلال 48 ساعة قبل أن ينتقل المقعد لعميل آخر
- معهد الدراسات النفسية`;
        await sendWhatsApp(w.phone, msg, { tenantId: w.tenant_id }).catch(() => {});
        await pool.query('UPDATE course_waitlist SET notify_sent=1, notified_at=NOW() WHERE id=? AND tenant_id=?', [w.id, w.tenant_id]).catch(() => {});
      }
      if (waitlisted.length) logger.info(`[Cron] waitlistNotify: notified ${waitlisted.length} subscribers`);
    } catch (e) { logger.warn('[Cron] waitlistNotifyCron error:', e.message); }
  }
  // Run every 30 minutes
  setTimeout(() => {
    waitlistNotifyCron();
    setInterval(waitlistNotifyCron, 30 * 60 * 1000);
  }, 7 * 60 * 1000);

  // -- Self-ping every 10-13 minutes (randomized) ----------------------------
  // Hostinger kills Node.js processes on :00/:30 boundaries via resource sweep.
  // Randomized interval avoids syncing with the scheduler's fixed cron times.
  function scheduleSelfPing() {
    const jitter = Math.floor(Math.random() * 3 * 60 * 1000); // 0-3 min random
    const interval = 10 * 60 * 1000 + jitter; // 10-13 minutes
    setTimeout(() => {
      const http = require('http');
      const req = http.get(`http://127.0.0.1:${PORT}/api/health`, { timeout: 5000 }, res => {
        res.resume();
      });
      req.on('error', () => {});
      req.end();
      scheduleSelfPing(); // schedule next ping with new random interval
    }, interval);
  }
  scheduleSelfPing();
}

module.exports = { startServerCronJobs };
