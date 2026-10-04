'use strict';
const logger = require('../lib/logger');
const { hasPaidForCourse } = require('../lib/coursePaid');
const express = require('express');
const router  = express.Router();

const { pool } = require('../lib/db');
const { resolveSubscriberRow } = require('../lib/subscriberIdentity');
const { parseLimit } = require('../lib/helpers');
const { publishRealtimeEvent } = require('../lib/realtime');
const { getTenantSetting } = require('../lib/tenantSettings');
const { certificateTypeCodes, resolveCertificatePrice } = require('../lib/certificatePricing');
const { requireAuth, requireAdmin, requireAdminOrStaff, requirePermission } = require('../middleware/auth');
const { isString, isOneOf, validateBody } = require('../middleware/validate');
const { resolveClientContext } = require('../lib/clientContext');
const { actorName, logClientEvent } = require('../lib/clientHistory');
const { sanitize } = require('../lib/helpers');

const CERT_STATUSES = ['PENDING','PRICED','PAID','IN_PROGRESS','NOT_SENT','ISSUED','SHIPPED','AT_BRANCH','DELIVERED','RETURNED'];
const STATUS_AR = {
  PENDING: 'تحت المراجعة', PRICED: 'مسعّرة', PAID: 'مدفوعة', IN_PROGRESS: 'في الجهة المسئولة',
  NOT_SENT: 'لسه متبعتتش للجهة', ISSUED: 'جاهزة للشحن', SHIPPED: 'اتسلمت لشركة الشحن',
  AT_BRANCH: 'في الفرع', DELIVERED: 'العميل استلمها', RETURNED: 'مرتجع',
};
// A request's type is any code «تسعير الشهادات» lists (certificateTypeCodes).
const loadPricing = async tenantId => {
  const content = await getTenantSetting('content', { tenantId, fallback: {} });
  try { return JSON.parse(content.extra_cert_pricing || '{}') || {}; } catch { return {}; }
};
const CERT_NATS  = ['EGYPTIAN','NON_EGYPTIAN_EGYPT','SAUDI_RESIDENT','INTERNATIONAL'];
const POST_PAYMENT_STATUSES = new Set(['PAID','IN_PROGRESS','NOT_SENT','ISSUED','SHIPPED','AT_BRANCH','DELIVERED','RETURNED']);
const CERT_TRANSITIONS = new Map([
  ['PENDING', new Set(['PRICED', 'PAID'])],
  ['PRICED', new Set(['PAID'])],
  ['PAID', new Set(['IN_PROGRESS'])],
  ['IN_PROGRESS', new Set(['NOT_SENT', 'ISSUED'])],
  ['NOT_SENT', new Set(['IN_PROGRESS', 'ISSUED'])],
  ['ISSUED', new Set(['SHIPPED', 'AT_BRANCH', 'DELIVERED'])],
  // «زر اتسلم لشركة الشحن … ومنها زر تاني استلم للعميل او حصل مرتجع».
  ['SHIPPED', new Set(['AT_BRANCH', 'DELIVERED', 'RETURNED'])],
  ['RETURNED', new Set(['SHIPPED', 'AT_BRANCH', 'DELIVERED'])],
  ['AT_BRANCH', new Set(['DELIVERED'])],
  ['DELIVERED', new Set()],
]);

// «عمود اسمه جهه التحصيل»: the box the money went into. Set on the request, or
// the linked payment's box, or — for the 646 requests imported from the Dokki
// sheet — read back from the note the import wrote («2026-09-17 — 400 — خزينة
// الدقي — مستند …»).
const NOTE_BOX = /\d{4}-\d{2}-\d{2} — [\d.,]+ — ([^—|]+?) — /g;
function collectionPartyOf(row) {
  if (row.collection_party) return row.collection_party;
  if (row.linked_method) return row.linked_method;
  const boxes = [...String(row.note || '').matchAll(NOTE_BOX)].map(match => match[1].trim()).filter(Boolean);
  return [...new Set(boxes)].join('، ') || null;
}

