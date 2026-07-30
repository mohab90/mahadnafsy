'use strict';
const logger = require('./logger');
const https = require('https');
const { pool } = require('./db');
const { appendLeadInteraction } = require('./leadInteractions');
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
        let d = '';
        res.on('data', c => d += c);
        res.on('end', () => resolve(d));
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
        const normStr = (s) => s.toLowerCase().replace(/[\u064B-\u065F]/g,'').replace(/\s+/g,' ').trim();
        const findCourseId = (raw) => {
          if(!raw) return null;
          const n = normStr(raw);
          if(!n) return null;
          let found = dbCourses.find(c => normStr(c.title) === n);
          if(found) return found.id;
          found = dbCourses.find(c => { const ct=normStr(c.title); return ct.includes(n)||(n.length>=4&&n.includes(ct.substring(0,Math.min(ct.length,6)))); });
          if(found) return found.id;
          // Word-overlap fallback — require overlap across a MEANINGFUL FRACTION of the
          // query's words, not just a fixed count of 2. A flat ">=2" let long, word-rich
          // titles (e.g. "دبلومة اضطراب طيف التوحد والتدخل المبكر") absorb unrelated rows
          // that only coincidentally shared 2 generic words like "دبلومة" — this was
          // silently mis-tagging Google Sheets leads with the wrong course.
          const qw = n.split(/\s+/).filter(w=>w.length>2);
          let bestId=null,bestScore=0;
          for(const c of dbCourses){ const ctw=normStr(c.title).split(/\s+/).filter(w=>w.length>2); const ov=qw.filter(w=>ctw.some(cw=>cw.includes(w)||w.includes(cw))).length; if(ov>bestScore){bestScore=ov;bestId=c.id;} }
          const minOverlap = Math.max(2, Math.ceil(qw.length * 0.5));
          return bestScore>=minOverlap?bestId:null;
        };
        const [reps] = await pool.execute(
          `SELECT id, name FROM staff WHERE tenant_id=? AND role='SALES' AND is_active=1 AND deleted_at IS NULL ORDER BY name ASC`,
          [tenantId]
        );
        let rrRaw = 0;
        if (autoAssign === 'rr' && reps.length > 0) {
          rrRaw = parseInt(await getTenantSetting('crm_rr_index', { tenantId, fallback: 0 }), 10) || 0;
        }
        // Pre-load existing phones AND names for fast dedup
        const [existingPh] = await pool.execute('SELECT phone, name FROM leads WHERE tenant_id=? AND hidden=0', [tenantId]);
        const phSet   = new Set(existingPh.map(r=>(r.phone||'').replace(/[\s-]/g,'')).filter(Boolean));
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
          const normPhone = phone.replace(/[\s-]/g,'');
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
          let salesId = null, salesName = null;
          if (reps.length > 0) {
            if (autoAssign === 'rr') { const rep = reps[rrRaw % reps.length]; salesId = rep.id; salesName = rep.name; rrRaw++; }
            else if (autoAssign === 'least') { const [counts] = await pool.execute(`SELECT assigned_sales_id, COUNT(*) as cnt FROM leads WHERE tenant_id=? AND hidden=0 AND assigned_sales_id IS NOT NULL GROUP BY assigned_sales_id`, [tenantId]); const cm = {}; for (const c of counts) cm[c.assigned_sales_id]=Number(c.cnt); const sorted=[...reps].sort((a,b)=>(cm[a.id]||0)-(cm[b.id]||0)); salesId=sorted[0].id; salesName=sorted[0].name; }
          }
          let code = null;
          try { const conn2 = await pool.getConnection(); try { code = await getNextClientCode(conn2); } finally { conn2.release(); } } catch(_){}
          const crmJson = JSON.stringify({ assignedSalesId: salesId, assignedSalesName: salesName, interestedCourseIds: courseId ? [courseId] : [], rawBranch: rawBranch || null });
          const leadId = `lead-gs-${Date.now()}-${i}`;
          const [insertResult] = await pool.execute(
            `INSERT IGNORE INTO leads (id, tenant_id, client_code, name, email, phone, source, status, notes, branch, interested_course_ids_json, assigned_sales_id, assigned_sales_name, crm_json, hidden, created_at) VALUES (?,?,?,?,?,?,?,'new',?,?,?,?,?,?,0,NOW())`,
            [leadId, tenantId, code, name, email||'', phone||'', source||'Facebook Lead Ads', notes, branch||null, courseId ? JSON.stringify([courseId]) : null, salesId, salesName, crmJson]
          );
          if (!insertResult.affectedRows) { totalSkipped++; continue; }
          // Insert notes as a communication record so it appears in the lead timeline
          if (notes) {
            await appendLeadInteraction({
              tenantId,
              leadId,
              interaction: { type: 'note', notes },
              actor: { name: 'google-sheets-sync' },
            });
          }
          totalImported++;
        }
        if (autoAssign === 'rr' && reps.length > 0) {
          await setTenantSetting('crm_rr_index', rrRaw, { tenantId });
        }
        } // end gidList loop
      } catch(sheetErr) { logger.error('[gsheet-sync-all] sheet error:', sheetErr.message); }
    }
    return { imported: totalImported, skipped: totalSkipped };
  } catch(e) { logger.error('[gsheet-sync-all]', e.message); return { imported: 0, skipped: 0 }; }
}

module.exports = { DEFAULT_GSHEETS, isHtmlResponse, fetchCsvFollowRedirects, syncAllConfiguredSheets };
