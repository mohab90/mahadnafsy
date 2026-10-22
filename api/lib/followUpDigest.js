'use strict';

// The day's follow-ups, told to the people who owe them.
//
// «المتابعات محتاجة تكون أقوى … يظهر اشعار للمسئولين عنه سواء فى الدقى او الاونلاين او السيلز كل
// قسم يظهرله اشعارات قيمة» (14 Oct 2026). Until now a follow-up was a date nobody was told about:
// leads had a WhatsApp reminder at 8, and a client's next contact sat in the table until someone
// happened to filter for it. Here every employee gets one notification a day — kept up to date
// through the day, and unread again when more fall due — saying how many of each kind are theirs:
// leads (sales), online clients (collection / online), Dokki & Tagamoa clients (reception); and the
// managers get one for the team: who is behind, and what has no owner.
//
// A client is due when the latest communication logged for them set a next contact on or before
// today; a lead when its next follow-up date has come and it is not closed (lib/leadFollowUps.js).

const { FOLLOW_UP_DATE, dueBy } = require('./leadFollowUps');
const { sqlCairoToday, cairoToday } = require('./dates');
const { uuidv4 } = require('./id');
const logger = require('./logger');

const SECTIONS = Object.freeze({
  leads: { label: 'ليدز', icon: '🎯' },
  online: { label: 'عملاء أونلاين', icon: '💻' },
  dokki: { label: 'عملاء الدقي والتجمع', icon: '🏫' },
  tickets: { label: 'مشاكل عملاء', icon: '🎫' },
});
const BRANCH_DOKKI = new Set(['DAQQI', 'TAGAMOA']);

/** Everything due on or before today: clients by their latest contact, and open leads. */
async function collectDue(db, tenantId) {
  const dayEnd = `${sqlCairoToday()} + INTERVAL 1 DAY`;
  const [clients] = await db.query(
    `SELECT s.id, s.name, s.branch, c.next_follow_up AS due,
            COALESCE(NULLIF(s.assigned_cs_id,''), NULLIF(s.assigned_sales_id,'')) AS owner_id,
            COALESCE(NULLIF(s.assigned_cs_name,''), NULLIF(s.assigned_sales_name,'')) AS owner_name
       FROM subscribers s
       JOIN communications c ON c.subscriber_id = s.id AND c.tenant_id = s.tenant_id
      WHERE s.tenant_id = ? AND s.deleted_at IS NULL AND s.is_active = 1
        AND c.next_follow_up IS NOT NULL AND c.next_follow_up < ${dayEnd}
        AND c.date = (SELECT MAX(c2.date) FROM communications c2 WHERE c2.subscriber_id = s.id AND c2.tenant_id = s.tenant_id)
      LIMIT 5000`, [tenantId]);
  // Leads as every screen counts them (lib/leadFollowUps.js): the date in crm_json counts too.
  const leadsDue = dueBy(cairoToday());
  const [leads] = await db.query(
    `SELECT l.id, l.name, ${FOLLOW_UP_DATE} AS due,
            COALESCE(NULLIF(l.assigned_sales_id,''), NULLIF(l.assigned_cs_id,'')) AS owner_id,
            COALESCE(NULLIF(l.assigned_sales_name,''), NULLIF(l.assigned_cs_name,'')) AS owner_name
       FROM leads l
      WHERE l.tenant_id = ?${leadsDue.sql}
      LIMIT 5000`, [tenantId, ...leadsDue.params]);
  // A problem the team promised to come back to: due on the date set when it was last contacted.
  const [tickets] = await db.query(
    `SELECT t.id, t.subject AS name, t.next_contact_at AS due, t.assigned_to AS owner_id, s.name AS owner_name
       FROM support_tickets t LEFT JOIN staff s ON s.id = t.assigned_to AND s.tenant_id = t.tenant_id
      WHERE t.tenant_id = ? AND t.deleted_at IS NULL AND t.status IN ('open','in_progress')
        AND t.next_contact_at IS NOT NULL AND t.next_contact_at < ${dayEnd}
      LIMIT 2000`, [tenantId]);
  return [
    ...tickets.map(row => ({ ...row, section: 'tickets' })),
    ...clients.map(row => ({ ...row, section: BRANCH_DOKKI.has(String(row.branch || '').toUpperCase()) ? 'dokki' : 'online' })),
    ...leads.map(row => ({ ...row, section: 'leads' })),
  ];
}

