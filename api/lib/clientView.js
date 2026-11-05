'use strict';

/**
 * One reading of what a client holds, shared by every route that shows it (clientView, slice 1 — 5 Nov 2026).
 *
 * "What a client holds" is the active enrollments: the courses opened for them (with the kind of access), and the tracks (bundles) they were opened through.
 * The staff lists and the single-client profile each carried their own copy of this mapping; they now read it here, so a change to it is made once.
 * Slice 1: what a client holds (loadHoldings). Slice 2: the client's certificate requests (loadCertificateRequests), which three admin routes each mapped by hand.
 * The rest of the client's picture (payments, completions, instalment plans, balances) is still assembled by each route, and moves in later slices one at a
 * time, each compared with the old route's answer before the next.
 */

const { pool } = require('./db');
const { certificateDue } = require('./certificatePricing');
const { certificatePricing } = require('./certificatePayments');
const { safeIsoString, safeDateOnly } = require('./dates');
const { resolvePaymentExecutors } = require('./paymentExecutor');

/**
 * For each subscriber id: { ids, bundleIds, access, withBundles }.
 *   ids         course ids, each once, in row order
 *   bundleIds   track ids, each once, in row order
 *   access      { [courseId]: 'full' | { mode: 'limited', lectureLimit } }
 *   withBundles course ids plus `bundle:<id>` for an enrollment that has a track and no course — what the single-client profile lists as enrolledCourseIds
 * A subscriber with no active enrollment has no entry.
 */
async function loadHoldings(tenantId, subscriberIds, db = pool) {
  if (!subscriberIds.length) return {};
  const [rows] = await db.query(
    `SELECT subscriber_id,course_id,bundle_id,access_type,lecture_limit FROM enrollments
     WHERE tenant_id=? AND status='active' AND subscriber_id IN (${subscriberIds.map(() => '?').join(',')})`,
    [tenantId, ...subscriberIds]
  );
  return rows.reduce((holdings, row) => {
    const entry = holdings[row.subscriber_id] ||= { ids: [], bundleIds: [], access: {}, withBundles: [] };
    // The track a course was opened through: the online screen shows a track booking as the track, not as the courses inside it.
    if (row.bundle_id && !entry.bundleIds.includes(String(row.bundle_id))) entry.bundleIds.push(String(row.bundle_id));
    const held = row.course_id ? String(row.course_id) : row.bundle_id ? `bundle:${row.bundle_id}` : null;
    if (held && !entry.withBundles.includes(held)) entry.withBundles.push(held);
    if (!row.course_id) return holdings;
    const courseId = String(row.course_id);
    if (!entry.ids.includes(courseId)) entry.ids.push(courseId);
    entry.access[courseId] = row.access_type === 'limited'
      ? { mode: 'limited', lectureLimit: Number(row.lecture_limit) || 1 } : 'full';
    return holdings;
  }, {});
}

/**
 * For each subscriber id: their certificate requests, newest first, as the staff screens show them (the shape of `extraCertificateRequests`).
 * The price is the price list's for the request's type and currency (certificateDue), not the stored column. A subscriber with none has no entry.
 */
async function loadCertificateRequests(tenantId, subscriberIds, db = pool) {
  if (!subscriberIds.length) return {};
  const [rows] = await db.query(
    `SELECT id, subscriber_id, course_id, type, custom_name, name_ar, name_en,
            nationality, id_number, status, price, paid_amount, currency, note,
            admin_note, requested_at, issued_at
     FROM certificate_requests
     WHERE tenant_id=? AND subscriber_id IN (${subscriberIds.map(() => '?').join(',')})
     ORDER BY requested_at DESC`,
    [tenantId, ...subscriberIds]
  );
  const pricing = await certificatePricing(db, tenantId);
  return rows.reduce((bySubscriber, request) => {
    (bySubscriber[request.subscriber_id] ||= []).push({
      id: request.id,
      courseId: request.course_id || undefined,
      type: String(request.type || 'OTHER').toLowerCase(),
      customName: request.custom_name || undefined,
      nameAr: request.name_ar || undefined,
      nameEn: request.name_en || undefined,
      nationality: request.nationality ? String(request.nationality).toLowerCase() : undefined,
      idNumber: request.id_number || undefined,
      status: String(request.status || 'PENDING').toLowerCase(),
      price: certificateDue(pricing, request) || undefined,
      paidAmount: request.paid_amount != null ? Number(request.paid_amount) : 0,
      currency: request.currency || undefined,
      requestedAt: safeIsoString(request.requested_at) || null,
      issuedAt: safeIsoString(request.issued_at) || undefined,
      note: request.note || undefined,
      adminNote: request.admin_note || undefined,
    });
    return bySubscriber;
  }, {});
}

const PAYMENT_COLUMNS = {
  full: 'id, subscriber_id, course_id, bundle_id, amount, currency, payment_type, payment_method, transaction_id, is_installment, course_expected, `date`, note, '
    + 'status, staff_id, staff_name, from_account, sender_name, source, item_title, cert_type, certificate_request_id, branch',
  slim: 'id, subscriber_id, course_id, bundle_id, amount, currency, payment_type, payment_method, transaction_id, is_installment, `date`, note, '
    + 'status, staff_id, staff_name, from_account, sender_name, source, item_title',
};

