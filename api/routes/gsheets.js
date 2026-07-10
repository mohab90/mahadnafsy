'use strict';
const logger = require('../lib/logger');
const express = require('express');
const { uuidv4 } = require('../lib/id');
const router  = express.Router();

const { pool } = require('../lib/db');
const { getNextClientCode } = require('../lib/mappers');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { isHtmlResponse, fetchCsvFollowRedirects, syncAllConfiguredSheets } = require('../lib/sheets');

// POST /api/admin/leads/gsheet-test — test if a sheet is accessible and return column headers
router.post('/api/admin/leads/gsheet-test', requireAuth, requireAdmin, async (req, res) => {
  const { sheetId, gid } = req.body || {};
  if (!sheetId) return res.status(400).json({ error: 'sheetId is required' });
  try {
    const csvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv${gid ? `&gid=${gid}` : ''}`;
    const csvText = await fetchCsvFollowRedirects(csvUrl).catch(e => { throw new Error(e.message); });
    if (isHtmlResponse(csvText)) {
      return res.json({
        ok: false, accessible: false,
        reason: 'sheet_private',
        hint: 'الشيت غير منشور للعموم — اضغط "مشاركة" في Google Sheets ثم اختر "أي شخص لديه الرابط" بصلاحية القراءة فقط',
      });
    }
    const lines = csvText.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length === 0) return res.json({ ok: true, accessible: true, rows: 0, headers: [], hint: 'الشيت فارغ' });
    const headers = lines[0].split(',').map(h => h.replace(/^"|"$/g, '').trim());
    res.json({ ok: true, accessible: true, rows: lines.length - 1, headers, hint: lines.length > 1 ? `يحتوي على ${lines.length - 1} صف` : 'لا توجد بيانات بعد الهيدر' });
  } catch (e) { res.status(500).json({ ok: false, accessible: false, reason: 'Internal server error' }); }
});

// POST /api/admin/leads/gsheet-sync
// body: { sheetId, gid, autoAssign: 'rr'|'least'|'none' }
router.post('/api/admin/leads/gsheet-sync', requireAuth, requireAdmin, async (req, res) => {
  const { sheetId, gid, autoAssign = 'rr' } = req.body || {};
  if (!sheetId) return res.status(400).json({ error: 'sheetId is required' });
  try {
    // Fetch CSV export from Google Sheets (follows 307 redirect)
    const csvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv${gid ? `&gid=${gid}` : ''}`;
    const csvText = await fetchCsvFollowRedirects(csvUrl);
    if (isHtmlResponse(csvText)) {
      return res.status(403).json({ error: 'الشيت غير منشور للعموم — اضغط "مشاركة" في Google Sheets وغيّر الصلاحية لـ "أي شخص لديه الرابط" - قراءة فقط' });
    }

    // Parse CSV
    const lines = csvText.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length < 2) return res.json({ ok: true, imported: 0, skipped: 0, message: 'الشيت فارغ' });
    const headers = lines[0].split(',').map(h => h.replace(/^"|"$/g, '').trim().toLowerCase());

    // Map common column names to our fields — flexible matching (includes Facebook Lead Ads field names)
    const colIdx = (names) => {
      for (const n of names) {
        const i = headers.findIndex(h => h.includes(n));
        if (i !== -1) return i;
      }
      return -1;
    };
    // Facebook Lead Ads uses: 'full_name', 'phone_number', 'email', 'رقم_الهاتف', 'الاسم_الكامل'
    const nameCol  = colIdx(['full_name','الاسم_الكامل','الاسم الكامل','name','الاسم','اسم']);
    const phoneCol = colIdx(['phone_number','رقم_الهاتف','رقم الهاتف','phone','هاتف','تليفون','موبايل','mobile','tel','whatsapp']);
    const emailCol = colIdx(['email','ايميل','إيميل','mail']);
    const sourceCol= colIdx(['source','مصدر','channel']);
    const notesCol = colIdx(['notes','ملاحظات','note','comment','message','رسالة']);
    const courseCol= colIdx(['course','الكورس','كورس','program','البرنامج','دورة','الدورة']);

    if (nameCol === -1 && phoneCol === -1) {
      return res.status(400).json({ error: 'لم يتم العثور على عمود الاسم أو الهاتف في الشيت. تأكد أن الشيت مشترك للعموم.' });
    }

    // Load courses for name→id matching
    const [dbCourses] = await pool.execute('SELECT id, title FROM courses WHERE is_active=1');
    const findCourseId = (courseName) => {
      if (!courseName) return null;
      const norm = courseName.trim().toLowerCase();
      const exact = dbCourses.find(c => c.title.toLowerCase() === norm);
      if (exact) return exact.id;
      const fuzzy = dbCourses.find(c => c.title.toLowerCase().includes(norm) || norm.includes(c.title.toLowerCase().slice(0, 6)));
      return fuzzy ? fuzzy.id : null;
    };

    // Get sales reps for auto-assign
    const [reps] = await pool.execute(
      `SELECT id, name FROM staff WHERE role IN ('SALES','MANAGER','COLLECTION') AND is_active=1 ORDER BY name ASC`
    );
    // RR index stored in site_config
    let rrRaw = 0;
    if (autoAssign === 'rr' && reps.length > 0) {
      const [rrRows] = await pool.query("SELECT `value` FROM site_config WHERE `key`='crm_rr_index'");
      rrRaw = parseInt(rrRows[0]?.value || '0') || 0;
    }

    let imported = 0, skipped = 0;
    const dataLines = lines.slice(1);
    for (let i = 0; i < dataLines.length; i++) {
      // Parse CSV row (handle quoted fields)
      const row = dataLines[i].match(/(".*?"|[^,]+|(?<=,)(?=,)|(?<=,)$|^(?=,))/g)
        ?.map(v => v.replace(/^"|"$/g, '').trim()) ?? dataLines[i].split(',').map(v => v.trim());
      const name  = nameCol  !== -1 ? (row[nameCol]  || '').trim() : '';
      const phone = phoneCol !== -1 ? (row[phoneCol] || '').trim() : '';
      const email = emailCol !== -1 ? (row[emailCol] || '').trim() : '';
      const source= sourceCol!== -1 ? (row[sourceCol]|| '').trim() : 'Google Sheet';
      const notes = notesCol !== -1 ? (row[notesCol] || '').trim() : '';
      const courseNameRaw = courseCol !== -1 ? (row[courseCol] || '').trim() : '';
      const courseId = findCourseId(courseNameRaw);
      if (!name && !phone) { skipped++; continue; }

      // Skip if phone already exists in leads
      if (phone) {
        const [dup] = await pool.execute('SELECT id FROM leads WHERE phone=? AND hidden=0 LIMIT 1', [phone]);
        if (dup.length) { skipped++; continue; }
      }

      // Pick sales rep
      let salesId = null, salesName = null;
      if (reps.length > 0) {
        if (autoAssign === 'rr') {
          const rep = reps[rrRaw % reps.length];
          salesId = rep.id; salesName = rep.name;
          rrRaw++;
        } else if (autoAssign === 'least') {
          const [counts] = await pool.execute(
            `SELECT assigned_sales_id, COUNT(*) as cnt FROM leads WHERE hidden=0 AND assigned_sales_id IS NOT NULL GROUP BY assigned_sales_id`
          );
          const cm = {}; for (const c of counts) cm[c.assigned_sales_id] = Number(c.cnt);
          const sorted = [...reps].sort((a, b) => (cm[a.id] || 0) - (cm[b.id] || 0));
          salesId = sorted[0].id; salesName = sorted[0].name;
        }
      }

      // Get sequential client code
      let code = null;
      try {
        const conn2 = await pool.getConnection();
        try { code = await getNextClientCode(conn2); } finally { conn2.release(); }
      } catch (_) {}

      const crmJson = JSON.stringify({
        assignedSalesId: salesId,
        assignedSalesName: salesName,
        interestedCourseIds: courseId ? [courseId] : [],
        ...(courseNameRaw && !courseId ? { courseNameRaw } : {}),
      });
      const leadId = `lead-gs-${Date.now()}-${i}`;
      await pool.execute(
        `INSERT IGNORE INTO leads (id, client_code, name, email, phone, source, status, notes, assigned_sales_id, assigned_sales_name, crm_json, hidden, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'new', ?, ?, ?, ?, 0, NOW())`,
        [leadId, code, name || phone, email || '', phone || '', source || 'Google Sheet', notes || null, salesId, salesName, crmJson]
      );
      imported++;
    }

    // Persist updated RR index
    if (autoAssign === 'rr' && reps.length > 0) {
      await pool.query(
        "INSERT INTO site_config (`key`,`value`) VALUES ('crm_rr_index',?) ON DUPLICATE KEY UPDATE `value`=VALUES(`value`)",
        [String(rrRaw)]
      );
    }

    res.json({ ok: true, imported, skipped, total: dataLines.length });
  } catch (e) {
    logger.error('[gsheet-sync]', e.message);
    logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/admin/leads/gsheet-sync-all  — syncs all sheets from CRM settings
router.post('/api/admin/leads/gsheet-sync-all', requireAuth, requireAdmin, async (req, res) => {
  try {
    const result = await syncAllConfiguredSheets();
    res.json({ ok: true, ...result });
  } catch(e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// Auto-sync cron: every 15 minutes, sync sheets the ADMIN has explicitly enabled.
// Auto-import is OPT-IN: it runs ONLY when crm_settings.sheets (saved from the admin
// CRM settings UI) contains a sheet with autoSync:true. It intentionally does NOT
// look at the hardcoded DEFAULT_GSHEETS — those are a manual-sync convenience seed,
// never an automatic importer. A fresh/empty install therefore never auto-imports
// anything until the admin deliberately configures and enables a sheet.
// (Guarded root cause of the 2026-07-10 incident where an empty test box silently
//  pulled 10k+ real customer leads from the hardcoded sheets on a timer.)
let _gsheetAutoRunning = false;
setInterval(async () => {
  if (_gsheetAutoRunning) return;
  _gsheetAutoRunning = true;
  try {
    const [cfgRows] = await pool.query("SELECT `value` FROM site_config WHERE `key`='crm_settings'");
    const settings = cfgRows[0]?.value ? JSON.parse(cfgRows[0].value) : {};
    const sheets = Array.isArray(settings.sheets) ? settings.sheets : [];
    if (sheets.some(s => s.autoSync)) {
      const r = await syncAllConfiguredSheets();
      if (r.imported > 0) logger.info(`[gsheet-auto] imported ${r.imported} leads from admin-configured sheets`);
    }
  } catch(e) { logger.error('[gsheet-auto]', e.message); }
  finally { _gsheetAutoRunning = false; }
}, 15 * 60 * 1000);

module.exports = router;
