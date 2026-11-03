'use strict';

// «لما ادخل اسم العميل بالانجليزي مرة لازم يسمع في كل الشهادات وفي الحساب» (3 Nov 2026). The English name is the CLIENT's: subscribers.name_en. It used to be
// copied onto each certificate request (certificate_requests.name_en) and each institute certificate (course_completions.cert_name_en), filled only when blank, so
// a name corrected later stayed wrong on the copies. Now whoever types it sets it here, and every copy of that client follows; the reads prefer the client's
// (lib/certificateEnglish.js, lib/certificateVerification.js, routes/certificates.js).

/** Sets the client's English name and makes every certificate of theirs carry it. Runs inside the caller's transaction. */
async function setClientEnglishName(db, { tenantId, subscriberId, nameEn }) {
  const name = String(nameEn ?? '').replace(/\s+/g, ' ').trim();
  if (!subscriberId || !name) return false;
  await db.query('UPDATE subscribers SET name_en=? WHERE id=? AND tenant_id=?', [name, subscriberId, tenantId]);
  await db.query('UPDATE certificate_requests SET name_en=? WHERE tenant_id=? AND subscriber_id=?', [name, tenantId, subscriberId]);
  // A name typed on one issued certificate is no longer a second spelling of the same person.
  await db.query('UPDATE course_completions SET cert_name_en=NULL WHERE tenant_id=? AND subscriber_id=? AND cert_name_en IS NOT NULL', [tenantId, subscriberId]);
  return true;
}

module.exports = { setClientEnglishName };
