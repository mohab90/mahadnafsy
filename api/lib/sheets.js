'use strict';
const logger = require('./logger');
const https = require('https');
const { pool } = require('./db');
const { appendLeadInteraction } = require('./leadInteractions');
const { matchCourseId } = require('./courseMatch');
const { toIdentity } = require('./phoneNumber');
const { createBatchAssigner } = require('./leadAssignment');
const { getNextClientCode } = require('./mappers');
const { getTenantSetting } = require('./tenantSettings');
const { DEFAULT_TENANT } = require('../middleware/tenantContext');
const { parseCsv } = require('./csv');

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

// Rows dated further back than this are not imported by the automatic sync.
// The sheets keep every row they ever received, and the sync used to read
// them with a line-by-line split that broke on any answer containing a line
// break — so a fixed reader would otherwise turn months of rows that never made
// it in into "new" leads for the reps overnight. Recent rows are the ones a
// rep can still act on; an older one is for tools/sheets-backfill.cjs to
// report and someone to decide on. Undated rows are always read.
const DEFAULT_IMPORT_WINDOW_DAYS = 14;

const DATE_HEADINGS = ['created_time', 'timestamp', 'تاريخ', 'التاريخ', 'الوقت', 'date', 'time'];

/**
 * When a sheet row arrived, or null when the cell is empty or ambiguous.
 * ISO (Facebook's created_time) is exact. A slashed date is read only when the
 * day and month cannot be confused (one of them above 12); 3/9 could be either,
 * and an undated row is imported rather than wrongly left out.
 */
function rowDate(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) {
    const date = new Date(text.replace(' ', 'T'));
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const slashed = text.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (!slashed) return null;
  const [, first, second, year, hour = '0', minute = '0', sec = '0'] = slashed;
  let month; let day;
  if (Number(first) > 12 && Number(second) <= 12) { day = first; month = second; }
  else if (Number(second) > 12 && Number(first) <= 12) { month = first; day = second; }
  else if (first === second) { month = first; day = second; }
  else return null;
  const date = new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(sec));
  return Number.isNaN(date.getTime()) ? null : date;
}

/** One tab of a linked sheet, read into lead fields. */
async function readSheetTab(sheet, gid, fetchCsv = fetchCsvFollowRedirects) {
  const csvUrl = `https://docs.google.com/spreadsheets/d/${sheet.sheetId}/export?format=csv${gid ? `&gid=${gid}` : ''}`;
  const csvText = await fetchCsv(csvUrl).catch(err => {
    logger.warn(`[gsheet-auto] fetch error for "${sheet.name}" gid=${gid || 'default'}: ${err.message}`);
    return '';
  });
  if (!csvText || isHtmlResponse(csvText)) {
    logger.warn(`[gsheet-auto] Sheet "${sheet.name}" (${sheet.sheetId}) is PRIVATE or unreachable — Fix: Google Sheets → Share → Anyone with link → Viewer`);
    return { error: 'unreachable', rows: [] };
  }
  // A real CSV reader. This was csvText.split('\n') and a quote-toggling split
  // on commas: an answer with a line break in it — a Facebook form's free-text
  // question, a note — cut its row in two, the second half read as a row of its
  // own, and the person's phone landed in whatever column the break left it
  // in. Rows were skipped or imported as nonsense, silently, every 15 minutes.
  const table = parseCsv(csvText);
  if (table.length < 2) return { rows: [], headers: table[0] || [] };
  const headers = table[0].map(h => String(h).trim().toLowerCase());
  const colIdx = (names) => { for (const n of names) { const i = headers.findIndex(h => h.includes(n)); if (i !== -1) return i; } return -1; };
  const nameCol   = colIdx(['full_name','الاسم_الكامل','الاسم الكامل','name','الاسم','اسم']);
  const phoneCol  = colIdx(['phone_number','رقم_الهاتف','رقم الهاتف','phone','هاتف','تليفون','موبايل','mobile','tel','whatsapp']);
  const emailCol  = colIdx(['email','ايميل','إيميل','mail']);
  const sourceCol = colIdx(['source','مصدر','channel']);
  const notesCol  = colIdx(['notes','ملاحظات','note','comment','message','رسالة']);
  const dateCol   = colIdx(DATE_HEADINGS);
  // FB custom questions: branch + course/diploma type
  const branchCol = colIdx(['اختر_الفرع','اختر الفرع','branch','فرع','الفرع','فرعك','فرع الدراسة','المدينة','مكان الدراسة','موقع الفرع','location','city']);
  const courseCol = colIdx(['اختر_نوع','اختر نوع','دبلومة','دبلوم','الكورس','كورس','course','program','البرنامج','دورة','diploma','برنامج الدراسة','اختر البرنامج']);
  const resolvedBranchCol = branchCol !== -1 ? branchCol : headers.findIndex(h => h.includes('فرع') || h.includes('branch') || h.includes('مدين') || h.includes('location'));
  const resolvedCourseCol = courseCol !== -1 ? courseCol : headers.findIndex(h => h.includes('كورس') || h.includes('دبلوم') || h.includes('برنامج') || h.includes('course'));
  logger.info(`[gsheet-auto] Sheet "${sheet.name}" gid=${gid||'default'} headers: ${JSON.stringify(headers.slice(0,12))} | branchCol=${resolvedBranchCol}`);
  if (nameCol === -1 && phoneCol === -1) {
    logger.warn(`[gsheet-auto] Sheet "${sheet.name}" columns not recognized. Headers: ${JSON.stringify(headers.slice(0,8))}`);
    return { error: 'columns_not_recognized', rows: [], headers };
  }
  const cell = (row, index) => (index !== -1 ? String(row[index] ?? '').trim() : '');
  const rows = table.slice(1).map((row, index) => ({
    index,
    rawName: cell(row, nameCol),
    phone: cell(row, phoneCol).replace(/[\s-]/g, ''),
    email: cell(row, emailCol),
    source: sourceCol !== -1 ? cell(row, sourceCol) : String(sheet.name || 'Google Sheet').trim(),
    rawNotes: cell(row, notesCol),
    rawBranch: cell(row, resolvedBranchCol),
    rawCourse: cell(row, resolvedCourseCol),
    arrivedAt: dateCol !== -1 ? rowDate(row[dateCol]) : null,
  }));
  return { rows, headers, dated: dateCol !== -1 };
}

