'use strict';

// What the system knows about a WhatsApp number, for the card above a chat.
//
// «أي رقم يكون مربوط بالسيستم ياخد بياناته ويبقى مسجل اسم العميل وفوق يظهر اسم الكورس المهتم بيه وتفاصيله» (19 Oct 2026).
// A number is matched, by its identity form (lib/phoneNumber.js), to the client file and to the lead file it belongs
// to — a person can be both. The card says who they are, which course they asked about or hold, what stage they are
// at and who has them; the money (paid, waiting) is added only for someone who may see it.

const { pool } = require('./db');
const { toIdentity } = require('./phoneNumber');
const { phoneIdentityClause } = require('./leadMatching');

const parseIds = value => {
  try {
    const ids = JSON.parse(value || '[]');
    return Array.isArray(ids) ? ids.map(String).filter(Boolean) : [];
  } catch { return []; }
};

/** Courses by id → { id, title, price }. A bundle id («bundle:…») is named through bundles. */
async function coursesById(tenantId, ids) {
  const wanted = [...new Set(ids.filter(Boolean).map(String))];
  const out = new Map();
  if (!wanted.length) return out;
  const plain = wanted.filter(id => !id.startsWith('bundle:'));
  const bundles = wanted.filter(id => id.startsWith('bundle:')).map(id => id.slice(7));
  if (plain.length) {
    const [rows] = await pool.query(
      'SELECT id, COALESCE(NULLIF(title_ar, \'\'), title) AS title, price_egp FROM courses WHERE tenant_id=? AND id IN (?) AND deleted_at IS NULL',
      [tenantId, plain]).catch(() => [[]]);
    for (const row of rows) out.set(String(row.id), { id: String(row.id), title: row.title || '', price: Number(row.price_egp) || 0, kind: 'course' });
  }
  if (bundles.length) {
    const [rows] = await pool.query(
      'SELECT id, title FROM bundles WHERE tenant_id=? AND id IN (?) AND deleted_at IS NULL', [tenantId, bundles]).catch(() => [[]]);
    for (const row of rows) out.set(`bundle:${row.id}`, { id: `bundle:${row.id}`, title: row.title || '', price: 0, kind: 'bundle' });
  }
  return out;
}

/**
 * @param {{ canSeeMoney?: boolean }} options
 * @returns {Promise<{ phone: string, subscriber: object|null, lead: object|null }>}
 */
