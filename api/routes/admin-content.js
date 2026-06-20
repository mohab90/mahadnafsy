'use strict';
const express  = require('express');
const router   = express.Router();
const { uuidv4 } = require('../lib/id');
const { pool, cacheInvalidate } = require('../lib/db');
const { requireAuth, requireAdmin, requireAdminOrStaff } = require('../middleware/auth');

// ── Lectures & Chapters ───────────────────────────────────────────────────────

router.post('/api/admin/lectures', requireAuth, requireAdmin, async (req, res) => {
  try {
    const l = req.body;
    const id = l.id || uuidv4();
    const courseId      = l.courseId      || l.course_id      || null;
    const chapterId     = l.chapterId     || l.chapter_id     || null;
    const videoUrl      = l.videoUrl      || l.video_url      || '';
    const sortOrder     = l.order         ?? l.sortOrder      ?? l.sort_order     ?? 0;
    const lectureType   = (l.lectureType  || l.lecture_type   || 'RECORDED').toUpperCase();
    const description   = l.description   || '';
    const isPreview     = l.isPreview     != null ? (l.isPreview     ? 1 : 0) : (l.is_preview     != null ? (l.is_preview     ? 1 : 0) : 0);
    const isPublishedL  = l.isPublished   != null ? (l.isPublished   ? 1 : 0) : (l.is_published   != null ? (l.is_published   ? 1 : 0) : 0);
    const dripUnlockDays = l.dripUnlockDays ?? l.drip_unlock_days ?? 0;
    await pool.query(
      `INSERT INTO course_lectures (id, course_id, chapter_id, title, lecture_type, video_url, duration, sort_order, description, is_preview, is_published, drip_unlock_days)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE
         title=VALUES(title), video_url=VALUES(video_url),
         chapter_id=VALUES(chapter_id), course_id=VALUES(course_id),
         lecture_type=VALUES(lecture_type), duration=VALUES(duration),
         sort_order=VALUES(sort_order), description=VALUES(description),
         is_preview=VALUES(is_preview), is_published=VALUES(is_published),
         drip_unlock_days=VALUES(drip_unlock_days)`,
      [id, courseId, chapterId, l.title||'Untitled', lectureType, videoUrl, l.duration||'', sortOrder, description, isPreview, isPublishedL, dripUnlockDays]
    );
    cacheInvalidate('courses');
    res.json({ ok: true, id });
  } catch (e) { console.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

router.post('/api/admin/chapters', requireAuth, requireAdmin, async (req, res) => {
  try {
    const c = req.body;
    const id = c.id || uuidv4();
    const courseId  = c.courseId  || c.course_id  || null;
    const sortOrder = c.order     ?? c.sortOrder  ?? c.sort_order ?? 0;
    await pool.query(
      `INSERT INTO course_chapters (id, course_id, title, sort_order)
       VALUES (?,?,?,?)
       ON DUPLICATE KEY UPDATE title=VALUES(title), sort_order=VALUES(sort_order)`,
      [id, courseId, c.title||'', sortOrder]
    );
    cacheInvalidate('courses');
    res.json({ ok: true, id });
  } catch (e) { console.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// ── Therapists & Testimonials ─────────────────────────────────────────────────

router.post('/api/admin/therapists', requireAuth, requireAdmin, async (req, res) => {
  try {
    const t = req.body;
    const id = t.id || uuidv4();
    const cs = t.consultationSettings || {};
    const priceEgp = cs.sessionPrice?.EGP ?? t.price?.EGP ?? t.price_egp ?? 0;
    const priceSar = cs.sessionPrice?.SAR ?? t.price?.SAR ?? t.price_sar ?? 0;
    const priceUsd = cs.sessionPrice?.USD ?? t.price?.USD ?? t.price_usd ?? 0;
    const isConsult = cs.enabled !== undefined ? (cs.enabled ? 1 : 0) : (t.is_consultation_enabled || 0);
    const sessionDur = cs.sessionDurationMinutes ?? t.session_duration_minutes ?? 60;
    const rawProvider = cs.meetingProvider ?? t.meeting_provider ?? 'GOOGLE_MEET';
    const meetingProvider = rawProvider.toUpperCase().replace('-', '_');
    const providerUrl = cs.providerBaseUrl ?? t.provider_base_url ?? null;
    const langJson = Array.isArray(t.languages) ? JSON.stringify(t.languages) : (t.languages_json || null);
    const focusJson = Array.isArray(t.focusAreas) ? JSON.stringify(t.focusAreas) : (t.focus_areas_json || null);
    const qualJson = Array.isArray(t.qualifications) ? JSON.stringify(t.qualifications) : (t.qualifications_json || null);
    const showHome = t.showOnHome !== undefined ? (t.showOnHome ? 1 : 0) : (t.show_on_home || 0);
    const showAbout = t.showOnAbout !== undefined ? (t.showOnAbout ? 1 : 0) : (t.show_on_about || 0);
    await pool.query(
      `INSERT INTO therapists
         (id, name, specialty, image, experience, rating, title, bio,
          price_egp, price_sar, price_usd,
          is_consultation_enabled, session_duration_minutes,
          meeting_provider, provider_base_url,
          featured, sort_order, show_on_home, show_on_about, is_active,
          languages_json, focus_areas_json, qualifications_json)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE
         name=VALUES(name), specialty=VALUES(specialty), image=VALUES(image),
         bio=VALUES(bio), title=VALUES(title),
         price_egp=VALUES(price_egp), price_sar=VALUES(price_sar), price_usd=VALUES(price_usd),
         is_consultation_enabled=VALUES(is_consultation_enabled),
         session_duration_minutes=VALUES(session_duration_minutes),
         meeting_provider=VALUES(meeting_provider), provider_base_url=VALUES(provider_base_url),
         featured=VALUES(featured), sort_order=VALUES(sort_order),
         show_on_home=VALUES(show_on_home), show_on_about=VALUES(show_on_about),
         is_active=VALUES(is_active),
         languages_json=VALUES(languages_json), focus_areas_json=VALUES(focus_areas_json),
         qualifications_json=VALUES(qualifications_json)`,
      [
        id, t.name||'', t.specialty||'', t.image||'', t.experience||0, t.rating||5,
        t.title||null, t.bio||null,
        priceEgp, priceSar, priceUsd,
        isConsult, sessionDur,
        meetingProvider, providerUrl,
        t.featured ? 1 : 0, t.sortOrder ?? t.sort_order ?? 0,
        showHome, showAbout,
        t.isActive !== undefined ? (t.isActive ? 1 : 0) : (t.is_active !== undefined ? t.is_active : 1),
        langJson, focusJson, qualJson,
      ]
    );
    cacheInvalidate('therapists');
    res.json({ ok: true, id });
  } catch (e) { console.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

router.post('/api/admin/testimonials', requireAuth, requireAdmin, async (req, res) => {
  try {
    const t = req.body;
    const id = t.id || uuidv4();
    const isActive = t.isActive !== undefined ? (t.isActive ? 1 : 0) : (t.is_active !== undefined ? (t.is_active ? 1 : 0) : 1);
    const sortOrder = t.sortOrder ?? t.sort_order ?? 0;
    await pool.query(
      `INSERT INTO testimonials (id, name, role, text, image, is_active, sort_order)
       VALUES (?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE name=VALUES(name), role=VALUES(role), text=VALUES(text),
         image=VALUES(image), is_active=VALUES(is_active), sort_order=VALUES(sort_order)`,
      [id, t.name||'', t.role||'', t.text||'', t.image||'', isActive, sortOrder]
    );
    cacheInvalidate('testimonials');
    res.json({ ok: true, id });
  } catch (e) { console.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// ── Branch migration ──────────────────────────────────────────────────────────

router.post('/api/admin/migrate-branches', requireAuth, requireAdmin, async (req, res) => {
  try {
    const VALID = ['DAQQI','TAGAMOA','ONLINE_EGYPT','ONLINE_SAUDI','ONLINE_ABROAD','OTHER'];
    const normBranch = (v) => v ? String(v).toUpperCase().replace(/[-\s]/g, '_') : null;
    const [rows] = await pool.query(
      `SELECT id, crm_json FROM leads WHERE (branch IS NULL OR branch = '') AND crm_json IS NOT NULL`
    );
    let fixed = 0;
    const fix1Ids = [], fix1Vals = [];
    for (const row of rows) {
      let crmData = {};
      try { crmData = typeof row.crm_json === 'string' ? JSON.parse(row.crm_json) : (row.crm_json || {}); } catch {}
      const rawBranch = crmData.branch || null;
      const norm = normBranch(rawBranch);
      if (norm && VALID.includes(norm)) { fix1Ids.push(row.id); fix1Vals.push(norm); fixed++; }
    }
    if (fix1Ids.length > 0) {
      const caseWhen = fix1Ids.map(() => 'WHEN ? THEN ?').join(' ');
      const caseParams = fix1Ids.flatMap((rowId, i) => [rowId, fix1Vals[i]]);
      await pool.query(
        `UPDATE leads SET branch = CASE id ${caseWhen} END WHERE id IN (${fix1Ids.map(() => '?').join(',')})`,
        [...caseParams, ...fix1Ids]
      );
    }
    res.json({ ok: true, fixedFromCrmData: fixed, total: rows.length });
  } catch (e) { console.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// ── Payments reporting ────────────────────────────────────────────────────────

router.get('/api/admin/payments', requireAuth, requireAdminOrStaff, async (req, res) => {
  try {
    const { startDate, endDate, channel, paymentType } = req.query;
    const managerRoles = new Set(['MANAGER','ADMIN','ACCOUNTANT','DAQQI_MANAGER']);
    const isManagerRole = req.staffRecord && managerRoles.has((req.staffRecord.role || '').toUpperCase());
    let sql = `SELECT p.*, s.name AS subscriber_name, s.phone AS subscriber_phone, s.client_code AS subscriber_client_code
               FROM payments p LEFT JOIN subscribers s ON s.id = p.subscriber_id WHERE 1`;
    const params = [];
    if (startDate)   { sql += ' AND p.date >= ?';           params.push(startDate); }
    if (endDate)     { sql += ' AND p.date <= ?';           params.push(endDate); }
    if (channel)     { sql += ' AND p.payment_method = ?';  params.push(channel); }
    if (paymentType) { sql += ' AND p.payment_type = ?';    params.push(String(paymentType).toUpperCase()); }
    const { branch: branchFilter } = req.query;
    if (branchFilter) { sql += ' AND p.branch = ?'; params.push(String(branchFilter).toUpperCase()); }
    if (req.staffRecord && !req.isSuperAdmin && !isManagerRole) {
      sql += ' AND (p.staff_id = ? OR p.subscriber_id IN (SELECT id FROM subscribers WHERE assigned_sales_id = ? OR assigned_cs_id = ?))';
      params.push(req.staffRecord.id, req.staffRecord.id, req.staffRecord.id);
    }
    sql += ' ORDER BY p.date DESC LIMIT 2000';
    const [rows] = await pool.query(sql, params);
    res.json(rows.map(p => {
      const d = p.date;
      const dateStr = d instanceof Date ? d.toISOString().slice(0,10) : String(d||'').slice(0,10);
      return {
        id: p.id,
        subscriberId: p.subscriber_id,
        subscriberName: p.subscriber_name || '',
        subscriberPhone: p.subscriber_phone || '',
        subscriberClientCode: p.subscriber_client_code || null,
        courseId: p.course_id || null,
        bundleId: p.bundle_id || null,
        amount: Number(p.amount) || 0,
        currency: p.currency || 'EGP',
        paymentType: (p.payment_type || 'other').toLowerCase(),
        paymentMethod: p.payment_method || null,
        transactionId: p.transaction_id || null,
        isInstallment: !!p.is_installment,
        note: p.note || null,
        at: dateStr,
        status: p.status || 'paid',
        staffId: p.staff_id || null,
        staffName: p.staff_name || null,
        fromAccountNumber: p.from_account || null,
        source: p.source || null,
        itemTitle: p.item_title || null,
        certType: p.cert_type || null,
        branch: p.branch || null,
      };
    }));
  } catch (e) { console.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

router.get('/api/admin/payments/review', requireAuth, requireAdminOrStaff, async (req, res) => {
  try {
    const { status, paymentType, staffId, source, branch, dateFrom, dateTo, search, page = 1, limit: qLimit = 100 } = req.query;
    const pageNum = Math.max(1, parseInt(page) || 1);
    const pageSize = Math.min(200, parseInt(qLimit) || 100);
    const offset = (pageNum - 1) * pageSize;
    let where = '1=1';
    const params = [];
    if (status && status !== 'all') {
      if (status === 'paid') { where += ` AND (p.status = 'paid' OR p.status IS NULL)`; }
      else { where += ` AND p.status = ?`; params.push(status); }
    }
    if (paymentType && paymentType !== 'all') { where += ` AND p.payment_type = ?`; params.push(paymentType.toUpperCase()); }
    if (staffId)  { where += ` AND p.staff_id = ?`; params.push(staffId); }
    if (source && source !== 'all') { where += ` AND p.source = ?`; params.push(source); }
    if (branch && branch !== 'all') {
      const branchId = String(branch).trim().toUpperCase().replace(/[-\s]/g, '_');
      if (branchId === 'DAQQI') { where += ` AND p.branch IN ('DAQQI','DQI')`; }
      else { where += ` AND p.branch = ?`; params.push(branchId); }
    }
    if (dateFrom) { where += ` AND p.date >= ?`; params.push(dateFrom); }
    if (dateTo)   { where += ` AND p.date <= ?`; params.push(dateTo); }
    if (search) {
      where += ` AND (s.name LIKE ? OR s.phone LIKE ? OR p.transaction_id LIKE ? OR p.item_title LIKE ?)`;
      const q = `%${search}%`;
      params.push(q, q, q, q);
    }
    const managerRoles = new Set(['MANAGER','ADMIN','ACCOUNTANT','DAQQI_MANAGER','RECEPTION_DAQQI']);
    const isManagerRole = req.staffRecord && managerRoles.has((req.staffRecord.role || '').toUpperCase());
    if (req.staffRecord && !req.isSuperAdmin && !isManagerRole) {
      where += ` AND (p.staff_id = ? OR p.subscriber_id IN (SELECT id FROM subscribers WHERE assigned_sales_id = ? OR assigned_cs_id = ?))`;
      params.push(req.staffRecord.id, req.staffRecord.id, req.staffRecord.id);
    }
    const countParams = [...params];
    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) AS total FROM payments p LEFT JOIN subscribers s ON s.id = p.subscriber_id WHERE ${where}`,
      countParams
    );
    const dataParams = [...params, pageSize, offset];
    const [rows] = await pool.query(
      `SELECT p.*, s.name AS subscriber_name, s.phone AS subscriber_phone,
              s.client_code AS subscriber_client_code, s.email AS subscriber_email,
              c.title_ar AS course_title_ar, c.title AS course_title
       FROM payments p
       LEFT JOIN subscribers s ON s.id = p.subscriber_id
       LEFT JOIN courses c ON c.id = p.course_id
       WHERE ${where}
       ORDER BY p.date DESC, p.id DESC
       LIMIT ? OFFSET ?`,
      dataParams
    );
    let onlineOrders = [];
    if ((!staffId || source === 'paymob') && (!branch || branch === 'all')) {
      let oWhere = `status = 'paid'`;
      const oParams = [];
      if (dateFrom) { oWhere += ` AND DATE(created_at) >= ?`; oParams.push(dateFrom); }
      if (dateTo)   { oWhere += ` AND DATE(created_at) <= ?`; oParams.push(dateTo); }
      if (search)   { oWhere += ` AND (customer_name LIKE ? OR customer_email LIKE ?)`; oParams.push(`%${search}%`, `%${search}%`); }
      if (paymentType && paymentType !== 'all') { oWhere += ` AND type = ?`; oParams.push(paymentType.toLowerCase()); }
      const includeOnline = (!status || status === 'all' || status === 'paid') && (!source || source === 'all' || source === 'paymob');
      if (includeOnline && pageNum === 1) {
        try {
          const [oRows] = await pool.query(
            `SELECT id, customer_name, customer_email, customer_phone, amount, currency, type AS payment_type,
                    item_title, transaction_id, payment_method, created_at AS date, 'paid' AS status, 'paymob' AS source
             FROM orders WHERE ${oWhere} ORDER BY created_at DESC LIMIT 200`,
            oParams
          );
          onlineOrders = oRows.map(o => ({
            id: o.id, subscriberId: null, subscriberName: o.customer_name || '',
            subscriberPhone: o.customer_phone || '', subscriberEmail: o.customer_email || '',
            subscriberClientCode: null, courseId: null, bundleId: null,
            amount: Number(o.amount) || 0, currency: o.currency || 'EGP',
            paymentType: (o.payment_type || 'course').toLowerCase(),
            paymentMethod: o.payment_method || 'paymob',
            transactionId: o.transaction_id || null, isInstallment: false,
            note: null, at: (() => { const d = o.date; return d instanceof Date ? d.toISOString().slice(0,10) : String(d||'').slice(0,10); })(),
            status: 'paid', staffId: null, staffName: 'موقع (أونلاين)', fromAccountNumber: null,
            source: 'paymob', itemTitle: o.item_title || null, certType: null,
            courseTitleAr: null, courseTitle: null,
          }));
        } catch (_) {}
      }
    }
    const mappedRows = rows.map(p => {
      const d = p.date;
      const dateStr = d instanceof Date ? d.toISOString().slice(0,10) : String(d||'').slice(0,10);
      return {
        id: p.id, subscriberId: p.subscriber_id,
        subscriberName: p.subscriber_name || '', subscriberPhone: p.subscriber_phone || '',
        subscriberEmail: p.subscriber_email || '', subscriberClientCode: p.subscriber_client_code || null,
        courseId: p.course_id || null, bundleId: p.bundle_id || null,
        amount: Number(p.amount) || 0, currency: p.currency || 'EGP',
        paymentType: (p.payment_type || 'other').toLowerCase(),
        paymentMethod: p.payment_method || null,
        transactionId: p.transaction_id || null, isInstallment: !!p.is_installment,
        note: p.note || null, at: dateStr,
        status: p.status || 'paid',
        staffId: p.staff_id || null, staffName: p.staff_name || null,
        fromAccountNumber: p.from_account || null,
        source: p.source || null,
        itemTitle: p.item_title || null, certType: p.cert_type || null,
        courseTitleAr: p.course_title_ar || null, courseTitle: p.course_title || null,
      };
    });
    const [typeSummary] = await pool.query(
      `SELECT p.payment_type,
              SUM(CASE WHEN (p.status='paid' OR p.status IS NULL) AND p.currency='EGP' THEN p.amount ELSE 0 END) AS total_egp,
              COUNT(*) AS count,
              SUM(CASE WHEN p.status='pending' THEN 1 ELSE 0 END) AS pending_count
       FROM payments p LEFT JOIN subscribers s ON s.id = p.subscriber_id
       WHERE ${where}
       GROUP BY p.payment_type`,
      countParams
    );
    res.json({
      total: Number(total),
      page: pageNum,
      pageSize,
      rows: [...mappedRows, ...onlineOrders],
      typeSummary: typeSummary.map(t => ({
        paymentType: (t.payment_type || 'other').toLowerCase(),
        totalEGP: Number(t.total_egp) || 0,
        count: Number(t.count) || 0,
        pendingCount: Number(t.pending_count) || 0,
      })),
    });
  } catch (e) { console.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

module.exports = router;
