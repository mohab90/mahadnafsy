'use strict';

// The public check of a certificate, whichever kind it is.
//
// «في موقع العملاء … ايقونة البحث عن شهادة يكتب كود الشهادة تفتح توثيقها … ويكون بيشمل اي شهادة بتطلع
// من السيستم وكله ليه كود» (15 Oct 2026). Two kinds are issued here and both carry a code:
//   course    the institute's own certificate of a completed course (course_completions)
//   external  a certificate the institute arranges with another body — Ain Shams, social solidarity,
//             the National Council, the American Board … (certificate_requests)
// The code is the credential, as on any certificate: it opens the check and nothing else — no id
// number, no phone, no payment.

const ISSUER = 'معهد الدراسات النفسية';

const EXTERNAL_LABEL = Object.freeze({
  SOCIAL_SOLIDARITY: 'شهادة التضامن الاجتماعي',
  AIN_SHAMS: 'شهادة جامعة عين شمس',
  EXPERIENCE_EXTERNAL: 'شهادة الخبرة',
  PRACTICE_EXTERNAL: 'شهادة التطبيقين',
  NATIONAL_COUNCIL: 'شهادة المجلس الوطني',
  AMERICAN_BOARD: 'شهادة البورد الأمريكي',
  INSTITUTE: 'شهادة المعهد',
  OTHER: 'شهادة',
});
// Issued (or beyond): the certificate exists. Before that it is only being prepared.
const ISSUED_STATUSES = new Set(['ISSUED', 'SHIPPED', 'AT_BRANCH', 'DELIVERED']);
const STATUS_TEXT = Object.freeze({
  PENDING: 'قيد المراجعة', PRICED: 'قيد المراجعة', PAID: 'قيد الإصدار', IN_PROGRESS: 'قيد الإصدار', NOT_SENT: 'قيد الإصدار',
  RETURNED: 'مرتجعة للمعهد',
});

/** What a code is allowed to look like before it touches the database. */
const cleanCode = value => String(value || '').trim().toUpperCase().replace(/\s+/g, '').slice(0, 60);

async function verifyCertificate(db, rawCode) {
  const code = cleanCode(rawCode);
  if (code.length < 6 || !/^[A-Z0-9_-]+$/.test(code)) return null;

  const [[course]] = await db.query(
    `SELECT cc.certificate_code, cc.completed_at, cc.status, s.name AS name_ar, s.name_en,
            COALESCE(c.title, b.title) AS course_ar, COALESCE(c.title_en, b.title_en) AS course_en, COALESCE(c.hours, b.hours) AS hours_count,
            (b.id IS NOT NULL AND c.id IS NULL) AS is_track
       FROM course_completions cc
       JOIN subscribers s ON s.id = cc.subscriber_id AND s.tenant_id = cc.tenant_id
       LEFT JOIN courses c ON c.id = cc.course_id AND c.tenant_id = cc.tenant_id
       LEFT JOIN bundles b ON b.id = cc.course_id AND b.tenant_id = cc.tenant_id
      WHERE cc.certificate_code = ? AND cc.deleted_at IS NULL AND (c.id IS NOT NULL OR b.id IS NOT NULL) LIMIT 1`, [code]);
  if (course) {
    return {
      kind: 'course', code: course.certificate_code, state: course.status === 'active' ? 'valid' : 'revoked',
      holderAr: course.name_ar || '', holderEn: course.name_en || '',
      title: Number(course.is_track) ? 'شهادة إتمام مسار' : 'شهادة إتمام كورس', titleEn: 'Certificate of Achievement',
      subjectAr: course.course_ar || '', subjectEn: course.course_en || '',
      hours: Number(course.hours_count) > 0 ? +Number(course.hours_count).toFixed(2) : null,
      issuedAt: course.completed_at, issuer: ISSUER,
    };
  }

  const [[external]] = await db.query(
    `SELECT cr.certificate_code, cr.type, cr.custom_name, cr.status, cr.issued_at, cr.requested_at,
            COALESCE(NULLIF(cr.name_ar, ''), s.name) AS name_ar, COALESCE(NULLIF(cr.name_en, ''), s.name_en) AS name_en,
            c.title AS course_ar, c.title_en AS course_en
       FROM certificate_requests cr
       LEFT JOIN subscribers s ON s.id = cr.subscriber_id AND s.tenant_id = cr.tenant_id
       LEFT JOIN courses c ON c.id = cr.course_id AND c.tenant_id = cr.tenant_id
      WHERE cr.certificate_code = ? LIMIT 1`, [code]);
  if (external) {
    const issued = ISSUED_STATUSES.has(external.status);
    return {
      kind: 'external', code: external.certificate_code, state: issued ? 'valid' : 'pending',
      statusText: issued ? null : (STATUS_TEXT[external.status] || 'قيد الإصدار'),
      holderAr: external.name_ar || '', holderEn: external.name_en || '',
      title: String(external.custom_name || '').trim() || EXTERNAL_LABEL[external.type] || 'شهادة', titleEn: null,
      subjectAr: external.course_ar || '', subjectEn: external.course_en || '', hours: null,
      issuedAt: issued ? (external.issued_at || external.requested_at) : null, issuer: ISSUER,
    };
  }
  return null;
}

module.exports = { verifyCertificate, cleanCode, ISSUER, EXTERNAL_LABEL, ISSUED_STATUSES };
