'use strict';

// A consultation booked on the site, from checkout to payment.
//
// «الاستشارات فيها مشاكل في الربط … وطلبات الاستشارات مش بتظهر ابدا». A booking
// made an order and nothing else. The consultation row was written only when a
// transfer receipt was approved, so the desk saw no request until it had been
// paid for; a card payment looked for booking details the checkout never wrote,
// so it never wrote one at all; and the slot the customer picked was not kept,
// so the hour they chose was lost. The express session's price was read from
// keys the settings screen did not write, so the checkout found 0 and refused
// the booking outright.
//
// Now the checkout opens the consultation (PENDING, paid_at NULL) against its
// order, and whichever way the order is paid settles that same row.

const { uuidv4 } = require('./id');
const { addDaysToDateOnly, cairoClock, cairoToday, isValidDateOnly } = require('./dates');

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

const numberSetting = (content, key, fallback) => {
  const raw = String(content?.[key] ?? '').trim();
  const value = Number(raw);
  return raw !== '' && Number.isFinite(value) && value >= 0 ? value : fallback;
};

/** The booking rules «إعدادات الاستشارات» sets. */
function consultationSettings(content = {}) {
  return {
    bookingWindowDays: numberSetting(content, 'consultation.booking_window_days', 30),
    minNoticeHours: numberSetting(content, 'consultation.min_notice_hours', 0),
    durationMinutes: numberSetting(content, 'consultation.duration_minutes', 60),
    autoConfirm: String(content['consultation.auto_confirm'] || '') === 'true',
  };
}

/**
 * The express session's price in one currency, 0 when none is set.
 *
 * express.price.* is what the site shows. consultation.price_egp is where the
 * settings screen used to write the Egyptian price; it stands in for it until
 * the screen saves the keys the site reads.
 */
function expressPrice(content = {}, currency = 'EGP') {
  const cur = String(currency || 'EGP').toUpperCase();
  const direct = numberSetting(content, `express.price.${cur}`, 0);
  if (direct > 0) return direct;
  return cur === 'EGP' ? numberSetting(content, 'consultation.price_egp', 0) : 0;
}

const minutesOf = time => {
  const match = /^(\d{1,2}):(\d{2})/.exec(String(time || ''));
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
};

/** A therapist's active slot, only within this tenant. */
async function findSlot(db, { tenantId, therapistId, slotId }) {
  if (!slotId || !therapistId) return null;
  const [[slot]] = await db.query(
    `SELECT s.id, s.day, s.start_time, s.timezone, s.meeting_link
       FROM therapist_slots s
       JOIN therapists t ON t.id = s.therapist_id
      WHERE s.id=? AND s.therapist_id=? AND s.is_active=1 AND t.tenant_id=?
      LIMIT 1`,
    [slotId, therapistId, tenantId]
  );
  return slot || null;
}

/**
 * Why a session on this date and slot cannot be booked, or null. Judged on
 * Cairo's calendar and clock, which is what the desk and the customer see.
 */