// Normalize branch string → DB ENUM value
const normBranch = (v) => { if(!v)return null; const s=v.trim().toLowerCase().replace(/[\s_\-]/g,''); if(s.includes('دقي')||s.includes('daqqi')||s.includes('dokki'))return'DAQQI'; if(s.includes('تجمع')||s.includes('tagamoa')||s.includes('tagamo')||s.includes('قاهرةالجديدة')||s.includes('cairo')||s.includes('قاطميه')||s.includes('قاطميةs')||s.includes('qatat'))return'TAGAMOA'; if(s.includes('online')||s.includes('اونلاين')||s.includes('أونلاين')||s.includes('اونلاين')||s.includes('اون')){if(s.includes('سعودي')||s.includes('saudi'))return'ONLINE_SAUDI';if(s.includes('خارج')||s.includes('abroad'))return'ONLINE_ABROAD';return'ONLINE_EGYPT';} return s.length>=2?'OTHER':null; };

/** Where an existing lead stands — why a sheet row that is "already in" may not be on the table. */
function leadPlacement(lead) {
  if (!lead) return 'missing';
  if (lead.merged_into_lead_id) return 'merged';
  if (lead.deleted_at || Number(lead.hidden) === 1) return 'hidden';
  if (String(lead.status || '').toLowerCase() === 'archived') return 'archived';
  if (!lead.assigned_sales_id) return 'unassigned';
  return 'visible';
}

/**
 * Import the rows of every configured sheet that the CRM does not hold yet.
 *
 * @param {string} tenantId
 * @param {object} [options]
 * @param {number|null} [options.windowDays] dated rows older than this are left out (null = all)
 * @param {boolean} [options.dryRun] count and classify, write nothing
 * @param {string} [options.autoAssign] override the tenant's distribution mode
 * @param {Function} [options.fetchCsv] how a tab's CSV is fetched (tests)
 * @param {boolean} [options.autoOnly] only the sheets ticked «مزامنة تلقائية» (the timers)
 * @param {string} [options.only] only the sheet whose name, sheet id or gid contains this
 */
