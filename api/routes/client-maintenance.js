'use strict';

const express = require('express');
const router = express.Router();

const { pool } = require('../lib/db');
const { getNextClientCode } = require('../lib/mappers');
const { DEFAULT_TENANT_ID, resolveTenantId } = require('../lib/tenantScope');
const { ADMIN_EMAILS, requireAuth, requireAdmin } = require('../middleware/auth');
const { bulkOperationLimiter } = require('../middleware/rateLimits');
const logger = require('../lib/logger').child({ route: 'client-maintenance' });

function scopedTenantId(req) {
  return req.tenantId || resolveTenantId(req) || DEFAULT_TENANT_ID;
}

// POST /api/admin/leads/migrate-branches — fill branch column from rawBranch (crm_json) or notes for branchless leads
router.post('/api/admin/leads/migrate-branches', requireAuth, requireAdmin, async (req, res) => {
  try {
    const normB = (v) => {
      if (!v) return null;
      const s = v.trim().toLowerCase().replace(/[\s_\-]/g, '');
      if (s.includes('دقي') || s.includes('daqqi') || s.includes('dokki')) return 'DAQQI';
      if (s.includes('تجمع') || s.includes('tagamoa') || s.includes('tagamo') || s.includes('قاهرةالجديدة') || s.includes('cairo') || s.includes('قاطميه') || s.includes('قطاميه') || s.includes('qatat')) return 'TAGAMOA';
      if (s.includes('online') || s.includes('اونلاين') || s.includes('أونلاين') || s.includes('اون')) {
        if (s.includes('سعودي') || s.includes('saudi')) return 'ONLINE_SAUDI';
        if (s.includes('خارج') || s.includes('abroad')) return 'ONLINE_ABROAD';
        return 'ONLINE_EGYPT';
      }
      if (s.length >= 2) return 'OTHER';
      return null;
    };

    const tryParseJson = (s, def) => { try { return JSON.parse(s); } catch { return def; } };

    const tenantId = scopedTenantId(req);
    const [rows] = await pool.query(
      `SELECT id, notes, crm_json FROM leads WHERE hidden=0 AND tenant_id=? AND (branch IS NULL OR branch='')`,
      [tenantId]
    );

    let updated = 0;
    const results = [];
    for (const row of rows) {
      const crm = tryParseJson(row.crm_json, {});
      // 1. Try rawBranch from crm_json first
      let raw = (crm.rawBranch || '').trim();
      // 2. Try crm_json.branch (stored as e.g. "online-egypt", "other", "daqqi")
      if (!raw && crm.branch) raw = String(crm.branch).trim();
      // 3. Fallback: extract from notes "الفرع: X"
      if (!raw && row.notes) {
        const m = /الفرع:\s*([^|\n]+)/.exec(row.notes);
        if (m) raw = m[1].trim();
      }
      if (!raw) continue;
      const branch = normB(raw);
      if (!branch) { results.push({ id: row.id, raw, branch: null }); continue; }
      await pool.query('UPDATE leads SET branch=? WHERE id=? AND tenant_id=?', [branch, row.id, tenantId]);
      updated++;
      results.push({ id: row.id, raw, branch });
    }
    res.json({ ok: true, updated, total: rows.length, results });
  } catch (e) { logger.error('client maintenance route failed', { error: e.message }); res.status(500).json({ error: 'Internal server error' }); }
});

// POST /api/admin/cleanup-junk-leads — hides leads with no phone AND no real name (e.g. 'lead-123')
router.post('/api/admin/cleanup-junk-leads', requireAuth, requireAdmin, async (req, res) => {
  try {
    const tenantId = scopedTenantId(req);
    // Hide leads where name looks like auto-generated 'lead-N' and phone is empty
    const [r1] = await pool.query(
      `UPDATE leads SET hidden=1 WHERE hidden=0 AND tenant_id=? AND (phone IS NULL OR phone='') AND (email IS NULL OR email='') AND (name REGEXP '^lead-[0-9]' OR name IS NULL OR TRIM(name)='')`,
      [tenantId]
    );
    // Also hide pure blanks (name blank or null, phone blank or null)
    const [r2] = await pool.query(
      `UPDATE leads SET hidden=1 WHERE hidden=0 AND tenant_id=? AND (phone IS NULL OR TRIM(phone)='') AND (name IS NULL OR TRIM(name)='')`,
      [tenantId]
    );
    res.json({ ok: true, hidden: r1.affectedRows + r2.affectedRows });
  } catch (e) { logger.error('client maintenance route failed', { error: e.message }); res.status(500).json({ error: 'Internal server error' }); }
});

