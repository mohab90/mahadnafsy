'use strict';
const logger = require('./logger');
const https = require('https');
const { pool } = require('./db');
const { appendLeadInteraction } = require('./leadInteractions');
const { matchCourseId } = require('./courseMatch');
const { toIdentity } = require('./phoneNumber');
const { createBatchAssigner } = require('./leadAssignment');
const { getNextClientCode } = require('./mappers');
const { getTenantSetting, setTenantSetting } = require('./tenantSettings');
const { DEFAULT_TENANT } = require('../middleware/tenantContext');

// Convenience seed sheets — offered as a starting point in the admin CRM settings
// UI ONLY. They are NEVER auto-synced on their own: autoSync is false here and the
// 15-min cron only runs sheets the admin has EXPLICITLY saved to crm_settings with
// autoSync enabled. (Historically these had autoSync:true and were force-merged into
// every sync, so ANY fresh/empty install silently began importing real customer
// leads from these hardcoded sheets on a timer with zero configuration — 2026-07-10.)
const DEFAULT_GSHEETS = [
  { sheetId: '1llDstW3cyvlSTgaHLaKQYiIHZ0dui9QwuszMWLvqNgA', gid: '1545487801', name: 'الشيت الرئيسي', autoSync: false },
  { sheetId: '1llDstW3cyvlSTgaHLaKQYiIHZ0dui9QwuszMWLvqNgA', gid: '1083686129', name: 'الصحة النفسية', autoSync: false, defaultCourse: 'الصحة النفسية' }
];

// Helper: check if response body looks like HTML (private sheet → redirected to login page)
function isHtmlResponse(text) {
  const t = text.trimStart().toLowerCase();
  return t.startsWith('<!doctype') || t.startsWith('<html') || t.startsWith('<?xml');
}

// Fetch CSV following 307/302 redirects (Google Sheets export returns 307 then CSV)
function fetchCsvFollowRedirects(url, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    const attempt = (u, remaining) => {
      let parsed;
      try { parsed = new URL(u); } catch (_) { return reject(new Error('INVALID_SHEET_URL')); }
      const allowedHost = parsed.hostname === 'docs.google.com' || parsed.hostname.endsWith('.googleusercontent.com');
      if (parsed.protocol !== 'https:' || !allowedHost) return reject(new Error('UNSAFE_SHEET_REDIRECT'));
      https.get(parsed, res => {
        if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location && remaining > 0) {
          res.resume();
          return attempt(new URL(res.headers.location, parsed).toString(), remaining - 1);
        }
        // Collect the bytes and decode once at the end.
        //
        // This read `d += c`, which calls toString() on each chunk on its own.
        // An Arabic letter is two bytes in UTF-8, so any letter that straddled a
        // chunk boundary lost both halves to U+FFFD: names arrived as
        // "دبلو��ة_المعالج" with the damage at a different position every run,
        // because the boundary lands wherever the socket happened to split.
        // Those rows then matched no course, and the corruption is still visible
        // in leads imported before this.
        const chunks = [];
        res.on('data', c => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      }).on('error', reject).setTimeout(20000, function () { this.destroy(new Error('TIMEOUT')); });
    };
    attempt(url, maxRedirects);
  });
}