// Paid is paid whether the payment row is here or the money was taken before
// the system: 254 requests imported «مدفوعة» from the sheet have no payment row,
// and every status change on them answered «A paid payment linked to this
// certificate request is required».
const fullyPaid = (request, linkedPayment) =>
  !!linkedPayment || (Number(request.price) > 0 && Number(request.paid_amount) >= Number(request.price));

// ── Certificate Requests admin routes ─────────────────────────────────────────
// The certificates screen reads this, not the clients it happens to have
// loaded: that list is paged, so requests of clients past the first page never
// showed, and a desk without the whole client book saw none.
router.get('/api/admin/certificate-requests', requireAuth, requireAdminOrStaff, requirePermission('manage_certificates'), async (req, res) => {
  try {
    const limit = parseLimit(req.query.limit, 3000, 5000);
    const [rows] = await pool.query(
      `SELECT cr.id, cr.subscriber_id, cr.course_id, cr.type, cr.custom_name, cr.name_ar, cr.name_en, cr.nationality,
              cr.id_number, cr.status, cr.price, cr.paid_amount, cr.currency, cr.note, cr.admin_note,
              cr.collection_party, cr.requested_at, cr.issued_at,
              s.name AS subscriber_name, s.phone AS subscriber_phone, s.client_code, s.branch,
              COALESCE(s.assigned_cs_name, s.assigned_sales_name) AS owner_name,
              COALESCE(NULLIF(c.title_ar, ''), c.title) AS course_title,
              (SELECT MAX(p.payment_method) FROM payments p
                WHERE p.certificate_request_id=cr.id AND p.tenant_id=cr.tenant_id
                  AND p.status='paid' AND p.deleted_at IS NULL) AS linked_method
         FROM certificate_requests cr
         LEFT JOIN subscribers s ON s.id = cr.subscriber_id AND s.tenant_id=cr.tenant_id AND s.deleted_at IS NULL
         LEFT JOIN courses c ON c.id = cr.course_id AND c.tenant_id=cr.tenant_id AND c.deleted_at IS NULL
        WHERE cr.tenant_id=?
        ORDER BY cr.requested_at DESC LIMIT ?`, [req.tenantId, limit]);
    res.json(rows.map(row => {
      const price = row.price != null ? Number(row.price) : null;
      const paid = Number(row.paid_amount) || 0;
      return {
        id: row.id,
        subscriberId: row.subscriber_id,
        subscriberName: row.subscriber_name || '',
        subscriberPhone: row.subscriber_phone || '',
        clientCode: row.client_code || null,
        branch: row.branch || null,
        ownerName: row.owner_name || null,
        courseId: row.course_id || null,
        courseTitle: row.course_title || null,
        type: String(row.type || 'OTHER').toLowerCase(),
        customName: row.custom_name || null,
        nameAr: row.name_ar || null,
        nameEn: row.name_en || null,
        nationality: row.nationality ? String(row.nationality).toLowerCase() : null,
        idNumber: row.id_number || null,
        status: String(row.status || 'PENDING').toLowerCase(),
        price,
        paid,
        remaining: price != null ? Math.max(0, price - paid) : null,
        currency: row.currency || 'EGP',
        collectionParty: collectionPartyOf(row),
        note: row.note || null,
        adminNote: row.admin_note || null,
        requestedAt: row.requested_at,
        issuedAt: row.issued_at,
      };
    }));
  } catch (e) { logger.error('[route]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// «زر تعديل للشهادات». What a request says — the name on it, its type, course,
// nationality, price, what was paid before the system, the box it was paid into
// and the desk's notes. The price stays fixed once a payment row is linked, as
// it always did; without one (the imported requests) it is the desk's to correct.
router.put('/api/admin/certificate-requests/:id/details', requireAuth, requireAdminOrStaff, requirePermission('manage_certificates'), async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const b = req.body || {};
    await conn.beginTransaction();
    const [[request]] = await conn.query(
      'SELECT * FROM certificate_requests WHERE id=? AND tenant_id=? LIMIT 1 FOR UPDATE', [req.params.id, req.tenantId]);
    if (!request) { await conn.rollback(); return res.status(404).json({ error: 'Not found' }); }
    const [[linkedPayment]] = await conn.query(
      `SELECT p.id FROM payments p WHERE p.certificate_request_id=? AND p.tenant_id=? AND p.status='paid' AND p.deleted_at IS NULL LIMIT 1`,
      [request.id, req.tenantId]);
    const sets = [];
    const params = [];
    const changed = [];
    const text = (key, column, label, max = 255) => {
      if (b[key] === undefined) return;
      const value = sanitize(String(b[key] ?? ''), max).trim() || null;
      if ((value || null) === (request[column] || null)) return;
      sets.push(`${column}=?`); params.push(value); changed.push(label);
    };
    text('nameAr', 'name_ar', 'الاسم بالعربي');
    text('nameEn', 'name_en', 'الاسم بالإنجليزي');
    text('customName', 'custom_name', 'اسم الشهادة');
    text('idNumber', 'id_number', 'رقم البطاقة', 50);
    text('collectionParty', 'collection_party', 'جهة التحصيل', 160);
    text('adminNote', 'admin_note', 'الملاحظات', 2000);
    if (b.type !== undefined) {
      const type = String(b.type || '').toUpperCase();
      if (!certificateTypeCodes(await loadPricing(req.tenantId)).has(type)) { await conn.rollback(); return res.status(400).json({ error: 'نوع شهادة غير معروف' }); }
      if (type !== String(request.type).toUpperCase()) { sets.push('type=?'); params.push(type); changed.push('نوع الشهادة'); }
    }
    if (b.nationality !== undefined) {
      const nationality = b.nationality ? String(b.nationality).toUpperCase() : null;
      if (nationality && !CERT_NATS.includes(nationality)) { await conn.rollback(); return res.status(400).json({ error: 'جنسية غير معروفة' }); }
      if (nationality !== (request.nationality || null)) { sets.push('nationality=?'); params.push(nationality); changed.push('الجنسية'); }
    }
    if (b.courseId !== undefined) {
      const courseId = String(b.courseId || '').trim() || null;
      if (courseId !== (request.course_id || null)) { sets.push('course_id=?'); params.push(courseId); changed.push('الكورس'); }
    }
    for (const [key, column, label] of [['price', 'price', 'السعر'], ['paidAmount', 'paid_amount', 'المدفوع']]) {
      if (b[key] === undefined || b[key] === '') continue;
      const value = Number(b[key]);
      if (!Number.isFinite(value) || value < 0) { await conn.rollback(); return res.status(400).json({ error: `${label} لازم يكون رقم` }); }
      if (value === Number(request[column] || 0)) continue;
      if (linkedPayment) { await conn.rollback(); return res.status(409).json({ error: `${label} مربوط بدفعة متسجلة — بيتعدل من الدفعة نفسها` }); }
      sets.push(`${column}=?`); params.push(value); changed.push(label);
    }
    if (!sets.length) { await conn.rollback(); return res.json({ ok: true, changed: [] }); }
    await conn.query(`UPDATE certificate_requests SET ${sets.join(', ')} WHERE id=? AND tenant_id=?`, [...params, request.id, req.tenantId]);
    if (request.subscriber_id) {
      await logClientEvent(conn, {
        tenantId: req.tenantId, subscriberId: request.subscriber_id, action: 'certificate_edited', actor: actorName(req),
        label: `تعديل شهادة: ${changed.join('، ')}`,
      });
    }
    await conn.commit();
    res.json({ ok: true, changed });
  } catch (e) {
    await conn.rollback().catch(() => {});
    if (e?.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'فيه طلب شهادة مفتوح بنفس النوع والكورس للعميل ده' });
    logger.error('[certificate-details]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  } finally { conn.release(); }
});

router.post('/api/admin/certificate-requests', requireAuth, requireAdminOrStaff, requirePermission('manage_certificates'), async (req, res) => {
  let conn;
  try {
    const b = req.body || {};
    const subscriberId = String(b.subscriberId || '').trim();
    const courseId = String(b.courseId || '').trim();
    const type = String(b.type || '').toUpperCase();
    const nationality = b.nationality ? String(b.nationality).toUpperCase() : null;
    if (!subscriberId || !courseId) return res.status(400).json({ error: 'subscriberId and courseId are required' });
    const pricingConfig = await loadPricing(req.tenantId);
    if (!certificateTypeCodes(pricingConfig).has(type)) return res.status(400).json({ error: 'Invalid certificate type' });
    if (nationality && !CERT_NATS.includes(nationality)) return res.status(400).json({ error: 'Invalid nationality' });

    conn = await pool.getConnection();
    await conn.beginTransaction();
    const [[eligible]] = await conn.query(
      `SELECT s.id
         FROM subscribers s
         JOIN enrollments e ON e.subscriber_id=s.id AND e.course_id=? AND e.tenant_id=s.tenant_id
          AND e.status='active' AND e.access_type='full'
         JOIN courses c ON c.id=e.course_id AND c.tenant_id=e.tenant_id AND c.deleted_at IS NULL
         JOIN course_completions cc ON cc.subscriber_id=s.id AND cc.course_id=e.course_id
          AND cc.tenant_id=s.tenant_id AND cc.status='active'
        WHERE s.id=? AND s.tenant_id=? AND s.deleted_at IS NULL
        LIMIT 1 FOR UPDATE`,
      [courseId, subscriberId, req.tenantId]
    );
    if (!eligible) {
      await conn.rollback();
      conn.release();
      conn = null;
      return res.status(409).json({ error: 'Subscriber must have full enrollment and an active course completion' });
    }
    const [[duplicate]] = await conn.query(
      `SELECT id FROM certificate_requests
        WHERE tenant_id=? AND subscriber_id=? AND course_id=? AND type=?
          AND status <> 'DELIVERED'
        LIMIT 1 FOR UPDATE`,
      [req.tenantId, subscriberId, courseId, type]
    );
    if (duplicate) {
      await conn.rollback();
      conn.release();
      conn = null;
      return res.status(409).json({ error: 'An active certificate request already exists', id: duplicate.id });
    }

    const suppliedPrice = b.price === undefined || b.price === null || b.price === '' ? null : Number(b.price);
    if (suppliedPrice !== null && (!Number.isFinite(suppliedPrice) || suppliedPrice < 0)) {
      await conn.rollback();
      conn.release();
      conn = null;
      return res.status(400).json({ error: 'price must be a non-negative number' });
    }
    const resolved = resolveCertificatePrice({ type, nationality, pricingConfig });
    const finalPrice = suppliedPrice === null ? resolved.price : suppliedPrice;
    const finalCurrency = String(b.currency || resolved.currency || 'EGP').toUpperCase();
    if (!/^[A-Z]{3}$/.test(finalCurrency)) {
      await conn.rollback();
      conn.release();
      conn = null;
      return res.status(400).json({ error: 'currency must be a 3-letter ISO code' });
    }
    const initialStatus = Number(finalPrice) > 0 ? 'PRICED' : 'PENDING';
    const requestId = require('crypto').randomUUID();
    await conn.query(
      `INSERT INTO certificate_requests
         (id, subscriber_id, course_id, type, custom_name, name_ar, name_en, nationality,
          id_number, status, price, paid_amount, currency, note, tenant_id, requested_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, NOW())`,
      [requestId, subscriberId, courseId, type, b.customName || null, b.nameAr || null, b.nameEn || null,
       nationality, b.idNumber || null, initialStatus, finalPrice, finalCurrency, b.note || null, req.tenantId]
    );
    await conn.commit();
    conn.release();
    conn = null;
    res.status(201).json({
      ok: true,
      id: requestId,
      status: initialStatus.toLowerCase(),
      price: finalPrice,
      paidAmount: 0,
      currency: finalCurrency,
    });
  } catch (e) {
    if (conn) {
      try { await conn.rollback(); } catch {}
      conn.release();
    }
    logger.error('[certificate-create]', e.message);
    if (e?.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'An active certificate request already exists' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.patch('/api/admin/certificate-requests/:id',
  requireAuth, requireAdminOrStaff, requirePermission('manage_certificates'),
  validateBody({
    status: v => (isString(v, 30) && isOneOf((v || '').toUpperCase(), CERT_STATUSES)) || `status must be one of: ${CERT_STATUSES.join(', ')}`,
  }),
  async (req, res) => {
  let conn;
  try {
    const { status, notes, price, currency, issued_at } = req.body;
    if (!status) return res.status(400).json({ error: 'status required' });
    const normalizedStatus = status.toUpperCase();
    const normalizedPrice = price === undefined ? undefined : Number(price);
    if (normalizedPrice !== undefined && (!Number.isFinite(normalizedPrice) || normalizedPrice < 0)) {
      return res.status(400).json({ error: 'price must be a non-negative number' });
    }
    const normalizedCurrency = currency ? String(currency).toUpperCase() : undefined;
    if (normalizedCurrency && !/^[A-Z]{3}$/.test(normalizedCurrency)) {
      return res.status(400).json({ error: 'currency must be a 3-letter ISO code' });
    }

    conn = await pool.getConnection();
    await conn.beginTransaction();
    const [[request]] = await conn.query(
      'SELECT * FROM certificate_requests WHERE id=? AND tenant_id=? LIMIT 1 FOR UPDATE',
      [req.params.id, req.tenantId]
    );
    if (!request) {
      await conn.rollback();
      conn.release();
      conn = null;
      return res.status(404).json({ error: 'Not found' });
    }
    const currentStatus = String(request.status).toUpperCase();
    if (currentStatus !== normalizedStatus && !CERT_TRANSITIONS.get(currentStatus)?.has(normalizedStatus)) {
      await conn.rollback();
      conn.release();
      conn = null;
      return res.status(409).json({ error: `Invalid certificate status transition: ${currentStatus} -> ${normalizedStatus}` });
    }
    const [[linkedPayment]] = await conn.query(
      `SELECT id FROM payments
        WHERE certificate_request_id=? AND subscriber_id=? AND tenant_id=?
          AND status='paid' AND deleted_at IS NULL
        LIMIT 1`,
      [request.id, request.subscriber_id, req.tenantId]
    );
    if (POST_PAYMENT_STATUSES.has(normalizedStatus) && !fullyPaid(request, linkedPayment)) {
        await conn.rollback();
        conn.release();
        conn = null;
        return res.status(409).json({ error: 'الشهادة لازم تكون مدفوعة الأول — سجّل الدفعة أو المدفوع قبل السيستم' });
    }
    if ((linkedPayment || POST_PAYMENT_STATUSES.has(currentStatus))
      && ((normalizedPrice !== undefined && Number(normalizedPrice) !== Number(request.price))
        || (normalizedCurrency && normalizedCurrency !== String(request.currency || '').toUpperCase()))) {
      await conn.rollback();
      conn.release();
      conn = null;
      return res.status(409).json({ error: 'Certificate price and currency are immutable after payment' });
    }

    const sets = ['status=?'];
    const params = [normalizedStatus];
    if (notes !== undefined) { sets.push('admin_note=?'); params.push(notes); }
    if (normalizedPrice !== undefined) { sets.push('price=?'); params.push(normalizedPrice); }
    if (normalizedCurrency) { sets.push('currency=?'); params.push(normalizedCurrency); }
    if (issued_at) { sets.push('issued_at=?'); params.push(issued_at); }
    params.push(req.params.id, req.tenantId);

    // Issued only while the course still stands. A refund revokes the
    // enrolment and the completion, and that still stops a certificate. What
    // no longer stops one is a completion that was never recorded: a Dokki
    // client attends in the branch, and a request imported from the sheet was
    // for a course finished before the system — 254 of them sat «مدفوعة».
    if (['ISSUED', 'SHIPPED', 'AT_BRANCH', 'DELIVERED', 'RETURNED'].includes(normalizedStatus) && request.course_id) {
      const [[standing]] = await conn.query(
        `SELECT
           EXISTS(SELECT 1 FROM enrollments e WHERE e.subscriber_id=? AND e.course_id=? AND e.tenant_id=? AND e.status<>'active')
             AND NOT EXISTS(SELECT 1 FROM enrollments e WHERE e.subscriber_id=? AND e.course_id=? AND e.tenant_id=? AND e.status='active') AS course_taken,
           EXISTS(SELECT 1 FROM course_completions cc WHERE cc.subscriber_id=? AND cc.course_id=? AND cc.tenant_id=? AND cc.status<>'active')
             AND NOT EXISTS(SELECT 1 FROM course_completions cc WHERE cc.subscriber_id=? AND cc.course_id=? AND cc.tenant_id=? AND cc.status='active') AS completion_revoked`,
        [request.subscriber_id, request.course_id, req.tenantId, request.subscriber_id, request.course_id, req.tenantId,
          request.subscriber_id, request.course_id, req.tenantId, request.subscriber_id, request.course_id, req.tenantId]
      );
      if (Number(standing?.course_taken) || Number(standing?.completion_revoked)) {
        await conn.rollback();
        conn.release();
        conn = null;
        return res.status(409).json({ error: 'الكورس اتشال من العميل أو اكتماله اتلغى (استرداد مثلاً) — مينفعش تطلع شهادة عليه' });
      }
    }
    await conn.query(`UPDATE certificate_requests SET ${sets.join(',')} WHERE id=? AND tenant_id=?`, params);
    if (currentStatus !== normalizedStatus && request.subscriber_id) {
      await logClientEvent(conn, {
        tenantId: req.tenantId, subscriberId: request.subscriber_id, action: 'certificate_status', actor: actorName(req),
        label: `شهادة: ${STATUS_AR[currentStatus] || currentStatus} ← ${STATUS_AR[normalizedStatus] || normalizedStatus}`,
      });
    }
    await conn.commit();
    conn.release();
    conn = null;
    // Lifecycle: notify the learner when their certificate is issued/delivered.
    if (['ISSUED', 'SHIPPED', 'AT_BRANCH', 'DELIVERED'].includes(normalizedStatus)) {
      setImmediate(async () => {
        try {
          const [[row]] = await pool.query(
            `SELECT s.name, s.email, s.phone, c.title AS course_title
             FROM certificate_requests cr
             LEFT JOIN subscribers s ON s.id = cr.subscriber_id AND s.tenant_id=cr.tenant_id
             LEFT JOIN courses c ON c.id = cr.course_id AND c.tenant_id=cr.tenant_id
             WHERE cr.id=? AND cr.tenant_id=? LIMIT 1`, [req.params.id, req.tenantId]);
          if (row?.email || row?.phone) {
            require('../lib/lifecycle').trigger(
              'certificate_ready',
              { name: row.name, email: row.email, phone: row.phone, courseTitle: row.course_title, tenantId: req.tenantId },
              { dedupeKey: `cert_ready:${req.params.id}` }
            );
            if (row.email) {
              publishRealtimeEvent('client:certificate-updated', {
                status: normalizedStatus,
                courseTitle: row.course_title,
                message: 'تم تحديث حالة الشهادة الخاصة بك.',
              }, { room: `user:${String(row.email).toLowerCase().trim()}` }).catch(() => {});
            }
          }
        } catch (e) { logger.warn('[lifecycle] certificate_ready failed:', e.message); }
      });
    }
    res.json({ ok: true });
  } catch (e) {
    if (conn) {
      try { await conn.rollback(); } catch {}
      conn.release();
    }
    logger.error('[certificate-update]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/api/admin/certificate-requests/:id', requireAuth, requireAdminOrStaff, requirePermission('manage_certificates'), async (req, res) => {
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();
    const [[request]] = await conn.query(
      'SELECT id, status FROM certificate_requests WHERE id=? AND tenant_id=? LIMIT 1 FOR UPDATE',
      [req.params.id, req.tenantId]
    );
    if (!request) {
      await conn.rollback();
      conn.release();
      conn = null;
      return res.status(404).json({ error: 'Not found' });
    }
    const [[linkedPayment]] = await conn.query(
      `SELECT id FROM payments
        WHERE certificate_request_id=? AND tenant_id=? AND deleted_at IS NULL
        LIMIT 1`,
      [req.params.id, req.tenantId]
    );
    if (linkedPayment || POST_PAYMENT_STATUSES.has(String(request.status).toUpperCase())) {
      await conn.rollback();
      conn.release();
      conn = null;
      return res.status(409).json({ error: 'Paid or financially linked certificate requests cannot be deleted' });
    }
    await conn.query('DELETE FROM certificate_requests WHERE id=? AND tenant_id=?', [req.params.id, req.tenantId]);
    await conn.commit();
    conn.release();
    conn = null;
    res.json({ ok: true });
  } catch (e) {
    if (conn) {
      try { await conn.rollback(); } catch {}
      conn.release();
    }
    logger.error('[certificate-delete]', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Customer certificate request → single source of truth = certificate_requests table ──
// (Previously the client wrote cert requests into crm_json.extraCertificateRequests, which the
//  admin never read → requests vanished. Now customers write to the same table the admin manages.)
/** May this client ask for a certificate: enrolled, completed, and paid for it (lib/coursePaid.js). */
async function certificateEligible(db, { tenantId, subscriberId, courseId }) {
  const [[enrolled]] = await db.query(
    `SELECT e.id
       FROM enrollments e
       JOIN course_completions cc ON cc.subscriber_id=e.subscriber_id AND cc.course_id=e.course_id AND cc.tenant_id=e.tenant_id AND cc.status='active'
      WHERE e.subscriber_id=? AND e.course_id=? AND e.tenant_id=? AND e.status='active' LIMIT 1`,
    [subscriberId, courseId, tenantId]
  );
  return Boolean(enrolled) && hasPaidForCourse(db, { tenantId, subscriberId, courseId });
}

router.post('/api/me/certificate-request', requireAuth, async (req, res) => {
  try {
    const tenantId = req.tenantId || req.user?.tenant_id || 'tenant-default';
    const sub = await resolveSubscriberRow(req, ['id']);
    if (!sub) return res.status(403).json({ error: 'not_subscribed' });
    const b = req.body || {};
    const pricingConfig = await loadPricing(tenantId);
    const type = certificateTypeCodes(pricingConfig).has(String(b.type || '').toUpperCase()) ? String(b.type).toUpperCase() : 'OTHER';
    const nationality = CERT_NATS.includes(String(b.nationality || '').toUpperCase()) ? String(b.nationality).toUpperCase() : null;
    if (!b.courseId) return res.status(400).json({ error: 'courseId required' });
    const eligible = await certificateEligible(pool, { tenantId, subscriberId: sub.id, courseId: b.courseId });
    if (!eligible) return res.status(409).json({ error: 'certificate_not_eligible', message: 'يجب دفع وإتمام الكورس أولاً' });
    const [[duplicate]] = await pool.query(
      `SELECT id FROM certificate_requests
        WHERE tenant_id=? AND subscriber_id=? AND course_id=? AND type=?
          AND status <> 'DELIVERED'
        LIMIT 1`,
      [tenantId, sub.id, b.courseId, type]
    );
    if (duplicate) {
      return res.status(409).json({ error: 'certificate_request_exists', id: duplicate.id });
    }

    const clientContext = await resolveClientContext(req);
    // No country means price by nationality, and if that cannot price it either
    // the row lands PENDING for an admin — never a refusal.
    const { price, currency, status } = resolveCertificatePrice({
      type, nationality, countryCode: clientContext.countryCode, pricingConfig,
    });
    const requestId = require('crypto').randomUUID();
    await pool.query(
      `INSERT INTO certificate_requests
         (id, subscriber_id, course_id, type, custom_name, name_ar, name_en, nationality, id_number, status, price, currency, note, tenant_id, requested_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [requestId, sub.id, b.courseId, type, b.customName || null, b.nameAr || null, b.nameEn || null,
       nationality, b.idNumber || null, status, price, currency,
       // Say so on the row when the country could not be resolved, so the admin
       // pricing a PENDING request knows this one was priced by nationality
       // alone rather than by where the customer actually was.
       [b.note, clientContext.locationResolved ? '' : 'الموقع الجغرافي غير محدد — التسعير بالجنسية']
         .filter(Boolean).join(' | ') || null,
       tenantId]
    );
    res.json({ ok: true, id: requestId, status: status.toLowerCase(), price, currency });
  } catch (e) {
    logger.error('[route]', e.message);
    if (e?.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'certificate_request_exists' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
module.exports.certificateEligible = certificateEligible;