// POST /api/admin/cleanup-staff-subscribers — deletes subscribers + hides leads whose email matches staff/admin
router.post('/api/admin/cleanup-staff-subscribers', requireAuth, requireAdmin, async (req, res) => {
  try {
    const tenantId = scopedTenantId(req);
    const [staffRows] = await pool.query('SELECT LOWER(email) AS email FROM staff WHERE is_active = 1');
    const staffEmails = staffRows.map(r => r.email).filter(Boolean);
    const allExcluded = [...new Set([...staffEmails, ...ADMIN_EMAILS.map(e => e.toLowerCase())])];
    if (allExcluded.length === 0) return res.json({ ok: true, deleted: 0, hidden: 0, emails: [] });
    const ph = allExcluded.map(() => '?').join(',');
    const [del] = await pool.query(`DELETE FROM subscribers WHERE tenant_id=? AND LOWER(email) IN (${ph})`, [tenantId, ...allExcluded]);
    const [hid] = await pool.query(`UPDATE leads SET hidden = 1 WHERE tenant_id=? AND LOWER(email) IN (${ph})`, [tenantId, ...allExcluded]);
    res.json({ ok: true, deleted: del.affectedRows, hidden: hid.affectedRows, emails: allExcluded });
  } catch (e) { logger.error('client maintenance route failed', { error: e.message }); res.status(500).json({ error: 'Internal server error' }); }
});