async function syncAllConfiguredSheets(tenantId = DEFAULT_TENANT) {
  try {
    const settings = await getTenantSetting('crm_settings', { tenantId, fallback: {} });
    // Use only sheets explicitly stored for this tenant. Seed sheets are UI hints,
    // never implicit import sources.
    const sheets = Array.isArray(settings?.sheets) ? settings.sheets : [];
    const autoAssign = ['rr', 'least', 'none'].includes(settings?.autoAssign) ? settings.autoAssign : 'rr';
    let totalImported = 0, totalSkipped = 0;
    for (const sheet of sheets) {
      if (!/^[A-Za-z0-9_-]{20,120}$/.test(String(sheet.sheetId || ''))) continue;
      try {
        // Support multiple GIDs per sheet (comma-separated string or array)
        const rawGids = Array.isArray(sheet.gids) ? sheet.gids
          : (sheet.gid || '').split(',').map(g => g.trim()).filter(Boolean);
        if (rawGids.some((gid) => !/^\d{1,20}$/.test(String(gid)))) continue;
        // If no GIDs configured, sync the default tab (no gid param)
        const gidList = rawGids.length > 0 ? rawGids : [''];
        for (const gid of gidList) {
        const csvUrl = `https://docs.google.com/spreadsheets/d/${sheet.sheetId}/export?format=csv${gid ? `&gid=${gid}` : ''}`;
        const csvText = await fetchCsvFollowRedirects(csvUrl).catch(err => { logger.warn(`[gsheet-auto] fetch error for "${sheet.name}" gid=${gid||'default'}: ${err.message}`); return ''; });
        if (!csvText || isHtmlResponse(csvText)) {
          logger.warn(`[gsheet-auto] Sheet "${sheet.name}" (${sheet.sheetId}) is PRIVATE or unreachable — Fix: Google Sheets → Share → Anyone with link → Viewer`);
          continue;
        }
        const lines = csvText.split('\n').map(l => l.trim()).filter(Boolean);
        if (lines.length < 2) continue;
        // Parse CSV headers properly (handle quoted values)
        const parseRow = (line) => { const r=[]; let cur='',inQ=false; for(const c of line){if(c==='"'){inQ=!inQ;}else if(c===','&&!inQ){r.push(cur.trim());cur='';}else{cur+=c;}} r.push(cur.trim()); return r; };
        const headers = parseRow(lines[0]).map(h => h.replace(/^"|"$/g, '').trim().toLowerCase());
        const colIdx = (names) => { for (const n of names) { const i = headers.findIndex(h => h.includes(n)); if (i !== -1) return i; } return -1; };
        // Facebook Lead Ads column names
        const nameCol   = colIdx(['full_name','الاسم_الكامل','الاسم الكامل','name','الاسم','اسم']);
        const phoneCol  = colIdx(['phone_number','رقم_الهاتف','رقم الهاتف','phone','هاتف','تليفون','موبايل','mobile','tel','whatsapp']);
        const emailCol  = colIdx(['email','ايميل','إيميل','mail']);
        const sourceCol = colIdx(['source','مصدر','channel']);
        const notesCol  = colIdx(['notes','ملاحظات','note','comment','message','رسالة']);
        // FB custom questions: branch + course/diploma type
        // Broad detection: FB exports use question text as header — try many Arabic/English variations
        const branchCol = colIdx(['اختر_الفرع','اختر الفرع','branch','فرع','الفرع','فرعك','فرع الدراسة','المدينة','مكان الدراسة','موقع الفرع','location','city']);
        const courseCol = colIdx(['اختر_نوع','اختر نوع','دبلومة','دبلوم','الكورس','كورس','course','program','البرنامج','دورة','diploma','برنامج الدراسة','اختر البرنامج']);
        // If branchCol still not found, scan ALL headers for Arabic text containing 'فرع' clue
        const resolvedBranchCol = branchCol !== -1 ? branchCol : headers.findIndex(h => h.includes('فرع') || h.includes('branch') || h.includes('مدين') || h.includes('location'));
        logger.info(`[gsheet-auto] Sheet "${sheet.name}" gid=${gid||'default'} headers: ${JSON.stringify(headers.slice(0,12))} | branchCol=${resolvedBranchCol}`);
        const resolvedCourseCol = courseCol !== -1 ? courseCol : headers.findIndex(h => h.includes('كورس') || h.includes('دبلوم') || h.includes('برنامج') || h.includes('course'));

        if (isHtmlResponse(lines[0] + lines[1])) { logger.warn(`[gsheet-auto] Sheet "${sheet.name}" returned HTML — not public`); continue; }
        if (nameCol === -1 && phoneCol === -1) { logger.warn(`[gsheet-auto] Sheet "${sheet.name}" columns not recognized. Headers: ${JSON.stringify(headers.slice(0,8))}`); continue; }
        // Normalize branch string → DB ENUM value
        const normBranch = (v) => { if(!v)return null; const s=v.trim().toLowerCase().replace(/[\s_\-]/g,''); if(s.includes('دقي')||s.includes('daqqi')||s.includes('dokki'))return'DAQQI'; if(s.includes('تجمع')||s.includes('tagamoa')||s.includes('tagamo')||s.includes('قاهرةالجديدة')||s.includes('cairo')||s.includes('قاطميه')||s.includes('قاطميةs')||s.includes('qatat'))return'TAGAMOA'; if(s.includes('online')||s.includes('اونلاين')||s.includes('أونلاين')||s.includes('اونلاين')||s.includes('اون')){if(s.includes('سعودي')||s.includes('saudi'))return'ONLINE_SAUDI';if(s.includes('خارج')||s.includes('abroad'))return'ONLINE_ABROAD';return'ONLINE_EGYPT';} return s.length>=2?'OTHER':null; };
        // Load courses for fuzzy matching (use is_published not is_active)
        const [dbCourses] = await pool.execute('SELECT id, title FROM courses WHERE tenant_id=? AND is_published=1', [tenantId]);
        // Bundles are searched too: the sheets name a learning path as readily as a
        // single course, and a path is a perfectly good thing to want.
        const [dbBundles] = await pool.execute(
          'SELECT id, title FROM bundles WHERE tenant_id=? AND is_published=1 AND deleted_at IS NULL', [tenantId]);
        // Name-to-course matching lives in lib/courseMatch.js. It used to be
        // written out here and again, differently, in routes/gsheets.js, so the
        // automatic sync and the manual import disagreed about what a lead wanted.
        const findCourseId = (raw) => matchCourseId(raw, dbCourses, dbBundles);
        // One picker for the whole run. It loads the roster, the open-lead
        // counts and each rep's intake for the current period once, then hands
        // out in memory — the copy that used to live here re-queried the load
        // for every single row, and honoured neither cap.
        const assigner = await createBatchAssigner(tenantId, pool);
        // Pre-load existing phones AND names for fast dedup
        const [existingPh] = await pool.execute('SELECT phone, name FROM leads WHERE tenant_id=? AND hidden=0', [tenantId]);
        // Compared as identities, not as text. The same person arrives as
        // "p:+201227155562" from Facebook and as "1227155562" from an older
        // sheet; matching the strings treats them as two people.
        const phSet   = new Set(existingPh.map(r=>toIdentity(r.phone)).filter(Boolean));
        const nameSet = new Set(existingPh.map(r=>(r.name||'').trim().toLowerCase()).filter(Boolean));
        const dataLines = lines.slice(1);
        for (let i = 0; i < dataLines.length; i++) {
          const row = parseRow(dataLines[i]).map(v => v.replace(/^"|"$/g,'').trim());
          const rawName   = nameCol   !== -1 ? (row[nameCol]  ||'').trim() : '';
          const phone     = phoneCol  !== -1 ? (row[phoneCol] ||'').trim().replace(/[\s-]/g,'') : '';
          const email     = emailCol  !== -1 ? (row[emailCol] ||'').trim() : '';
          const source    = sourceCol !== -1 ? (row[sourceCol]||'').trim() : (sheet.name || 'Google Sheet');
          const rawNotes  = notesCol  !== -1 ? (row[notesCol] ||'').trim() : '';
          const rawBranch = resolvedBranchCol !== -1 ? (row[resolvedBranchCol]||'').trim() : '';
          const rawCourse = resolvedCourseCol !== -1 ? (row[resolvedCourseCol]||'').trim() : '';
          // Detect when name column actually contains a course/option key (FB option values use underscores + Arabic)
          // Skip rows where both name and phone are empty (header-only rows, blank lines)
          if (!rawName.trim() && !phone.trim()) { totalSkipped++; continue; }
          const isLikelyCourse = rawName.includes('_') && (/[\u0621-\u064a]/.test(rawName) || rawName.length > 30);
          const name = (!rawName || isLikelyCourse) ? (phone || rawName || `lead-${i}`) : rawName;
          const normPhone = toIdentity(phone);
          if (normPhone && phSet.has(normPhone)) { totalSkipped++; continue; }
          // If no phone, dedup by exact name match (prevents re-importing on server restart)
          if (!normPhone && name && nameSet.has(name.toLowerCase())) { totalSkipped++; continue; }
          if (normPhone) phSet.add(normPhone);
          if (!normPhone && name) nameSet.add(name.toLowerCase());
          const branch   = normBranch(rawBranch);
          const courseId = findCourseId(rawCourse || (isLikelyCourse ? rawName : '')) || findCourseId(sheet.defaultCourse);
          const matchedCourseTitle = courseId ? dbCourses.find(c => c.id === courseId)?.title : null;
          const noteParts = [];
          if (rawBranch) noteParts.push(`الفرع: ${rawBranch}`);
          if (rawCourse || (isLikelyCourse && rawName)) noteParts.push(`الكورس: ${matchedCourseTitle || rawCourse || rawName}`);
          if (rawNotes)  noteParts.push(rawNotes);
          const notes = noteParts.join(' | ') || null;
          // What a person actually wrote, as opposed to the branch and course
          // labels around it. Only this belongs in the contact history.
          const humanNote = rawNotes ? String(rawNotes).trim() : null;
          let salesId = null, salesName = null;
          if (autoAssign !== 'none') {
            // null means every rep is at a cap. The lead stays unassigned
            // rather than pushing someone past a limit the owner set.
            const rep = assigner.next();
            if (rep) { salesId = rep.id; salesName = rep.name; }
          }
          let code = null;
          try { const conn2 = await pool.getConnection(); try { code = await getNextClientCode(conn2); } finally { conn2.release(); } } catch(_){}
          const crmJson = JSON.stringify({ assignedSalesId: salesId, assignedSalesName: salesName, interestedCourseIds: courseId ? [courseId] : [], rawBranch: rawBranch || null });
          const leadId = `lead-gs-${Date.now()}-${i}`;
          const [insertResult] = await pool.execute(
            `INSERT IGNORE INTO leads (id, tenant_id, client_code, name, email, phone, source, status, notes, branch, interested_course_ids_json, assigned_sales_id, assigned_sales_name, assigned_at, crm_json, hidden, created_at) VALUES (?,?,?,?,?,?,?,'new',?,?,?,?,?,CASE WHEN ? IS NULL THEN NULL ELSE NOW() END,?,0,NOW())`,
            [leadId, tenantId, code, name, email||'', normPhone||phone||null, source||'Facebook Lead Ads', notes, branch||null, courseId ? JSON.stringify([courseId]) : null, salesId, salesName, salesId, crmJson]
          );
          if (!insertResult.affectedRows) { totalSkipped++; continue; }
          // A timeline entry only when a person wrote something.
          //
          // This used to fire for every imported lead, because `notes` also
          // carried the branch and course labels. That put a NOTE in the
          // history of leads nobody had contacted — and since
          // appendLeadInteraction also stamps last_follow_up and
          // last_contact_note, it marked them as followed up on import day.
          // One sync in August did that to 8,663 leads, which was 65% of
          // every last-follow-up record in the CRM. The branch and course are
          // already on the lead, in leads.branch, leads.notes and
          // interested_course_ids_json; none of it was ever contact.
          if (humanNote) {
            await appendLeadInteraction({
              tenantId,
              leadId,
              interaction: { type: 'note', notes: humanNote },
              actor: { name: 'google-sheets-sync' },
            });
          }
          totalImported++;
        }
        // Rotation lives on the policy rows now, not in a single shared index,
        // so it survives a rep being added or removed mid-run.
        await assigner.flush();
        const shared = assigner.summary();
        if (shared.length) {
          logger.info('[gsheet-sync-all] assigned', {
            sheet: sheet.name || sheet.sheetId,
            distribution: shared.map(rep => `${rep.name}:${rep.given}`).join(', '),
          });
        }
        } // end gidList loop
      } catch(sheetErr) { logger.error('[gsheet-sync-all] sheet error:', sheetErr.message); }
    }
    return { imported: totalImported, skipped: totalSkipped };
  } catch(e) { logger.error('[gsheet-sync-all]', e.message); return { imported: 0, skipped: 0 }; }
}

module.exports = { DEFAULT_GSHEETS, isHtmlResponse, fetchCsvFollowRedirects, syncAllConfiguredSheets };
