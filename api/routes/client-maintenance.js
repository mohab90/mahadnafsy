'use strict';

const express = require('express');
const router = express.Router();

const { pool } = require('../lib/db');
const { getNextClientCode } = require('../lib/mappers');
const { ADMIN_EMAILS, requireAuth, requireAdmin } = require('../middleware/auth');
const logger = require('../lib/logger').child({ route: 'client-maintenance' });

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

    const [rows] = await pool.query(
      `SELECT id, notes, crm_json FROM leads WHERE hidden=0 AND (branch IS NULL OR branch='')`
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
      await pool.query('UPDATE leads SET branch=? WHERE id=?', [branch, row.id]);
      updated++;
      results.push({ id: row.id, raw, branch });
    }
    res.json({ ok: true, updated, total: rows.length, results });
  } catch (e) { logger.error('client maintenance route failed', { error: e.message }); res.status(500).json({ error: 'Internal server error' }); }
});

// POST /api/admin/cleanup-junk-leads — hides leads with no phone AND no real name (e.g. 'lead-123')
router.post('/api/admin/cleanup-junk-leads', requireAuth, requireAdmin, async (req, res) => {
  try {
    // Hide leads where name looks like auto-generated 'lead-N' and phone is empty
    const [r1] = await pool.query(
      `UPDATE leads SET hidden=1 WHERE hidden=0 AND (phone IS NULL OR phone='') AND (email IS NULL OR email='') AND (name REGEXP '^lead-[0-9]' OR name IS NULL OR TRIM(name)='')`
    );
    // Also hide pure blanks (name blank or null, phone blank or null)
    const [r2] = await pool.query(
      `UPDATE leads SET hidden=1 WHERE hidden=0 AND (phone IS NULL OR TRIM(phone)='') AND (name IS NULL OR TRIM(name)='')`
    );
    res.json({ ok: true, hidden: r1.affectedRows + r2.affectedRows });
  } catch (e) { logger.error('client maintenance route failed', { error: e.message }); res.status(500).json({ error: 'Internal server error' }); }
});

// POST /api/admin/cleanup-staff-subscribers — deletes subscribers + hides leads whose email matches staff/admin
router.post('/api/admin/cleanup-staff-subscribers', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [staffRows] = await pool.query('SELECT LOWER(email) AS email FROM staff WHERE is_active = 1');
    const staffEmails = staffRows.map(r => r.email).filter(Boolean);
    const allExcluded = [...new Set([...staffEmails, ...ADMIN_EMAILS.map(e => e.toLowerCase())])];
    if (allExcluded.length === 0) return res.json({ ok: true, deleted: 0, hidden: 0, emails: [] });
    const ph = allExcluded.map(() => '?').join(',');
    const [del] = await pool.query(`DELETE FROM subscribers WHERE LOWER(email) IN (${ph})`, allExcluded);
    const [hid] = await pool.query(`UPDATE leads SET hidden = 1 WHERE LOWER(email) IN (${ph})`, allExcluded);
    res.json({ ok: true, deleted: del.affectedRows, hidden: hid.affectedRows, emails: allExcluded });
  } catch (e) { logger.error('client maintenance route failed', { error: e.message }); res.status(500).json({ error: 'Internal server error' }); }
});