// POST /api/admin/fix-auto-subscribers
// Cleans up bad auto-created subscriber records:
//  1. Deletes subscribers with no courses + no payments + no client_code (ghost records from auto-create)
//  2. Merges duplicate subscribers with same email (keeps the one with a code)
//  3. Assigns client codes to subscribers that still have none
//  4. Fixes branch: subscribers with branch=NULL/'أخرى' and crm_json.source='auto' → set branch='online'
router.post('/api/admin/fix-auto-subscribers', requireAuth, requireAdmin, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const tenantId = scopedTenantId(req);
    let deleted = 0, merged = 0, coded = 0, branchFixed = 0;

    // 1. Delete ghost auto-subscribers: source=auto, no code, no enrollments, no payments
    const [ghosts] = await conn.query(
      `SELECT s.id FROM subscribers s
       LEFT JOIN enrollments e ON e.subscriber_id = s.id
       LEFT JOIN payments p ON p.subscriber_id = s.id
       WHERE s.tenant_id=? AND (s.crm_json LIKE '%"source":"auto"%' OR s.crm_json IS NULL OR s.crm_json LIKE '%"enrolledCourseIds":[]%')
         AND (s.client_code IS NULL OR s.client_code NOT REGEXP '^C[0-9]+$')
         AND e.id IS NULL AND p.id IS NULL`,
      [tenantId]
    );
    if (ghosts.length > 0) {
      const ids = ghosts.map(r => r.id);
      const ph = ids.map(() => '?').join(',');
      const [d] = await conn.query(`DELETE FROM subscribers WHERE tenant_id=? AND id IN (${ph})`, [tenantId, ...ids]);
      deleted = d.affectedRows;
    }

    // 2. Merge duplicates: same email, keep the one with client_code (or newest)
    const [dups] = await conn.query(
      `SELECT LOWER(TRIM(email)) AS em, GROUP_CONCAT(id ORDER BY CASE WHEN client_code REGEXP '^C[0-9]+$' THEN 0 ELSE 1 END, created_at DESC SEPARATOR ',') AS ids, COUNT(*) AS cnt
       FROM subscribers
       WHERE tenant_id=? AND email IS NOT NULL AND email != ''
       GROUP BY LOWER(TRIM(email))
       HAVING cnt > 1`,
      [tenantId]
    );
    for (const dup of dups) {
      const ids = dup.ids.split(',');
      const keepId = ids[0]; // first = has code if any
      const removeIds = ids.slice(1);
      // Move enrollments and payments to keepId
      for (const rid of removeIds) {
        await conn.query(`UPDATE enrollments SET subscriber_id = ? WHERE subscriber_id = ? AND tenant_id=?`, [keepId, rid, tenantId]);
        await conn.query(`UPDATE payments SET subscriber_id = ? WHERE subscriber_id = ? AND tenant_id=?`, [keepId, rid, tenantId]);
      }
      const rph = removeIds.map(() => '?').join(',');
      await conn.query(`DELETE FROM subscribers WHERE tenant_id=? AND id IN (${rph})`, [tenantId, ...removeIds]);
      merged++;
    }

    // 3. Sync counter then assign codes to subscribers missing them
    const [[subMax]] = await conn.query(
      `SELECT MAX(CAST(SUBSTRING(client_code,2) AS UNSIGNED)) AS mx FROM subscribers WHERE tenant_id=? AND client_code REGEXP '^C[0-9]+$'`,
      [tenantId]
    );
    const [[leadMax]] = await conn.query(
      `SELECT MAX(CAST(SUBSTRING(client_code,2) AS UNSIGNED)) AS mx FROM leads WHERE tenant_id=? AND client_code REGEXP '^C[0-9]+$'`,
      [tenantId]
    );
    const maxV = Math.max(subMax.mx || 0, leadMax.mx || 0);
    const syncNext = maxV >= 10000 ? maxV + 1 : 10001;
    await conn.query('UPDATE client_code_counter SET next_value = ? WHERE id = 1 AND next_value < ?', [syncNext, syncNext]);

    const [noCodes] = await conn.query(
      `SELECT id FROM subscribers WHERE tenant_id=? AND (client_code IS NULL OR client_code NOT REGEXP '^C[0-9]+$') ORDER BY created_at ASC`,
      [tenantId]
    );
    for (const row of noCodes) {
      const code = await getNextClientCode(conn);
      await conn.query('UPDATE subscribers SET client_code = ? WHERE id = ? AND tenant_id=?', [code, row.id, tenantId]);
      coded++;
    }

    // 4. Fix branch: subscribers with branch NULL or 'أخرى' but no crm_json branch → set 'online'
    const [wrongBranch] = await conn.query(
      `SELECT id FROM subscribers WHERE tenant_id=? AND (branch IS NULL OR branch = '' OR branch = 'أخرى' OR branch = 'اخري' OR branch = 'other')`,
      [tenantId]
    );
    if (wrongBranch.length > 0) {
      const bIds = wrongBranch.map(r => r.id);
      const bph = bIds.map(() => '?').join(',');
      await conn.query(`UPDATE subscribers SET branch = 'اون لاين' WHERE tenant_id=? AND id IN (${bph})`, [tenantId, ...bIds]);
      branchFixed = wrongBranch.length;
    }

    await conn.commit();
    res.json({ ok: true, deleted, merged, coded, branchFixed });
  } catch (e) {
    await conn.rollback().catch(() => {});
    logger.error('client maintenance route failed', { error: e.message }); res.status(500).json({ error: 'Internal server error' });
  } finally { conn.release(); }
});