/**
 * For each subscriber id: their payments (not deleted), oldest first, as the staff screens show them (the shape of `paymentHistory`).
 *   shape      'full' — what the profile and the main lists send; 'slim' — the two lighter lists, without courseExpected, certType, certId and branch
 *   staffName  'executor' — who really took the money, resolved through the audit trail (resolvePaymentExecutors), as the lists show it;
 *              'recorded' — the name stored on the payment row, as the profile shows it; 'none' — null (the lite list does not resolve it)
 * A subscriber with no payment has no entry.
 */
async function loadPayments(tenantId, subscriberIds, { shape = 'full', staffName = 'executor' } = {}, db = pool) {
  if (!subscriberIds.length) return {};
  const [rows] = await db.query(
    `SELECT ${PAYMENT_COLUMNS[shape]}
     FROM payments
     WHERE tenant_id=? AND subscriber_id IN (${subscriberIds.map(() => '?').join(',')}) AND deleted_at IS NULL
     ORDER BY \`date\` ASC`,
    [tenantId, ...subscriberIds]
  );
  const executors = staffName === 'executor' ? await resolvePaymentExecutors(db, tenantId, rows) : new Map();
  return rows.reduce((bySubscriber, p) => {
    const payment = {
      id: p.id,
      amount: Number(p.amount) || 0,
      currency: p.currency || 'EGP',
      paymentType: (p.payment_type || 'other').toLowerCase(),
      paymentMethod: p.payment_method || null,
      transactionId: p.transaction_id || null,
      isInstallment: !!p.is_installment,
      courseId: p.course_id || null,
      bundleId: p.bundle_id || null,
      courseExpected: p.course_expected != null ? Number(p.course_expected) : undefined,
      note: p.note || null,
      at: safeDateOnly(p.date),
      status: p.status || 'paid',
      staffId: p.staff_id || null,
      staffName: staffName === 'recorded' ? (p.staff_name || null) : (executors.get(String(p.id)) ?? null),
      fromAccountNumber: p.from_account || null,
      senderName: p.sender_name || null,
      source: p.source || null,
      itemTitle: p.item_title || null,
      certType: p.cert_type || null,
      certId: p.certificate_request_id || null,
      branch: p.branch || null,
    };
    if (shape === 'slim') { delete payment.courseExpected; delete payment.certType; delete payment.certId; delete payment.branch; }
    (bySubscriber[p.subscriber_id] ||= []).push(payment);
    return bySubscriber;
  }, {});
}

/**
 * For each subscriber id: the certificates they earned (course_completions, not deleted), newest first, as the staff screens show them (the shape of `certificates`).
 *   printedBy  true — also who printed it (the profile shows it; the lists do not)
 * The title is the course's (Arabic first), or the track's when the completion is of a track. A subscriber with none has no entry.
 */
async function loadCompletions(tenantId, subscriberIds, { printedBy = false } = {}, db = pool) {
  if (!subscriberIds.length) return {};
  const [rows] = await db.query(
    `SELECT cc.id,cc.subscriber_id,cc.course_id,cc.certificate_code,cc.completed_at,cc.status,cc.version,cc.revoked_at,cc.revoke_reason,
            cc.printed_at,${printedBy ? 'cc.printed_by,' : ''}cc.print_count,cc.downloaded_at,cc.download_count,
            COALESCE(NULLIF(c.title_ar, ''), c.title, b.title) AS title, (b.id IS NOT NULL AND c.id IS NULL) AS is_track
     FROM course_completions cc
     LEFT JOIN courses c ON c.id=cc.course_id AND c.tenant_id=cc.tenant_id
     LEFT JOIN bundles b ON b.id=cc.course_id AND b.tenant_id=cc.tenant_id
     WHERE cc.tenant_id=? AND cc.deleted_at IS NULL AND cc.subscriber_id IN (${subscriberIds.map(() => '?').join(',')})
     ORDER BY cc.completed_at DESC`,
    [tenantId, ...subscriberIds]
  );
  return rows.reduce((bySubscriber, row) => {
    (bySubscriber[row.subscriber_id] ||= []).push({
      id: row.id,
      courseId: row.course_id,
      certificateNumber: row.certificate_code,
      issuedAt: safeIsoString(row.completed_at) || null,
      status: row.status || 'active',
      version: Number(row.version || 1),
      revokedAt: safeIsoString(row.revoked_at) || undefined,
      revokeReason: row.revoke_reason || undefined,
      title: row.title || undefined,
      isTrack: Boolean(Number(row.is_track)),
      printedAt: safeIsoString(row.printed_at) || undefined,
      ...(printedBy ? { printedBy: row.printed_by || undefined } : {}),
      printCount: Number(row.print_count) || 0,
      downloadedAt: safeIsoString(row.downloaded_at) || undefined,
      downloadCount: Number(row.download_count) || 0,
    });
    return bySubscriber;
  }, {});
}

module.exports = { loadHoldings, loadCertificateRequests, loadPayments, loadCompletions };
