'use strict';
const logger = require('../lib/logger');
const express = require('express');
const { uuidv4 } = require('../lib/id');
const router  = express.Router();

const { pool } = require('../lib/db');
const { getNextClientCode } = require('../lib/mappers');
const { getTenantSetting, setTenantSetting } = require('../lib/tenantSettings');
const { requireAuth, requireAdmin, requirePermission } = require('../middleware/auth');
const { isHtmlResponse, fetchCsvFollowRedirects, syncAllConfiguredSheets } = require('../lib/sheets');
const { matchCourseId } = require('../lib/courseMatch');
const { createRepRotation, listDistributableReps } = require('../lib/leadAssignment');
const { toIdentity } = require('../lib/phoneNumber');

const validSheetId = (value) => /^[A-Za-z0-9_-]{20,120}$/.test(String(value || ''));
const validGid = (value) => value == null || value === '' || /^\d{1,20}$/.test(String(value));

// POST /api/admin/leads/gsheet-test — test if a sheet is accessible and return column headers
router.post('/api/admin/leads/gsheet-test', requireAuth, requireAdmin, requirePermission('manage_leads'), async (req, res) => {
  const { sheetId, gid } = req.body || {};
  if (!validSheetId(sheetId) || !validGid(gid)) return res.status(400).json({ error: 'Invalid sheetId or gid' });
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
router.post('/api/admin/leads/gsheet-sync', requireAuth, requireAdmin, requirePermission('manage_leads'), async (req, res) => {
  const { sheetId, gid, autoAssign = 'rr' } = req.body || {};
  if (!validSheetId(sheetId) || !validGid(gid)) return res.status(400).json({ error: 'Invalid sheetId or gid' });
  if (!['rr', 'least', 'none'].includes(autoAssign)) return res.status(400).json({ error: 'Invalid autoAssign mode' });
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
    // courses has no is_active column — it has is_published. This threw on every
    // run, so the manual import answered 500 before reading a single row. The
    // automatic sync in lib/sheets.js had it right; only this copy did not.
    const [dbCourses] = await pool.execute(
      'SELECT id, title FROM courses WHERE tenant_id=? AND is_published=1 AND deleted_at IS NULL', [req.tenantId]);
    // Bundles are searched too — see lib/courseMatch.js.
    const [dbBundles] = await pool.execute(
      'SELECT id, title FROM bundles WHERE tenant_id=? AND is_published=1 AND deleted_at IS NULL', [req.tenantId]);
    // Shared with the automatic sync — see lib/courseMatch.js. The copy that
    // stood here matched on lowercase substrings only, so it missed every name
    // the sheets write with underscores instead of spaces.
    const findCourseId = (courseName) => matchCourseId(courseName, dbCourses, dbBundles);

    // Only reps switched on in the CRM "التوزيع" screen (lib/leadAssignment.js).
    const reps = autoAssign === 'none' ? [] : await listDistributableReps(req.tenantId);
    const rrStart = autoAssign === 'rr' && reps.length > 0
      ? parseInt(await getTenantSetting('crm_rr_index', { tenantId: req.tenantId, fallback: 0 }), 10) || 0
      : 0;
    const rotation = createRepRotation(reps, { mode: autoAssign, start: rrStart });
    // Deleted (hidden) and merged leads count as already imported, or every
    // lead an admin deletes comes straight back on the next sync.
    const [existing] = await pool.execute('SELECT phone FROM leads WHERE tenant_id=?', [req.tenantId]);
    const knownPhones = new Set(existing.map(row => toIdentity(row.phone)).filter(Boolean));

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

      // Normalised once: used both to find an existing lead and to store the
      // number, so the unique index sees one spelling per person. Matched on
      // identity — "p:+201227155562" and "1227155562" are one person, and
      // comparing the text imported the same lead twice.
      const identity = toIdentity(phone);

      // A row with no phone is stored with phone NULL, not ''. As '' it collided
      // with the one blank already in leads and INSERT IGNORE dropped it in
      // silence. Those dedupe by name instead, the way lib/sheets.js does — and
      // against every lead, deleted ones included, or a blank-phone row an admin
      // removed is re-imported on the next run.
      if (!phone && name) {
        const [dupName] = await pool.execute(
          "SELECT id FROM leads WHERE tenant_id=? AND (phone IS NULL OR phone='') AND LOWER(TRIM(name))=LOWER(?) LIMIT 1",
          [req.tenantId, name]);
        if (dupName.length) { skipped++; continue; }
      }

      if (phone) {
        if (identity && knownPhones.has(identity)) { skipped++; continue; }
        if (identity) knownPhones.add(identity);
      }

      const rep = rotation.next();
      const salesId = rep?.id || null, salesName = rep?.name || null;

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
      const [insertResult] = await pool.execute(
        `INSERT IGNORE INTO leads (id, tenant_id, client_code, name, email, phone, source, status, notes, assigned_sales_id, assigned_sales_name, crm_json, hidden, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'new', ?, ?, ?, ?, 0, NOW())`,
        // A blank name stays blank rather than becoming the phone number.
        //
        // `name || phone` put the number in the name column, and it reaches the
        // screen as the customer's name: production carries rows literally
        // called "1096203090". The phone is already stored in its own column
        // one argument along, so this was never adding information — it was
        // only making a missing name look like a filled-in one, which is worse,
        // because nobody goes looking for a name that appears to be there.
        [leadId, req.tenantId, code, name || null, email || '', identity || phone || null, source || 'Google Sheet', notes || null, salesId, salesName, crmJson]
      );
      if (insertResult.affectedRows) imported++; else skipped++;
    }

    // Persist updated RR index
    if (autoAssign === 'rr' && reps.length > 0) {
      await setTenantSetting('crm_rr_index', rotation.index, {
        tenantId: req.tenantId,
        actorId: req.user?.uid || req.user?.email || null,
      });
    }

    res.json({ ok: true, imported, skipped, total: dataLines.length });
  } catch (e) {
    logger.error('[gsheet-sync]', e.message);
    logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/admin/leads/gsheet-sync-all  — syncs all sheets from CRM settings
router.post('/api/admin/leads/gsheet-sync-all', requireAuth, requireAdmin, requirePermission('manage_leads'), async (req, res) => {
  try {
    const result = await syncAllConfiguredSheets(req.tenantId);
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
    const [tenants] = await pool.query("SELECT id FROM tenants WHERE status='active'").catch(() => [[{ id: 'tenant-default' }]]);
    for (const { id: tenantId } of tenants) {
      const settings = await getTenantSetting('crm_settings', { tenantId, fallback: {} });
      const sheets = Array.isArray(settings?.sheets) ? settings.sheets : [];
      if (sheets.some(s => s.autoSync)) {
        const r = await syncAllConfiguredSheets(tenantId);
        if (r.imported > 0) logger.info(`[gsheet-auto] tenant=${tenantId} imported ${r.imported} leads`);
      }
    }
  } catch(e) { logger.error('[gsheet-auto]', e.message); }
  finally { _gsheetAutoRunning = false; }
}, 15 * 60 * 1000);

module.exports = router;