// ── Bulk assign client codes (server-authoritative, atomic) ───────────────────
// Finds ALL leads+subscribers with null/invalid client_code and assigns them
// codes from the counter in a single transaction.
router.post('/api/admin/bulk-assign-client-codes', requireAuth, requireAdmin, bulkOperationLimiter, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const tenantId = scopedTenantId(req);
    // First sync the counter so it's ahead of any locally-assigned codes
    const [[subMax]] = await conn.query(
      `SELECT MAX(CAST(SUBSTRING(client_code, 2) AS UNSIGNED)) AS mx
       FROM subscribers WHERE tenant_id=? AND client_code REGEXP '^C[0-9]+$'`,
      [tenantId]
    );
    const [[leadMax]] = await conn.query(
      `SELECT MAX(CAST(SUBSTRING(client_code, 2) AS UNSIGNED)) AS mx
       FROM leads WHERE tenant_id=? AND client_code REGEXP '^C[0-9]+$'`,
      [tenantId]
    );
    const maxVal = Math.max(subMax.mx || 0, leadMax.mx || 0);
    const syncNext = maxVal >= 10000 ? maxVal + 1 : 10001;
    await conn.query(
      'UPDATE client_code_counter SET next_value = ? WHERE id = 1 AND next_value < ?',
      [syncNext, syncNext]
    );

    // Find rows without valid codes
    const [badSubs] = await conn.query(
      `SELECT id FROM subscribers WHERE tenant_id=? AND (client_code IS NULL OR client_code NOT REGEXP '^C[0-9]+$'
       OR CAST(SUBSTRING(client_code,2) AS UNSIGNED) < 10000) ORDER BY created_at ASC`,
      [tenantId]
    );
    const [badLeads] = await conn.query(
      `SELECT id FROM leads WHERE tenant_id=? AND (client_code IS NULL OR client_code NOT REGEXP '^C[0-9]+$'
       OR CAST(SUBSTRING(client_code,2) AS UNSIGNED) < 10000) ORDER BY created_at ASC`,
      [tenantId]
    );

    const totalNeeded = badSubs.length + badLeads.length;
    if (totalNeeded === 0) {
      await conn.commit();
      return res.json({ ok: true, assigned: 0, message: 'كل العملاء لديهم كود صالح بالفعل' });
    }

    // Lock and get enough codes from the counter
    await conn.query('SELECT next_value FROM client_code_counter WHERE id=1 FOR UPDATE');
    const [[cRow]] = await conn.query('SELECT next_value FROM client_code_counter WHERE id=1');
    let nextVal = cRow.next_value;

    // Assign to subscribers
    for (const row of badSubs) {
      const code = `C${nextVal++}`;
      await conn.query('UPDATE subscribers SET client_code=? WHERE id=? AND tenant_id=? AND (client_code IS NULL OR client_code NOT REGEXP ?)', [code, row.id, tenantId, '^C[0-9]+$']);
    }
    // Assign to leads
    for (const row of badLeads) {
      const code = `C${nextVal++}`;
      await conn.query('UPDATE leads SET client_code=? WHERE id=? AND tenant_id=? AND (client_code IS NULL OR client_code NOT REGEXP ?)', [code, row.id, tenantId, '^C[0-9]+$']);
    }
    // Update counter
    await conn.query('UPDATE client_code_counter SET next_value=? WHERE id=1', [nextVal]);

    await conn.commit();
    res.json({ ok: true, assigned: totalNeeded, nextCounter: nextVal });
  } catch (e) {
    await conn.rollback();
    logger.error('client maintenance route failed', { error: e.message }); res.status(500).json({ error: 'Internal server error' });
  } finally { conn.release(); }
});