const dayOf = value => (value instanceof Date ? value.toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' }) : String(value || '').slice(0, 10));

/** Per-owner counts, and the team's: pure, so it is the same in the job and in a test. */
function summarize(rows, today = cairoToday()) {
  const byOwner = new Map();
  const unowned = { overdue: 0, today: 0 };
  const team = { overdue: 0, today: 0 };
  for (const row of rows) {
    const overdue = dayOf(row.due) < today;
    team[overdue ? 'overdue' : 'today'] += 1;
    if (!row.owner_id) { unowned[overdue ? 'overdue' : 'today'] += 1; continue; }
    if (!byOwner.has(row.owner_id)) byOwner.set(row.owner_id, { id: row.owner_id, name: row.owner_name || '', total: 0, overdue: 0, today: 0, sections: {} });
    const owner = byOwner.get(row.owner_id);
    const section = owner.sections[row.section] || (owner.sections[row.section] = { overdue: 0, today: 0 });
    section[overdue ? 'overdue' : 'today'] += 1;
    owner[overdue ? 'overdue' : 'today'] += 1;
    owner.total += 1;
  }
  return { owners: [...byOwner.values()].sort((a, b) => b.overdue - a.overdue || b.total - a.total), unowned, team };
}

/** «3 ليدز · 4 عملاء أونلاين — منها 2 متأخرة» */
function ownerMessage(owner) {
  const parts = Object.entries(owner.sections).map(([key, n]) => `${SECTIONS[key].icon} ${n.overdue + n.today} ${SECTIONS[key].label}`);
  return `${parts.join(' · ')}${owner.overdue ? ` — منها ${owner.overdue} متأخرة` : ''}`;
}
const ownerTitle = owner => (owner.overdue
  ? `🔴 عندك ${owner.total} متابعة النهاردة (${owner.overdue} متأخرة)`
  : `📅 عندك ${owner.total} متابعة النهاردة`);

function teamMessage(summary) {
  const top = summary.owners.filter(o => o.overdue).slice(0, 5).map(o => `${o.name || 'موظف'}: ${o.overdue}`);
  return [
    `${summary.team.today} النهاردة · ${summary.team.overdue} متأخرة`,
    top.length ? `الأكتر تأخيرا — ${top.join(' | ')}` : '',
    summary.unowned.overdue + summary.unowned.today ? `بدون مسئول: ${summary.unowned.overdue + summary.unowned.today}` : '',
  ].filter(Boolean).join(' — ');
}

/**
 * One notification per (type, recipient, day): made once, rewritten when the figures change,
 * and unread again when there are more than before.
 */
async function upsertDaily(db, { tenantId, type, recipientStaffId, title, message, data, today, viewerKey }) {
  const stamp = `"date":"${today}"`;
  const [[existing]] = await db.query(
    `SELECT id, data_json FROM notifications
      WHERE tenant_id = ? AND type = ? AND recipient_staff_id <=> ? AND data_json LIKE ? ORDER BY created_at DESC LIMIT 1`,
    [tenantId, type, recipientStaffId || null, `%${stamp}%`]);
  const payload = JSON.stringify({ ...data, date: today });
  if (!existing) {
    await db.query(
      'INSERT INTO notifications (id, tenant_id, recipient_staff_id, type, title, message, data_json) VALUES (?,?,?,?,?,?,?)',
      [uuidv4(), tenantId, recipientStaffId || null, type, title, message, payload]);
    return 'created';
  }
  let before = {};
  try { before = JSON.parse(existing.data_json || '{}') || {}; } catch { before = {}; }
  if (before.total === data.total && before.overdue === data.overdue) return 'same';
  await db.query('UPDATE notifications SET title = ?, message = ?, data_json = ? WHERE id = ? AND tenant_id = ?',
    [title, message, payload, existing.id, tenantId]);
  if (Number(data.total) > Number(before.total || 0)) {
    // More fell due since it was read: it counts as new again.
    await db.query('DELETE FROM notification_reads WHERE notification_id = ? AND tenant_id = ?', [existing.id, tenantId]).catch(() => {});
    await db.query('UPDATE notifications SET read_at = NULL, created_at = NOW() WHERE id = ? AND tenant_id = ?', [existing.id, tenantId]);
  }
  return 'updated';
}

async function runFollowUpDigest(tenantId, db = require('./db').pool) {
  try {
    const today = cairoToday();
    const rows = await collectDue(db, tenantId);
    const summary = summarize(rows, today);
    for (const owner of summary.owners) {
      await upsertDaily(db, {
        tenantId, type: 'followup', recipientStaffId: owner.id, today,
        title: ownerTitle(owner), message: ownerMessage(owner),
        data: { total: owner.total, overdue: owner.overdue, sections: owner.sections, link: '/dashboard?tab=followups' },
      });
    }
    const teamTotal = summary.team.overdue + summary.team.today;
    if (teamTotal) {
      await upsertDaily(db, {
        tenantId, type: 'followup_team', recipientStaffId: null, today,
        title: summary.team.overdue ? `🔴 متابعات الفريق: ${summary.team.overdue} متأخرة` : `📅 متابعات الفريق: ${teamTotal} النهاردة`,
        message: teamMessage(summary),
        data: { total: teamTotal, overdue: summary.team.overdue, unowned: summary.unowned, link: '/dashboard?tab=followups' },
      });
    }
    return summary;
  } catch (error) {
    logger.warn('[followup-digest]', error.message);
    return null;
  }
}

const cairoHour = () => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', hour: '2-digit', hourCycle: 'h23' }).format(new Date()));

/** From 08:00 to 21:00 Cairo, hourly: the first run of the day makes them, the rest keep them true. */
function scheduleFollowUpDigest(run = function followupDigest(tenantId) { return runFollowUpDigest(tenantId); }) {
  const { forEachActiveTenant } = require('./scheduledTenants');
  const tick = () => {
    const hour = cairoHour();
    if (hour >= 8 && hour <= 21) forEachActiveTenant(run).catch(() => {});
  };
  const first = setTimeout(tick, 2 * 60 * 1000);
  const every = setInterval(tick, 60 * 60 * 1000);
  first.unref?.(); every.unref?.();
  return { first, every };
}

module.exports = { SECTIONS, collectDue, summarize, ownerTitle, ownerMessage, teamMessage, upsertDaily, runFollowUpDigest, scheduleFollowUpDigest };