function bookingRuleError({ sessionDate, slot, settings, now = new Date() }) {
  if (!sessionDate) return null;
  if (!isValidDateOnly(sessionDate)) return { code: 'SESSION_DATE_INVALID', error: 'تاريخ الجلسة غير صالح' };
  const today = cairoToday(now);
  if (sessionDate < today) return { code: 'SESSION_DATE_PAST', error: 'لا يمكن حجز جلسة في تاريخ مضى' };
  if (settings.bookingWindowDays > 0 && sessionDate > addDaysToDateOnly(today, settings.bookingWindowDays)) {
    return { code: 'SESSION_DATE_TOO_FAR', error: `الحجز متاح لغاية ${settings.bookingWindowDays} يوم من النهارده` };
  }
  if (slot) {
    const weekday = WEEKDAYS[new Date(`${sessionDate}T12:00:00Z`).getUTCDay()];
    if (slot.day && String(slot.day).toLowerCase() !== weekday) {
      return { code: 'SLOT_DAY_MISMATCH', error: 'الموعد ده مش متاح في اليوم اللي اخترته' };
    }
    const start = minutesOf(slot.start_time);
    if (start !== null && settings.minNoticeHours > 0) {
      const days = Math.round((Date.parse(`${sessionDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000);
      const minutesAway = days * 1440 + start - cairoClock(now).minutes;
      if (minutesAway < settings.minNoticeHours * 60) {
        return { code: 'SESSION_TOO_SOON', error: `لازم الحجز يكون قبل الموعد بـ ${settings.minNoticeHours} ساعة على الأقل` };
      }
    }
  }
  return null;
}

const SESSION_TYPES = new Set(['INDIVIDUAL', 'COUPLE', 'FAMILY']);

/**
 * Open (or refresh) the consultation a checkout order pays for. One row per
 * order: a customer who returns to the same pending order updates it rather
 * than adding a second request.
 */
async function openConsultationRequest(db, request) {
  const {
    tenantId, orderId, branchId = 'branch-other', subscriberId = null,
    name = '', email = null, phone = null, therapistId = null, sessionDate = '',
    slot = null, sessionType = 'individual', source = 'site_regular',
    amount = null, currency = null, durationMinutes = null,
  } = request;
  const type = String(sessionType || '').toUpperCase();
  const start = slot?.start_time ? String(slot.start_time).slice(0, 5) : '00:00';
  const sessionAt = sessionDate ? `${sessionDate} ${start}:00` : null;
  const values = {
    client_name: String(name || 'عميل').slice(0, 255),
    client_email: email || null,
    client_phone: phone || null,
    therapist_id: therapistId || null,
    session_type: SESSION_TYPES.has(type) ? type : 'INDIVIDUAL',
    slot_id: slot?.id || null,
    timezone: slot?.timezone || null,
    meeting_link: slot?.meeting_link || null,
    amount: amount === null ? null : Number(amount) || 0,
    currency: ['EGP', 'SAR', 'USD'].includes(currency) ? currency : null,
    session_duration_minutes: durationMinutes || null,
    subscriber_id: subscriberId || null,
    source,
  };

  const [[existing]] = await db.query(
    'SELECT id FROM consultations WHERE tenant_id=? AND order_id=? AND deleted_at IS NULL LIMIT 1',
    [tenantId, orderId]
  );
  if (existing) {
    await db.query(
      `UPDATE consultations
          SET client_name=?, client_email=?, client_phone=?, therapist_id=?, session_type=?,
              session_date=COALESCE(?, session_date), slot_id=?, timezone=?, meeting_link=COALESCE(?, meeting_link),
              amount=?, currency=?, session_duration_minutes=?, subscriber_id=COALESCE(?, subscriber_id), source=?
        WHERE id=? AND tenant_id=?`,
      [values.client_name, values.client_email, values.client_phone, values.therapist_id, values.session_type,
        sessionAt, values.slot_id, values.timezone, values.meeting_link,
        values.amount, values.currency, values.session_duration_minutes, values.subscriber_id, values.source,
        existing.id, tenantId]
    );
    return { id: existing.id, created: false };
  }

  const id = uuidv4();
  await db.query(
    `INSERT INTO consultations
       (id, tenant_id, branch_id, client_name, client_email, client_phone, therapist_id, session_type,
        session_date, slot_id, timezone, meeting_link, status, notes, amount, currency,
        session_duration_minutes, subscriber_id, order_id, source, created_at)
     VALUES (?,?,?,?,?,?,?,?,COALESCE(?, NOW()),?,?,?,'PENDING',?,?,?,?,?,?,?,NOW())`,
    [id, tenantId, branchId || 'branch-other', values.client_name, values.client_email, values.client_phone,
      values.therapist_id, values.session_type, sessionAt, values.slot_id, values.timezone, values.meeting_link,
      `طلب من الموقع — الطلب ${orderId}`, values.amount, values.currency,
      values.session_duration_minutes, values.subscriber_id, orderId, values.source]
  );
  return { id, created: true };
}

/**
 * The order behind a consultation was paid: record it on the consultation, and
 * confirm it when «تأكيد الحجز تلقائياً» is on. An order from before
 * consultations were opened at checkout has none yet, so one is opened from the
 * order's own details first. Returns the consultation's id, or null when the
 * order carries nothing to book (an old order with no details at all).
 */
async function settleConsultationForOrder(db, { tenantId, order, subscriberId = null, autoConfirm = false }) {
  const extra = (() => { try { return JSON.parse(order.notes || '{}') || {}; } catch { return {}; } })();
  const [[existing]] = await db.query(
    'SELECT id FROM consultations WHERE tenant_id=? AND order_id=? AND deleted_at IS NULL LIMIT 1',
    [tenantId, order.id]
  );
  let id = existing?.id || null;
  if (!id) {
    const legacy = extra.consultationData || {};
    const therapistId = extra.therapistId || legacy.therapistId || null;
    const slot = await findSlot(db, { tenantId, therapistId, slotId: extra.slotId });
    const sessionDate = [extra.sessionDate, legacy.sessionDate].find(isValidDateOnly) || '';
    ({ id } = await openConsultationRequest(db, {
      tenantId, orderId: order.id, branchId: order.branch_id, subscriberId,
      name: order.customer_name || legacy.clientName, email: order.customer_email || legacy.clientEmail,
      phone: order.customer_phone || legacy.clientPhone, therapistId, sessionDate, slot,
      sessionType: extra.sessionType || legacy.sessionType,
      source: String(extra.subtype || legacy.sessionType || '').toLowerCase() === 'express' ? 'site_express' : 'site_regular',
      amount: order.amount, currency: order.currency,
    }));
  }
  await db.query(
    `UPDATE consultations
        SET paid_at=COALESCE(paid_at, NOW()), amount=?, currency=?, subscriber_id=COALESCE(?, subscriber_id),
            status=IF(? AND status='PENDING', 'CONFIRMED', status)
      WHERE id=? AND tenant_id=?`,
    [Number(order.amount) || 0, ['EGP', 'SAR', 'USD'].includes(order.currency) ? order.currency : null,
      subscriberId, autoConfirm ? 1 : 0, id, tenantId]
  );
  return id;
}

module.exports = {
  bookingRuleError,
  consultationSettings,
  expressPrice,
  findSlot,
  openConsultationRequest,
  settleConsultationForOrder,
};
