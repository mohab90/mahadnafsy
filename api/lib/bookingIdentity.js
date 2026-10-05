'use strict';

/**
 * Who the client really is, taken at the booking desk.
 *
 * «في زر حجز ودفع مكان اضافه اسم العميل الحقيقي عربي ثلاثي وايضا اسمه
 * بالانجليزي، وتاكيد علي رقم التليفون والرقم القومي، بس الاسم بالعربي ثلاثي
 * دا اجباري».
 *
 * A lead arrives under whatever it typed into a form — «Ahmed fb», a first
 * name, a nickname — and that is the name the certificate, the invoice and the
 * attendance sheet then carried. The booking is the moment somebody is sitting
 * in front of the desk, so it is where the real name is taken.
 */

const ARABIC_WORD = /^[ء-ي٠-٩ٱ-ۓۺ-ۿ]+$/;
const LATIN_NAME = /^[A-Za-z][A-Za-z .'-]*$/;

const clean = value => String(value ?? '')
  .replace(/[ً-ْـ]/g, '') // tashkeel and tatweel do not make a different name
  .replace(/\s+/g, ' ')
  .trim();

/** A full Arabic name: at least three words, Arabic letters only. «عبد» joined or not, both count. */
function checkArabicName(raw) {
  const name = clean(raw);
  if (!name) return { ok: false, error: 'اسم العميل بالعربي (ثلاثي) مطلوب' };
  const words = name.split(' ');
  if (!words.every(word => ARABIC_WORD.test(word))) {
    return { ok: false, error: 'الاسم بالعربي لازم يكون حروف عربي بس' };
  }
  // «عبد الله» is one name written as two words; it does not make a name triple on its own.
  const names = [];
  for (const word of words) {
    if (names.length && /^(عبد|ابو|أبو)$/.test(names[names.length - 1])) names[names.length - 1] += ` ${word}`;
    else names.push(word);
  }
  if (names.length < 3) return { ok: false, error: 'الاسم بالعربي لازم يكون ثلاثي على الأقل (الاسم واسم الأب واسم الجد)' };
  if (names.some(part => part.replace(/\s/g, '').length < 2)) {
    return { ok: false, error: 'في جزء من الاسم بالعربي حرف واحد بس — اكتب الاسم كامل' };
  }
  return { ok: true, value: name.slice(0, 300) };
}

function checkEnglishName(raw) {
  const name = clean(raw);
  if (!name) return { ok: true, value: null };
  if (!LATIN_NAME.test(name)) return { ok: false, error: 'الاسم بالإنجليزي لازم يكون حروف إنجليزي بس' };
  if (name.split(' ').length < 2) return { ok: false, error: 'اكتب الاسم بالإنجليزي كامل (اسمين على الأقل)' };
  return { ok: true, value: name.slice(0, 300) };
}

/**
 * An Egyptian national ID: 14 digits — century (2 = 1900s, 3 = 2000s), birth
 * date, governorate, serial, check. A non-Egyptian client may carry a passport
 * or residence number instead, so only Egyptians are held to the format.
 */
function checkNationalId(raw, { egyptian = true } = {}) {
  const value = String(raw ?? '').replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660)).replace(/[\s-]/g, '');
  if (!value) return { ok: true, value: null };
  if (!egyptian) {
    if (!/^[A-Za-z0-9]{5,20}$/.test(value)) return { ok: false, error: 'رقم الهوية/الجواز لازم يكون من 5 لـ 20 حرف أو رقم' };
    return { ok: true, value: value.toUpperCase() };
  }
  if (!/^\d{14}$/.test(value)) return { ok: false, error: 'الرقم القومي لازم يكون 14 رقم' };
  const century = value[0] === '2' ? 1900 : value[0] === '3' ? 2000 : null;
  const year = century == null ? NaN : century + Number(value.slice(1, 3));
  const month = Number(value.slice(3, 5));
  const day = Number(value.slice(5, 7));
  const date = new Date(Date.UTC(year, month - 1, day));
  if (century == null || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day || date > new Date()) {
    return { ok: false, error: 'الرقم القومي ده مش صحيح — تاريخ الميلاد اللي فيه مش منطقي' };
  }
  return { ok: true, value };
}

/**
 * Validate `client` from a booking: {nameAr, nameEn, nationalId, phoneConfirmed}.
 * @returns {{ok:true, identity:object}|{ok:false, error:string, code:string}}
 */
function validateBookingIdentity(client, { egyptian = true } = {}) {
  const input = client && typeof client === 'object' ? client : {};
  const ar = checkArabicName(input.nameAr);
  if (!ar.ok) return { ok: false, error: ar.error, code: 'NAME_AR_REQUIRED' };
  const en = checkEnglishName(input.nameEn);
  if (!en.ok) return { ok: false, error: en.error, code: 'NAME_EN_INVALID' };
  const nid = checkNationalId(input.nationalId, { egyptian });
  if (!nid.ok) return { ok: false, error: nid.error, code: 'NATIONAL_ID_INVALID' };
  if (input.phoneConfirmed !== true) {
    return { ok: false, error: 'أكّد رقم التليفون مع العميل قبل الحجز', code: 'PHONE_NOT_CONFIRMED' };
  }
  return { ok: true, identity: { nameAr: ar.value, nameEn: en.value, nationalId: nid.value } };
}

/**
 * Write the identity onto the client, inside the booking's transaction. A
 * national ID already on another client stops the booking: two people do not
 * share one, so it is the same person twice or a typo.
 */
async function applyBookingIdentity(conn, { tenantId, subscriberId, identity, nationality = null }) {
  if (identity.nationalId) {
    const [[other]] = await conn.query(
      `SELECT id, client_code, name FROM subscribers
        WHERE tenant_id=? AND national_id=? AND id<>? AND deleted_at IS NULL LIMIT 1`,
      [tenantId, identity.nationalId, subscriberId]);
    if (other) {
      throw Object.assign(new Error(
        `الرقم القومي ده متسجل لعميل تاني: ${other.name || ''}${other.client_code ? ` (${other.client_code})` : ''}`),
      { status: 409, statusCode: 409, code: 'NATIONAL_ID_TAKEN', existingId: other.id });
    }
  }
  await conn.query(
    `UPDATE subscribers
        SET name=?, name_ar=?, name_en=COALESCE(?, name_en), national_id=COALESCE(?, national_id),
            nationality=COALESCE(?, nationality)
      WHERE id=? AND tenant_id=?`,
    [identity.nameAr, identity.nameAr, identity.nameEn, identity.nationalId, nationality, subscriberId, tenantId]);
}

module.exports = { checkArabicName, checkEnglishName, checkNationalId, validateBookingIdentity, applyBookingIdentity };