// ── Fix all codes: assign missing + merge duplicates ─────────────────────────
router.post('/api/admin/fix-all-codes', requireAuth, requireAdmin, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const tenantId = scopedTenantId(req);

    // 1. Sync counter to max existing code + 1
    const [[maxRow]] = await conn.query(`
      SELECT COALESCE(MAX(n), 10000) AS mx FROM (
        SELECT MAX(CAST(SUBSTRING(client_code,2) AS UNSIGNED)) AS n FROM leads   WHERE tenant_id=? AND client_code REGEXP '^C[0-9]+$'
        UNION ALL
        SELECT MAX(CAST(SUBSTRING(client_code,2) AS UNSIGNED)) AS n FROM subscribers WHERE tenant_id=? AND client_code REGEXP '^C[0-9]+$'
      ) t
    `, [tenantId, tenantId]);
    await conn.query('UPDATE client_code_counter SET next_value = ? WHERE id = 1 AND next_value <= ?', [maxRow.mx + 1, maxRow.mx]);

    // 2. Assign codes to leads without valid codes
    const [badLeads] = await conn.query(`SELECT id FROM leads WHERE tenant_id=? AND (client_code IS NULL OR client_code NOT REGEXP '^C[0-9]+$')`, [tenantId]);
    // 3. Assign codes to subscribers without valid codes
    const [badSubs] = await conn.query(`SELECT id FROM subscribers WHERE tenant_id=? AND (client_code IS NULL OR client_code NOT REGEXP '^C[0-9]+$')`, [tenantId]);

    await conn.query('SELECT next_value FROM client_code_counter WHERE id=1 FOR UPDATE');
    const [[cRow]] = await conn.query('SELECT next_value FROM client_code_counter WHERE id=1');
    let nextVal = cRow.next_value;

    for (const row of badLeads) {
      await conn.query('UPDATE leads SET client_code=? WHERE id=? AND tenant_id=?', [`C${nextVal++}`, row.id, tenantId]);
    }
    for (const row of badSubs) {
      await conn.query('UPDATE subscribers SET client_code=? WHERE id=? AND tenant_id=?', [`C${nextVal++}`, row.id, tenantId]);
    }
    await conn.query('UPDATE client_code_counter SET next_value=? WHERE id=1', [nextVal]);

    // 4. Merge duplicate leads by phone (keep newest, hide older)
    const [dupPhoneLeads] = await conn.query(`
      SELECT phone, COUNT(*) AS cnt FROM leads WHERE tenant_id=? AND phone IS NOT NULL AND phone != '' AND hidden != 1 GROUP BY phone HAVING cnt > 1
    `, [tenantId]);
    let mergedLeads = 0;
    for (const { phone } of dupPhoneLeads) {
      const [group] = await conn.query(`SELECT id FROM leads WHERE phone=? AND tenant_id=? AND hidden!=1 ORDER BY created_at DESC, id DESC`, [phone, tenantId]);
      if (group.length < 2) continue;
      const keepId = group[0].id;
      const dupIds = group.slice(1).map(r => r.id);
      await conn.query(`UPDATE leads SET hidden=1, notes=CONCAT(COALESCE(notes,''), ' [مدمج مع #${keepId}]') WHERE tenant_id=? AND id IN (?)`, [tenantId, dupIds]);
      mergedLeads += dupIds.length;
    }

    // 5. Merge duplicate subscribers by email (keep id with most enrollments, move the rest)
    const [dupEmailSubs] = await conn.query(`
      SELECT email, COUNT(*) AS cnt FROM subscribers WHERE tenant_id=? AND email IS NOT NULL AND email != '' GROUP BY email HAVING cnt > 1
    `, [tenantId]);
    let mergedSubs = 0;
    for (const { email } of dupEmailSubs) {
      const [group] = await conn.query(`
        SELECT s.id, COUNT(e.id) AS enroll_count
        FROM subscribers s LEFT JOIN enrollments e ON e.subscriber_id=s.id
        WHERE s.email=? AND s.tenant_id=? GROUP BY s.id ORDER BY enroll_count DESC, s.id ASC
      `, [email, tenantId]);
      if (group.length < 2) continue;
      const keepId = group[0].id;
      const dupIds = group.slice(1).map(r => r.id);
      // move enrollments and payments to keepId
      for (const dupId of dupIds) {
        await conn.query(`UPDATE enrollments SET subscriber_id=? WHERE subscriber_id=? AND tenant_id=? AND NOT EXISTS (SELECT 1 FROM enrollments e2 WHERE e2.subscriber_id=? AND e2.course_id=(SELECT course_id FROM enrollments WHERE id=enrollments.id))`, [keepId, dupId, tenantId, keepId]);
        await conn.query(`DELETE FROM enrollments WHERE subscriber_id=? AND tenant_id=?`, [dupId, tenantId]);
        await conn.query(`UPDATE payments SET subscriber_id=? WHERE subscriber_id=? AND tenant_id=?`, [keepId, dupId, tenantId]);
        await conn.query(`DELETE FROM subscribers WHERE id=? AND tenant_id=?`, [dupId, tenantId]);
      }
      mergedSubs += dupIds.length;
    }

    // 6. Fix cross-table duplicate codes: if a code appears in both tables, re-assign subscriber
    const [crossDups] = await conn.query(`
      SELECT s.id FROM subscribers s JOIN leads l ON l.client_code = s.client_code AND l.hidden != 1 AND l.tenant_id=s.tenant_id
      WHERE s.tenant_id=?
    `, [tenantId]);
    let dupCodesFixed = 0;
    if (crossDups.length > 0) {
      await conn.query('SELECT next_value FROM client_code_counter WHERE id=1 FOR UPDATE');
      const [[cRow2]] = await conn.query('SELECT next_value FROM client_code_counter WHERE id=1');
      let nv = cRow2.next_value;
      for (const row of crossDups) {
        await conn.query('UPDATE subscribers SET client_code=? WHERE id=? AND tenant_id=?', [`C${nv++}`, row.id, tenantId]);
        dupCodesFixed++;
      }
      await conn.query('UPDATE client_code_counter SET next_value=? WHERE id=1', [nv]);
    }

    await conn.commit();
    res.json({
      ok: true,
      assigned_leads: badLeads.length,
      assigned_subs: badSubs.length,
      merged_leads: mergedLeads,
      merged_subs: mergedSubs,
      dup_codes_fixed: dupCodesFixed
    });
  } catch (e) {
    await conn.rollback();
    logger.error('client maintenance route failed', { error: e.message }); res.status(500).json({ error: 'Internal server error' });
  } finally { conn.release(); }
});

module.exports = router;
