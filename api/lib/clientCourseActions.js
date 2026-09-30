'use strict';

// One item a client bought — a course, or 'bundle:<id>' for a track — taken
// off them, or moved to another item.
//
// «خلي في امكانيه للمديرين بمسح كورس لعميل مش العميل كله» and «تحويل لكورس
// محدد عند العميل». Before, a course came off a client only by re-saving their
// whole course list (the enrolment went 'revoked' and stayed on the file as a
// locked course), and a transfer was done by hand and written into a refund's
// note. Both now say in the client's history what happened and who did it.
//
// Every function runs inside the caller's transaction.

const { grantCourseSelections, revokeCourseEntitlement } = require('./entitlements');
const { itemKey, releaseItemMoney, setAgreedPrice } = require('./agreedPrice');
const { logClientEvent } = require('./clientHistory');

/** «للمديرين»: the owner, the managers, and the two branch managers. */
const MANAGER_ROLES = new Set(['admin', 'manager', 'online_manager', 'daqqi_manager', 'sales_collection_manager']);
const isCourseManager = req => !!req.isSuperAdmin || MANAGER_ROLES.has(String(req.staffRecord?.role || '').toLowerCase());

const fail = (statusCode, message) => Object.assign(new Error(message), { statusCode });

function parseItem(value) {
  const item = String(value || '').trim();
  return item.startsWith('bundle:')
    ? { courseId: null, bundleId: item.slice(7) || null }
    : { courseId: item || null, bundleId: null };
}

async function itemTitle(db, tenantId, { courseId, bundleId }) {
  const [[row]] = bundleId
    ? await db.query('SELECT title FROM bundles WHERE id=? AND tenant_id=? AND deleted_at IS NULL LIMIT 1', [bundleId, tenantId])
    : await db.query(
      "SELECT COALESCE(NULLIF(title_ar,''), title) AS title FROM courses WHERE id=? AND tenant_id=? AND deleted_at IS NULL LIMIT 1",
      [courseId, tenantId]);
  return row?.title || null;
}

/** The enrolments the item stands for on this client, locked. */
async function itemEnrolments(db, { tenantId, subscriberId, courseId, bundleId }) {
  const [rows] = await db.query(
    `SELECT id, course_id, status, access_type, lecture_limit FROM enrollments
      WHERE tenant_id=? AND subscriber_id=? AND status<>'removed' AND ${bundleId ? 'bundle_id=?' : 'course_id=?'}
      FOR UPDATE`,
    [tenantId, subscriberId, bundleId || courseId]);
  return rows;
}

/**
 * Access goes (an entitlement event, as a lock writes), the enrolment leaves
 * every list — 'removed', where a lock leaves it 'revoked' on the file — and
 * the client leaves the Dokki rounds of those courses that have not finished.
 */
async function dropEnrolments(db, { tenantId, subscriberId, enrolments, actor, reason, source }) {
  for (const row of enrolments) {
    if (row.status === 'active') {
      await revokeCourseEntitlement({ tenantId, subscriberId, courseId: row.course_id, source, actor, reason }, db);
    }
  }
  const marks = enrolments.map(() => '?').join(',');
  await db.query(
    `UPDATE enrollments SET status='removed', bundle_id=NULL, updated_at=NOW()
      WHERE tenant_id=? AND id IN (${marks})`,
    [tenantId, ...enrolments.map(row => row.id)]);
  const courseIds = [...new Set(enrolments.map(row => row.course_id))];
  await db.query(
    `DELETE a FROM daqqi_attendees a
       JOIN daqqi_rounds r ON r.id=a.round_id AND r.tenant_id=a.tenant_id
      WHERE a.tenant_id=? AND a.subscriber_id=? AND r.status<>'finished'
        AND r.course_id IN (${courseIds.map(() => '?').join(',')})`,
    [tenantId, subscriberId, ...courseIds]);
}

const money = value => Number(value || 0).toLocaleString('en-US');

/**
 * The item comes off the client. Money recorded against it stays where it is:
 * a refund returns money and a transfer moves it; a deletion does neither.
 */
async function removeClientCourse(db, { tenantId, subscriber, item, reason, actor }) {
  const target = parseItem(item);
  if (!target.courseId && !target.bundleId) throw fail(400, 'حدد الكورس');
  const enrolments = await itemEnrolments(db, { tenantId, subscriberId: subscriber.id, ...target });
  if (!enrolments.length) throw fail(404, 'العميل مش مشترك في الكورس ده');
  const title = await itemTitle(db, tenantId, target) || itemKey(target);
  await dropEnrolments(db, { tenantId, subscriberId: subscriber.id, enrolments, actor, reason, source: 'desk_remove' });
  const released = await releaseItemMoney(db, { tenantId, subscriberId: subscriber.id, from: target });
  await logClientEvent(db, {
    tenantId, subscriberId: subscriber.id, action: 'course_removed', actor,
    label: `اتمسح «${title}» من العميل — ${reason}`
      + (released.priorPaid ? ` · كان مسجّل له مدفوع قبل السيستم ${money(released.priorPaid)}` : ''),
  });
  return { removed: enrolments.length, title };
}