async function contextForPhone(tenantId, phone, { canSeeMoney = false, viewerId = '' } = {}) {
  const identity = toIdentity(phone);
  const clause = identity ? phoneIdentityClause(identity) : null;
  if (!clause) return { phone: String(phone || ''), subscriber: null, lead: null };

  const [[sub]] = await pool.query(
    `SELECT id, client_code, name, phone, branch, assigned_sales_id, assigned_cs_id, assigned_sales_name, assigned_cs_name, is_active, created_at
       FROM subscribers WHERE tenant_id=? AND deleted_at IS NULL AND ${clause.sql} ORDER BY created_at DESC LIMIT 1`,
    [tenantId, ...clause.params]);
  const [[lead]] = await pool.query(
    `SELECT id, client_code, name, phone, branch, status, source, interest_level, interested_course_ids_json, enrolled_course_id,
            deal_value, assigned_sales_name, next_follow_up_date, last_follow_up, LEFT(notes, 400) AS notes, created_at
       FROM leads WHERE tenant_id=? AND hidden=0 AND deleted_at IS NULL AND ${clause.sql} ORDER BY created_at DESC LIMIT 1`,
    [tenantId, ...clause.params]);

  let subscriber = null;
  let enrolledIds = [];
  if (sub) {
    const [enrollments] = await pool.query(
      `SELECT course_id, bundle_id, status, progress_percent, enrolled_at FROM enrollments
        WHERE tenant_id=? AND subscriber_id=? AND status='active' ORDER BY enrolled_at DESC LIMIT 20`, [tenantId, sub.id]);
    enrolledIds = enrollments.map(row => (row.course_id ? String(row.course_id) : row.bundle_id ? `bundle:${row.bundle_id}` : '')).filter(Boolean);
    subscriber = { sub, enrollments };
  }
  const interestedIds = lead ? parseIds(lead.interested_course_ids_json) : [];
  const courses = await coursesById(tenantId, [...enrolledIds, ...interestedIds, lead?.enrolled_course_id].filter(Boolean));
  const named = id => courses.get(String(id)) || null;

  let money = null;
  // The money of a client is for whoever may see money, and for the person who has the client.
  const mine = Boolean(sub && viewerId && (sub.assigned_sales_id === viewerId || sub.assigned_cs_id === viewerId));
  if (sub && (canSeeMoney || mine)) {
    const [paid] = await pool.query(
      `SELECT currency, COALESCE(SUM(amount), 0) AS paid, COUNT(*) AS n, MAX(\`date\`) AS last_at FROM payments
        WHERE tenant_id=? AND subscriber_id=? AND status='paid' AND deleted_at IS NULL GROUP BY currency`, [tenantId, sub.id]);
    const [[waiting]] = await pool.query(
      `SELECT COUNT(*) AS n FROM payments WHERE tenant_id=? AND subscriber_id=? AND status='pending' AND deleted_at IS NULL`, [tenantId, sub.id]);
    money = {
      paid: paid.map(row => ({ currency: row.currency || 'EGP', amount: Number(row.paid) || 0, count: Number(row.n) || 0 })),
      lastPaymentAt: paid.map(row => row.last_at).filter(Boolean).sort().pop() || null,
      waiting: Number(waiting?.n) || 0,
    };
  }

  return {
    phone: identity,
    subscriber: subscriber ? {
      id: sub.id, clientCode: sub.client_code || null, name: sub.name || '', branch: sub.branch || null,
      owner: sub.assigned_cs_name || sub.assigned_sales_name || null, active: Boolean(sub.is_active),
      since: sub.created_at || null,
      courses: subscriber.enrollments.map(row => {
        const id = row.course_id ? String(row.course_id) : `bundle:${row.bundle_id}`;
        const course = named(id);
        return { id, title: course?.title || '', progress: Number(row.progress_percent) || 0, since: row.enrolled_at };
      }).filter(course => course.title),
      ...(money ? { money } : {}),
    } : null,
    lead: lead ? {
      id: lead.id, clientCode: lead.client_code || null, name: lead.name || '', branch: lead.branch || null,
      status: lead.status || null, source: lead.source || null, interestLevel: lead.interest_level || null,
      owner: lead.assigned_sales_name || null, nextFollowUp: lead.next_follow_up_date || null, lastFollowUp: lead.last_follow_up || null,
      notes: lead.notes || null, since: lead.created_at || null,
      dealValue: lead.deal_value != null ? Number(lead.deal_value) : null,
      interested: interestedIds.map(named).filter(Boolean).map(course => ({ id: course.id, title: course.title, price: course.price })),
      enrolled: lead.enrolled_course_id ? (() => { const course = named(lead.enrolled_course_id); return course ? { id: course.id, title: course.title } : null; })() : null,
    } : null,
  };
}

/**
 * The course each chat's person is about, for the list: a lead's first interested course, or a client's latest one.
 * Two queries for the whole list, not one per chat.
 * @returns {Promise<{ byLead: Map<string,string>, bySubscriber: Map<string,string> }>}
 */
async function courseLabelsFor(tenantId, { leadIds = [], subscriberIds = [] }) {
  const byLead = new Map();
  const bySubscriber = new Map();
  const wantedIds = [];
  const leadFirst = new Map();
  if (leadIds.length) {
    const [rows] = await pool.query(
      'SELECT id, interested_course_ids_json, enrolled_course_id FROM leads WHERE tenant_id=? AND id IN (?)', [tenantId, leadIds]).catch(() => [[]]);
    for (const row of rows) {
      const first = parseIds(row.interested_course_ids_json)[0] || row.enrolled_course_id || '';
      if (first) { leadFirst.set(String(row.id), String(first)); wantedIds.push(first); }
    }
  }
  const subFirst = new Map();
  if (subscriberIds.length) {
    const [rows] = await pool.query(
      `SELECT subscriber_id, course_id, bundle_id FROM enrollments
        WHERE tenant_id=? AND subscriber_id IN (?) AND status='active' ORDER BY enrolled_at ASC`, [tenantId, subscriberIds]).catch(() => [[]]);
    for (const row of rows) {
      const id = row.course_id ? String(row.course_id) : row.bundle_id ? `bundle:${row.bundle_id}` : '';
      if (id) { subFirst.set(String(row.subscriber_id), id); wantedIds.push(id); }
    }
  }
  const courses = await coursesById(tenantId, wantedIds);
  for (const [leadId, courseId] of leadFirst) if (courses.get(courseId)) byLead.set(leadId, courses.get(courseId).title);
  for (const [subscriberId, courseId] of subFirst) if (courses.get(courseId)) bySubscriber.set(subscriberId, courses.get(courseId).title);
  return { byLead, bySubscriber };
}

module.exports = { contextForPhone, courseLabelsFor };