// POST /api/admin/fix-auto-subscribers
router.post('/api/admin/fix-auto-subscribers', requireAuth, requireAdmin, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    let deleted = 0, merged = 0, coded = 0, branchFixed = 0;

    // 1. Delete ghost auto-subscribers: source=auto, no code, no enrollments, no payments
    const [ghosts] = await conn.query(
      `SELECT s.id FROM subscribers s
       LEFT JOIN enrollments e ON e.subscriber_id = s.id
       LEFT JOIN payments p ON p.subscriber_id = s.id
       WHERE (s.crm_json LIKE '%"source":"auto"%' OR s.crm_json IS NULL OR s.crm_json LIKE '%"enrolledCourseIds":[]%')
         AND (s.client_code IS NULL OR s.client_code NOT REGEXP '^C[0-9]+$')
         AND e.id IS NULL AND p.id IS NULL`
    );
    if (ghosts.length > 0) {
      const ids = ghosts.map(r => r.id);
      const ph = ids.map(() => '?').join(',');
      const [d] = await conn.query(`DELETE FROM subscribers WHERE id IN (${ph})`, ids);
      deleted = d.affectedRows;
    }

    // 2. Merge duplicates: same email, keep the one with client_code (or newest)
    const [dups] = await conn.query(
      `SELECT LOWER(TRIM(email)) AS em, GROUP_CONCAT(id ORDER BY CASE WHEN client_code REGEXP '^C[0-9]+$' THEN 0 ELSE 1 END, created_at DESC SEPARATOR ',') AS ids, COUNT(*) AS cnt
       FROM subscribers
       WHERE email IS NOT NULL AND email != ''
       GROUP BY LOWER(TRIM(email))
       HAVING cnt > 1`
    );
    for (const dup of dups) {
      const ids = dup.ids.split(',');
      const keepId = ids[0];
      const removeIds = ids.slice(1);
      for (const rid of removeIds) {
        await conn.query(`UPDATE enrollments SET subscriber_id = ? WHERE subscriber_id = ?`, [keepId, rid]);
        await conn.query(`UPDATE payments SET subscriber_id = ? WHERE subscriber_id = ?`, [keepId, rid]);
      }
      const rph = removeIds.map(() => '?').join(',');
      await conn.query(`DELETE FROM subscribers WHERE id IN (${rph})`, removeIds);
      merged++;
    }

    // 3. Sync counter then assign codes to subscribers missing them
    const [[subMax]] = await conn.query(
      `SELECT MAX(CAST(SUBSTRING(client_code,2) AS UNSIGNED)) AS mx FROM subscribers WHERE client_code REGEXP '^C[0-9]+$'`
    );
    const [[leadMax]] = await conn.query(
      `SELECT MAX(CAST(SUBSTRING(client_code,2) AS UNSIGNED)) AS mx FROM leads WHERE client_code REGEXP '^C[0-9]+$'`
    );
    const maxV = Math.max(subMax.mx || 0, leadMax.mx || 0);
    const syncNext = maxV >= 10000 ? maxV + 1 : 10001;
    await conn.query('UPDATE client_code_counter SET next_value = ? WHERE id = 1 AND next_value < ?', [syncNext, syncNext]);

    const [noCodes] = await conn.query(
      `SELECT id FROM subscribers WHERE client_code IS NULL OR client_code NOT REGEXP '^C[0-9]+$' ORDER BY created_at ASC`
    );
    for (const row of noCodes) {
      const code = await getNextClientCode(conn);
      await conn.query('UPDATE subscribers SET client_code = ? WHERE id = ?', [code, row.id]);
      coded++;
    }

    // 4. Fix branch: subscribers with branch NULL or 'أخرى' but no crm_json branch → set 'online'
    const [wrongBranch] = await conn.query(
      `SELECT id FROM subscribers WHERE branch IS NULL OR branch = '' OR branch = 'أخرى' OR branch = 'اخري' OR branch = 'other'`
    );
    if (wrongBranch.length > 0) {
      const bIds = wrongBranch.map(r => r.id);
      const bph = bIds.map(() => '?').join(',');
      await conn.query(`UPDATE subscribers SET branch = 'اون لاين' WHERE id IN (${bph})`, bIds);
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
router.post('/api/admin/bulk-assign-client-codes', requireAuth, requireAdmin, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[subMax]] = await conn.query(
      `SELECT MAX(CAST(SUBSTRING(client_code, 2) AS UNSIGNED)) AS mx
       FROM subscribers WHERE client_code REGEXP '^C[0-9]+$'`
    );
    const [[leadMax]] = await conn.query(
      `SELECT MAX(CAST(SUBSTRING(client_code, 2) AS UNSIGNED)) AS mx
       FROM leads WHERE client_code REGEXP '^C[0-9]+$'`
    );
    const maxVal = Math.max(subMax.mx || 0, leadMax.mx || 0);
    const syncNext = maxVal >= 10000 ? maxVal + 1 : 10001;
    await conn.query(
      'UPDATE client_code_counter SET next_value = ? WHERE id = 1 AND next_value < ?',
      [syncNext, syncNext]
    );

    const [badSubs] = await conn.query(
      `SELECT id FROM subscribers WHERE client_code IS NULL OR client_code NOT REGEXP '^C[0-9]+$'
       OR CAST(SUBSTRING(client_code,2) AS UNSIGNED) < 10000 ORDER BY created_at ASC`
    );
    const [badLeads] = await conn.query(
      `SELECT id FROM leads WHERE client_code IS NULL OR client_code NOT REGEXP '^C[0-9]+$'
       OR CAST(SUBSTRING(client_code,2) AS UNSIGNED) < 10000 ORDER BY created_at ASC`
    );

    const totalNeeded = badSubs.length + badLeads.length;
    if (totalNeeded === 0) {
      await conn.commit();
      return res.json({ ok: true, assigned: 0, message: 'كل العملاء لديهم كود صالح بالفعل' });
    }

    await conn.query('SELECT next_value FROM client_code_counter WHERE id=1 FOR UPDATE');
    const [[cRow]] = await conn.query('SELECT next_value FROM client_code_counter WHERE id=1');
    let nextVal = cRow.next_value;

    for (const row of badSubs) {
      const code = `C${nextVal++}`;
      await conn.query('UPDATE subscribers SET client_code=? WHERE id=? AND (client_code IS NULL OR client_code NOT REGEXP ?)', [code, row.id, '^C[0-9]+$']);
    }
    for (const row of badLeads) {
      const code = `C${nextVal++}`;
      await conn.query('UPDATE leads SET client_code=? WHERE id=? AND (client_code IS NULL OR client_code NOT REGEXP ?)', [code, row.id, '^C[0-9]+$']);
    }
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

    const [[maxRow]] = await conn.query(`
      SELECT COALESCE(MAX(n), 10000) AS mx FROM (
        SELECT MAX(CAST(SUBSTRING(client_code,2) AS UNSIGNED)) AS n FROM leads   WHERE client_code REGEXP '^C[0-9]+$'
        UNION ALL
        SELECT MAX(CAST(SUBSTRING(client_code,2) AS UNSIGNED)) AS n FROM subscribers WHERE client_code REGEXP '^C[0-9]+$'
      ) t
    `);
    await conn.query('UPDATE client_code_counter SET next_value = ? WHERE id = 1 AND next_value <= ?', [maxRow.mx + 1, maxRow.mx]);

    const [badLeads] = await conn.query(`SELECT id FROM leads WHERE client_code IS NULL OR client_code NOT REGEXP '^C[0-9]+$'`);
    const [badSubs] = await conn.query(`SELECT id FROM subscribers WHERE client_code IS NULL OR client_code NOT REGEXP '^C[0-9]+$'`);

    await conn.query('SELECT next_value FROM client_code_counter WHERE id=1 FOR UPDATE');
    const [[cRow]] = await conn.query('SELECT next_value FROM client_code_counter WHERE id=1');
    let nextVal = cRow.next_value;

    for (const row of badLeads) {
      await conn.query('UPDATE leads SET client_code=? WHERE id=?', [`C${nextVal++}`, row.id]);
    }
    for (const row of badSubs) {
      await conn.query('UPDATE subscribers SET client_code=? WHERE id=?', [`C${nextVal++}`, row.id]);
    }
    await conn.query('UPDATE client_code_counter SET next_value=? WHERE id=1', [nextVal]);

    // Merge duplicate leads by phone (keep newest, hide older)
    const [dupPhoneLeads] = await conn.query(`
      SELECT phone, COUNT(*) AS cnt FROM leads WHERE phone IS NOT NULL AND phone != '' AND hidden != 1 GROUP BY phone HAVING cnt > 1
    `);
    let mergedLeads = 0;
    for (const { phone } of dupPhoneLeads) {
      const [group] = await conn.query(`SELECT id FROM leads WHERE phone=? AND hidden!=1 ORDER BY created_at DESC, id DESC`, [phone]);
      if (group.length < 2) continue;
      const keepId = group[0].id;
      const dupIds = group.slice(1).map(r => r.id);
      await conn.query(`UPDATE leads SET hidden=1, notes=CONCAT(COALESCE(notes,''), ' [مدمج مع #${keepId}]') WHERE id IN (?)`, [dupIds]);
      mergedLeads += dupIds.length;
    }

    // Merge duplicate subscribers by email
    const [dupEmailSubs] = await conn.query(`
      SELECT email, COUNT(*) AS cnt FROM subscribers WHERE email IS NOT NULL AND email != '' GROUP BY email HAVING cnt > 1
    `);
    let mergedSubs = 0;
    for (const { email } of dupEmailSubs) {
      const [group] = await conn.query(`
        SELECT s.id, COUNT(e.id) AS enroll_count
        FROM subscribers s LEFT JOIN enrollments e ON e.subscriber_id=s.id
        WHERE s.email=? GROUP BY s.id ORDER BY enroll_count DESC, s.id ASC
      `, [email]);
      if (group.length < 2) continue;
      const keepId = group[0].id;
      const dupIds = group.slice(1).map(r => r.id);
      for (const dupId of dupIds) {
        await conn.query(`UPDATE enrollments SET subscriber_id=? WHERE subscriber_id=? AND NOT EXISTS (SELECT 1 FROM enrollments e2 WHERE e2.subscriber_id=? AND e2.course_id=(SELECT course_id FROM enrollments WHERE id=enrollments.id))`, [keepId, dupId, keepId]);
        await conn.query(`DELETE FROM enrollments WHERE subscriber_id=?`, [dupId]);
        await conn.query(`UPDATE payments SET subscriber_id=? WHERE subscriber_id=?`, [keepId, dupId]);
        await conn.query(`DELETE FROM subscribers WHERE id=?`, [dupId]);
      }
      mergedSubs += dupIds.length;
    }

    // Fix cross-table duplicate codes
    const [crossDups] = await conn.query(`
      SELECT s.id FROM subscribers s JOIN leads l ON l.client_code = s.client_code AND l.hidden != 1
    `);
    let dupCodesFixed = 0;
    if (crossDups.length > 0) {
      await conn.query('SELECT next_value FROM client_code_counter WHERE id=1 FOR UPDATE');
      const [[cRow2]] = await conn.query('SELECT next_value FROM client_code_counter WHERE id=1');
      let nv = cRow2.next_value;
      for (const row of crossDups) {
        await conn.query('UPDATE subscribers SET client_code=? WHERE id=?', [`C${nv++}`, row.id]);
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