/**
 * The item moves to another: access, the money paid for it and what was paid
 * before the system. The new item's price is `price` when it is given, else
 * its catalogue price — the old agreed price belonged to the old item.
 */
async function transferClientCourse(db, { tenantId, subscriber, item, toItem, price = null, reason, actor }) {
  const from = parseItem(item);
  const to = parseItem(toItem);
  if ((!from.courseId && !from.bundleId) || (!to.courseId && !to.bundleId)) {
    throw fail(400, 'حدد الكورس اللي هيتحوّل والكورس اللي هيتحوّل له');
  }
  if (itemKey(from) === itemKey(to)) throw fail(400, 'اختار كورس غير الكورس الحالي');
  const toTitle = await itemTitle(db, tenantId, to);
  if (!toTitle) throw fail(404, 'الكورس اللي هيتحوّل له مش موجود');
  const enrolments = await itemEnrolments(db, { tenantId, subscriberId: subscriber.id, ...from });
  if (!enrolments.length) throw fail(404, 'العميل مش مشترك في الكورس ده');
  const fromTitle = await itemTitle(db, tenantId, from) || itemKey(from);

  // The access they had, carried over: a client on instalments keeps the
  // lectures they had reached, not all of the new course.
  const held = enrolments.find(row => row.status === 'active') || enrolments[0];
  const limited = held.access_type === 'limited';
  await dropEnrolments(db, {
    tenantId, subscriberId: subscriber.id, enrolments, actor, source: 'desk_transfer', reason: `تحويل إلى ${toTitle}`,
  });
  await grantCourseSelections({
    tenantId, subscriberId: subscriber.id,
    selections: [{
      courseId: itemKey(to), accessType: limited ? 'limited' : 'full',
      lectureLimit: limited ? (Number(held.lecture_limit) || 1) : null,
    }],
    branchId: subscriber.branch_id || null, source: 'desk_transfer', actor,
  }, db);

  const fromWhere = from.bundleId ? 'bundle_id=?' : 'course_id=? AND bundle_id IS NULL';
  const [[paid]] = await db.query(
    `SELECT COALESCE(SUM(amount),0) AS total, MAX(currency) AS currency FROM payments
      WHERE tenant_id=? AND subscriber_id=? AND deleted_at IS NULL AND status='paid'
        AND payment_type IN ('COURSE','BUNDLE') AND ${fromWhere}`,
    [tenantId, subscriber.id, from.bundleId || from.courseId]);
  const [moved] = await db.query(
    `UPDATE payments SET course_id=?, bundle_id=?, item_title=?, course_expected=NULL,
            note=CONCAT(COALESCE(note,''), IF(note IS NULL OR note='', '', ' | '), ?)
      WHERE tenant_id=? AND subscriber_id=? AND deleted_at IS NULL
        AND payment_type IN ('COURSE','BUNDLE') AND ${fromWhere}`,
    [to.courseId, to.bundleId, toTitle, `محوّلة من ${fromTitle}`,
      tenantId, subscriber.id, from.bundleId || from.courseId]);
  const released = await releaseItemMoney(db, { tenantId, subscriberId: subscriber.id, from, to });
  if (price !== null && price !== undefined && price !== '') {
    await setAgreedPrice(db, { tenantId, subscriberId: subscriber.id, ...to, price });
  }

  const carried = [
    Number(paid?.total) > 0 ? `${money(paid.total)} ${paid.currency || 'EGP'} مدفوعة اتنقلت معاه` : '',
    released.priorPaid ? `مدفوع قبل السيستم ${money(released.priorPaid)}` : '',
  ].filter(Boolean).join(' + ');
  await logClientEvent(db, {
    tenantId, subscriberId: subscriber.id, action: 'course_transferred', actor,
    label: `اتحوّل «${fromTitle}» إلى «${toTitle}»${carried ? ` — ${carried}` : ''}${reason ? ` — ${reason}` : ''}`,
  });
  return { from: fromTitle, to: toTitle, paymentsMoved: moved.affectedRows || 0, paid: Number(paid?.total) || 0 };
}

module.exports = { isCourseManager, itemTitle, parseItem, removeClientCourse, transferClientCourse };