async function syncAllConfiguredSheets(tenantId = DEFAULT_TENANT, options = {}) {
  const report = { imported: 0, skipped: 0, outsideWindow: 0, sheets: [] };
  try {
    const settings = await getTenantSetting('crm_settings', { tenantId, fallback: {} });
    // Use only sheets explicitly stored for this tenant. Seed sheets are UI hints,
    // never implicit import sources.
    // The timers used to read every saved sheet, ticked or not, so the
    // «مزامنة تلقائية» box changed nothing. A sheet saved before the box
    // existed has no autoSync field and stays synced.
    const only = String(options.only || '').trim().toLowerCase();
    const sheets = (Array.isArray(settings?.sheets) ? settings.sheets : [])
      .filter(sheet => !options.autoOnly || sheet.autoSync !== false)
      .filter(sheet => !only || [sheet.name, sheet.sheetId, sheet.gid, ...(Array.isArray(sheet.gids) ? sheet.gids : [])]
        .some(value => String(value || '').toLowerCase().includes(only)));
    const autoAssign = ['rr', 'least', 'none'].includes(options.autoAssign) ? options.autoAssign
      : ['rr', 'least', 'none'].includes(settings?.autoAssign) ? settings.autoAssign : 'rr';
    const configuredWindow = Number(settings?.sheetImportWindowDays);
    const windowDays = options.windowDays !== undefined ? options.windowDays
      : (Number.isFinite(configuredWindow) && configuredWindow > 0 ? configuredWindow : DEFAULT_IMPORT_WINDOW_DAYS);
    const since = windowDays ? Date.now() - windowDays * 86400000 : null;
    const dryRun = Boolean(options.dryRun);

    // Every lead the tenant has ever held counts as "already imported" —
    // including the deleted (hidden) and the merged. Checking only visible
    // leads meant every lead an admin deleted came back on the next sync:
    // «شيتات بتترجع بعد المسح». Compared as identities, not as text: the same
    // person arrives as "p:+201227155562" from Facebook and as "1227155562"
    // from an older sheet. Loaded once for all sheets, not once per tab.
    const [existing] = await pool.execute(
      `SELECT id, phone, name, status, hidden, deleted_at, merged_into_lead_id, assigned_sales_id
         FROM leads WHERE tenant_id=?`, [tenantId]);
    const byPhone = new Map();
    const byName = new Map();
    for (const lead of existing) {
      const identity = toIdentity(lead.phone);
      if (identity && !byPhone.has(identity)) byPhone.set(identity, lead);
      const name = String(lead.name || '').trim().toLowerCase();
      if (name && !byName.has(name)) byName.set(name, lead);
    }

    const [dbCourses] = await pool.execute('SELECT id, title FROM courses WHERE tenant_id=? AND is_published=1 AND deleted_at IS NULL', [tenantId]);
    const [dbBundles] = await pool.execute(
      'SELECT id, title FROM bundles WHERE tenant_id=? AND is_published=1 AND deleted_at IS NULL', [tenantId]);
    // Name-to-course matching lives in lib/courseMatch.js, shared with the manual import.
    const findCourseId = (raw) => matchCourseId(raw, dbCourses, dbBundles);

    for (const sheet of sheets) {
      if (!/^[A-Za-z0-9_-]{20,120}$/.test(String(sheet.sheetId || ''))) continue;
      try {
        // Support multiple GIDs per sheet (comma-separated string or array)
        const rawGids = Array.isArray(sheet.gids) ? sheet.gids
          : (sheet.gid || '').split(',').map(g => g.trim()).filter(Boolean);
        if (rawGids.some((gid) => !/^\d{1,20}$/.test(String(gid)))) continue;
        const gidList = rawGids.length > 0 ? rawGids : [''];
        for (const gid of gidList) {
          const tab = await readSheetTab(sheet, gid, options.fetchCsv);
          const sheetReport = {
            name: sheet.name || sheet.sheetId, gid: gid || null, error: tab.error || null, dated: Boolean(tab.dated),
            rows: tab.rows.length, inWindow: 0, outsideWindow: 0, imported: 0,
            existing: { visible: 0, unassigned: 0, archived: 0, hidden: 0, merged: 0 },
            importedRows: [],
          };
          report.sheets.push(sheetReport);
          if (!tab.rows.length) continue;
          // One picker for the whole run (lib/leadAssignment.js): loads the roster,
          // open loads and intake once and honours each rep's caps.
          const assigner = dryRun || autoAssign === 'none' ? null : await createBatchAssigner(tenantId, pool);
          for (const row of tab.rows) {
            const { rawName, phone, email, source, rawNotes, rawBranch, rawCourse } = row;
            // Skip rows where both name and phone are empty (blank lines)
            if (!rawName && !phone) { report.skipped++; continue; }
            if (since && row.arrivedAt && row.arrivedAt.getTime() < since) {
              sheetReport.outsideWindow++; report.outsideWindow++; continue;
            }
            sheetReport.inWindow++;
            // A name cell holding a Facebook option key (underscores + Arabic) is a course, not a person.
            const isLikelyCourse = rawName.includes('_') && (/[ء-ي]/.test(rawName) || rawName.length > 30);
            const name = (!rawName || isLikelyCourse) ? (phone || rawName || `lead-${row.index}`) : rawName;
            const normPhone = toIdentity(phone);
            const known = normPhone ? byPhone.get(normPhone) : byName.get(name.toLowerCase());
            if (known) {
              sheetReport.existing[leadPlacement(known)]++;
              report.skipped++;
              continue;
            }
            if (dryRun) {
              sheetReport.imported++;
              sheetReport.importedRows.push({ name, phone: normPhone || phone, arrivedAt: row.arrivedAt });
              const placeholder = { status: 'new', assigned_sales_id: 'pending' };
              if (normPhone) byPhone.set(normPhone, placeholder); else byName.set(name.toLowerCase(), placeholder);
              continue;
            }
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
            if (assigner) {
              // null means every rep is at a cap. The lead stays unassigned
              // rather than pushing someone past a limit the owner set.
              const rep = assigner.next({ source: source || 'Facebook Lead Ads', courseIds: courseId ? [courseId] : [] });
              if (rep) { salesId = rep.id; salesName = rep.name; }
            }
            let code = null;
            try { const conn2 = await pool.getConnection(); try { code = await getNextClientCode(conn2); } finally { conn2.release(); } } catch(_){}
            const crmJson = JSON.stringify({ assignedSalesId: salesId, assignedSalesName: salesName, interestedCourseIds: courseId ? [courseId] : [], rawBranch: rawBranch || null });
            const leadId = `lead-gs-${Date.now()}-${row.index}`;
            const [insertResult] = await pool.execute(
              `INSERT IGNORE INTO leads (id, tenant_id, client_code, name, email, phone, source, status, notes, branch, interested_course_ids_json, assigned_sales_id, assigned_sales_name, assigned_at, crm_json, hidden, created_at) VALUES (?,?,?,?,?,?,?,'new',?,?,?,?,?,CASE WHEN ? IS NULL THEN NULL ELSE NOW() END,?,0,NOW())`,
              [leadId, tenantId, code, name, email||'', normPhone||phone||null, source||'Facebook Lead Ads', notes, branch||null, courseId ? JSON.stringify([courseId]) : null, salesId, salesName, salesId, crmJson]
            );
            if (!insertResult.affectedRows) { report.skipped++; continue; }
            const added = { id: leadId, status: 'new', assigned_sales_id: salesId, hidden: 0 };
            if (normPhone) byPhone.set(normPhone, added); else byName.set(name.toLowerCase(), added);
            // A timeline entry only when a person wrote something. The branch and
            // course labels are on the lead already; none of it is contact, and
            // stamping it marked uncontacted leads as followed up.
            if (humanNote) {
              await appendLeadInteraction({
                tenantId,
                leadId,
                interaction: { type: 'note', notes: humanNote },
                actor: { name: 'google-sheets-sync' },
              });
            }
            sheetReport.imported++;
            report.imported++;
          }
          if (assigner) {
            // Rotation lives on the policy rows now, not in a single shared index.
            await assigner.flush();
            const shared = assigner.summary();
            if (shared.length) {
              logger.info('[gsheet-sync-all] assigned', {
                sheet: sheet.name || sheet.sheetId,
                distribution: shared.map(rep => `${rep.name}:${rep.given}`).join(', '),
              });
            }
          }
          if (sheetReport.outsideWindow) {
            logger.info(`[gsheet-auto] "${sheet.name}" gid=${gid || 'default'}: ${sheetReport.outsideWindow} row(s) older than ${windowDays} days left out`);
          }
        }
      } catch(sheetErr) { logger.error('[gsheet-sync-all] sheet error:', sheetErr.message); }
    }
    return report;
  } catch(e) { logger.error('[gsheet-sync-all]', e.message); return report; }
}

module.exports = {
  DEFAULT_GSHEETS, DEFAULT_IMPORT_WINDOW_DAYS, isHtmlResponse, fetchCsvFollowRedirects, leadPlacement, readSheetTab, rowDate,
  syncAllConfiguredSheets,
};
