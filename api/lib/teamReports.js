'use strict';

// «محتاج منك تقرير زيه لفريق الاونلاين ولفريق خدمه العملاء ولفريق الدقي …
// زي خدمه العملاء مطلوب المكالمات ومطلوب نعرف حل كام مشكله عمل كام شهاده عمل
// كام تقيير راجع كام عميل … تقارير تقييس كل حاجة».
//
// The sales team's daily report (lib/teamDailyReport.js), for the other three
// teams, over the same Cairo days. Each figure is read where the system records
// it; a figure the system has no record of for someone reads 0, and the page
// says what each one counts:
//
//   calls, WhatsApp   communications rows the employee logged (the client
//                     file's «سجل تواصل») — on 30 Sep only sales logged any
//   clients reviewed  subscribers whose record the employee changed
//                     (activity_logs, by the account's email)
//   collected         paid payments of the clients the officer is responsible
//                     for (subscribers.assigned_cs_id) — 90 of September's 97
//                     payments name no recorder, so the client's owner is the
//                     only attribution that holds
//
// Column comparisons follow teamDailyReport.js: UTC instants against the UTC
// instants of Cairo's midnights, picked calendar days as days.

const { pool } = require('./db');
const { addDaysToDateOnly, cairoDayStartUtc } = require('./dates');
const { PHYSICAL_BRANCHES } = require('./physicalBranches');

const num = value => Number(value) || 0;
const MONEY_EGP = "COALESCE(p.amount_egp, CASE WHEN p.currency='EGP' THEN p.amount ELSE 0 END)";

function bounds(from, to) {
  return {
    startUtc: cairoDayStartUtc(from),
    endUtc: cairoDayStartUtc(addDaysToDateOnly(to, 1)),
    dayAfter: addDaysToDateOnly(to, 1),
  };
}

const byKey = (rows, key = 'rep') => new Map(rows.map(row => [String(row[key] || ''), row]));

async function staffInRoles(db, tenantId, roles) {
  const [rows] = await db.query(
    `SELECT id, name, email, UPPER(role) AS role FROM staff
      WHERE tenant_id=? AND is_active=1 AND deleted_at IS NULL AND UPPER(role) IN (${roles.map(() => '?').join(',')})
      ORDER BY name`,
    [tenantId, ...roles]
  );
  return rows;
}

// What each employee logged: calls, WhatsApp, and how many people they reached.
async function contactsByStaff(db, tenantId, b) {
  const [rows] = await db.query(
    `SELECT staff_id AS rep,
            SUM(type='CALL') AS calls, SUM(type='WHATSAPP') AS whatsapp,
            SUM(type='PAYMENT_FOLLOWUP') AS followUps,
            COUNT(DISTINCT COALESCE(subscriber_id, lead_id)) AS reached
       FROM communications
      WHERE tenant_id=? AND date >= ? AND date < ?
      GROUP BY staff_id`,
    [tenantId, b.startUtc, b.endUtc]
  );
  return byKey(rows);
}

// Distinct records each account changed, from the activity log (actor = email).
async function changedByActor(db, tenantId, b, entity, action) {
  const [rows] = await db.query(
    `SELECT LOWER(actor) AS rep, COUNT(DISTINCT entity_id) AS n
       FROM activity_logs
      WHERE tenant_id=? AND at >= ? AND at < ? AND entity=? AND action=?
      GROUP BY LOWER(actor)`,
    [tenantId, b.startUtc, b.endUtc, entity, action]
  );
  return byKey(rows);
}

const sumRows = (rows, key) => rows.reduce((total, row) => total + num(row[key]), 0);

// ── فريق الأونلاين (التحصيل) ────────────────────────────────────────────────
// The online desk's clients: not studying at a physical branch. The officer's
// own screen keeps the same ones (onlineClientsUtils isOnlineClient). Counting
// every client named on the officer put 1,921 Dokki clients — handed to her by
// the 29 Sep import — on Doaa Awny's line: «عندها عملاء مسئول عنهم 1,948».
const ONLINE_CLIENT = "COALESCE(sub.branch, '') NOT IN ('DAQQI','TAGAMOA')";

async function buildOnlineTeamReport({ tenantId, from, to, today }, db = pool) {
  const b = bounds(from, to);
  const officers = await staffInRoles(db, tenantId, ['COLLECTION']);
  const contacts = await contactsByStaff(db, tenantId, b);
  const [load] = await db.query(
    `SELECT sub.assigned_cs_id AS rep, COUNT(*) AS clients,
            SUM(sub.assigned_cs_at >= ? AND sub.assigned_cs_at < ?) AS received
       FROM subscribers sub
      WHERE sub.tenant_id=? AND sub.deleted_at IS NULL AND sub.assigned_cs_id IS NOT NULL AND sub.assigned_cs_id<>''
        AND ${ONLINE_CLIENT}
      GROUP BY sub.assigned_cs_id`,
    [b.startUtc, b.endUtc, tenantId]
  );
  const [collected] = await db.query(
    `SELECT sub.assigned_cs_id AS rep, COUNT(*) AS payments, SUM(p.is_installment=1) AS installments,
            SUM(${MONEY_EGP}) AS moneyEgp
       FROM payments p
       JOIN subscribers sub ON sub.id=p.subscriber_id AND sub.tenant_id=p.tenant_id
      WHERE p.tenant_id=? AND p.deleted_at IS NULL AND (p.status IS NULL OR p.status='paid') AND p.date >= ? AND p.date < ?
        AND sub.assigned_cs_id IS NOT NULL AND sub.assigned_cs_id<>'' AND ${ONLINE_CLIENT}
      GROUP BY sub.assigned_cs_id`,
    [tenantId, from, b.dayAfter]
  );
  const [pending] = await db.query(
    `SELECT COALESCE(NULLIF(p.staff_id,''), sub.assigned_cs_id) AS rep, COUNT(*) AS n
       FROM payments p
       LEFT JOIN subscribers sub ON sub.id=p.subscriber_id AND sub.tenant_id=p.tenant_id
      WHERE p.tenant_id=? AND p.deleted_at IS NULL AND p.status='pending'
      GROUP BY rep`,
    [tenantId]
  );
  const [[online]] = await db.query(
    `SELECT COUNT(*) AS payments, SUM(${MONEY_EGP}) AS moneyEgp
       FROM payments p
      WHERE p.tenant_id=? AND p.deleted_at IS NULL AND (p.status IS NULL OR p.status='paid') AND p.date >= ? AND p.date < ?
        AND p.branch IN ('ONLINE_EGYPT','ONLINE_SAUDI','ONLINE_ABROAD')`,
    [tenantId, from, b.dayAfter]
  );
  const loadBy = byKey(load);
  const collectedBy = byKey(collected);
  const pendingBy = byKey(pending);
  const rows = officers.map(officer => {
    const id = String(officer.id);
    const c = contacts.get(id) || {};
    const l = loadBy.get(id) || {};
    const m = collectedBy.get(id) || {};
    return {
      id, name: officer.name,
      calls: num(c.calls), whatsapp: num(c.whatsapp), followUps: num(c.followUps), reached: num(c.reached),
      clients: num(l.clients), received: num(l.received),
      payments: num(m.payments), installments: num(m.installments), collectedEgp: Math.round(num(m.moneyEgp)),
      pendingReview: num(pendingBy.get(id)?.n),
    };
  });
  return {
    team: 'online', from, to, today, rows,
    totals: {
      calls: sumRows(rows, 'calls'), whatsapp: sumRows(rows, 'whatsapp'), reached: sumRows(rows, 'reached'),
      clients: sumRows(rows, 'clients'), received: sumRows(rows, 'received'),
      collectedEgp: sumRows(rows, 'collectedEgp'), payments: sumRows(rows, 'payments'),
      onlinePayments: num(online?.payments), onlineMoneyEgp: Math.round(num(online?.moneyEgp)),
    },
  };
}

// ── خدمة العملاء ────────────────────────────────────────────────────────────
async function buildSupportTeamReport({ tenantId, from, to, today }, db = pool) {
  const b = bounds(from, to);
  const agents = await staffInRoles(db, tenantId, ['SUPPORT']);
  const contacts = await contactsByStaff(db, tenantId, b);
  const reviewed = await changedByActor(db, tenantId, b, 'subscribers', 'update');
  const certificates = await changedByActor(db, tenantId, b, 'certificate-requests', 'update');
  const [resolved] = await db.query(
    `SELECT COALESCE(NULLIF(assigned_to_id,''), assigned_to) AS rep, COUNT(*) AS resolved,
            SUM(csat_score IS NOT NULL) AS rated, AVG(csat_score) AS csat
       FROM support_tickets
      WHERE tenant_id=? AND deleted_at IS NULL AND resolved_at >= ? AND resolved_at < ?
      GROUP BY rep`,
    [tenantId, b.startUtc, b.endUtc]
  );
  const [replies] = await db.query(
    `SELECT actor_id AS rep, COUNT(*) AS replies
       FROM ticket_events
      WHERE tenant_id=? AND event_type='replied' AND created_at >= ? AND created_at < ?
      GROUP BY actor_id`,
    [tenantId, b.startUtc, b.endUtc]
  );
  const [escalated] = await db.query(
    `SELECT escalated_by AS rep, COUNT(*) AS n
       FROM refund_requests
      WHERE tenant_id=? AND deleted_at IS NULL AND escalated_at >= ? AND escalated_at < ?
      GROUP BY escalated_by`,
    [tenantId, b.startUtc, b.endUtc]
  );
  const [[tickets]] = await db.query(
    `SELECT SUM(created_at >= ? AND created_at < ?) AS opened,
            SUM(resolved_at >= ? AND resolved_at < ?) AS resolved,
            SUM(resolved_at IS NULL AND status NOT IN ('resolved','closed')) AS stillOpen
       FROM support_tickets WHERE tenant_id=? AND deleted_at IS NULL`,
    [b.startUtc, b.endUtc, b.startUtc, b.endUtc, tenantId]
  );
  const [[certs]] = await db.query(
    `SELECT SUM(requested_at >= ? AND requested_at < ?) AS requested,
            SUM(issued_at >= ? AND issued_at < ?) AS issued,
            SUM(status IN ('PENDING','PRICED','PAID','IN_PROGRESS','NOT_SENT')) AS waiting
       FROM certificate_requests WHERE tenant_id=?`,
    [b.startUtc, b.endUtc, b.startUtc, b.endUtc, tenantId]
  );
  const [[messages]] = await db.query(
    `SELECT SUM(created_at >= ? AND created_at < ?) AS received, SUM(status='NEW') AS unread
       FROM contact_messages WHERE tenant_id=?`,
    [b.startUtc, b.endUtc, tenantId]
  );
  const [[consultations]] = await db.query(
    `SELECT SUM(created_at >= ? AND created_at < ?) AS requested,
            SUM(status='PENDING') AS waiting
       FROM consultations WHERE tenant_id=? AND deleted_at IS NULL`,
    [b.startUtc, b.endUtc, tenantId]
  );
  const [[refunds]] = await db.query(
    `SELECT SUM(created_at >= ? AND created_at < ?) AS requested, SUM(status='PENDING') AS waiting
       FROM refund_requests WHERE tenant_id=? AND deleted_at IS NULL`,
    [b.startUtc, b.endUtc, tenantId]
  );
  const [[satisfaction]] = await db.query(
    `SELECT SUM(sent_at >= ? AND sent_at < ?) AS sent,
            SUM(responded_at >= ? AND responded_at < ?) AS answered,
            AVG(CASE WHEN responded_at >= ? AND responded_at < ? THEN score END) AS score
       FROM nps_responses WHERE tenant_id=?`,
    [b.startUtc, b.endUtc, b.startUtc, b.endUtc, b.startUtc, b.endUtc, tenantId]
  );
  const resolvedBy = byKey(resolved);
  const repliesBy = byKey(replies);
  const escalatedBy = byKey(escalated);
  const rows = agents.map(agent => {
    const id = String(agent.id);
    const email = String(agent.email || '').toLowerCase();
    const c = contacts.get(id) || {};
    const r = resolvedBy.get(id) || {};
    return {
      id, name: agent.name,
      calls: num(c.calls), whatsapp: num(c.whatsapp), reached: num(c.reached),
      clientsReviewed: num(reviewed.get(email)?.n),
      problemsResolved: num(r.resolved), replies: num(repliesBy.get(id)?.replies),
      certificatesHandled: num(certificates.get(email)?.n),
      ratings: num(r.rated), ratingAvg: r.csat === null || r.csat === undefined ? null : Number(Number(r.csat).toFixed(1)),
      refundsEscalated: num(escalatedBy.get(id)?.n),
    };
  });
  return {
    team: 'support', from, to, today, rows,
    totals: {
      calls: sumRows(rows, 'calls'), clientsReviewed: sumRows(rows, 'clientsReviewed'),
      problemsResolved: num(tickets?.resolved), problemsOpened: num(tickets?.opened), problemsOpen: num(tickets?.stillOpen),
      certificatesRequested: num(certs?.requested), certificatesIssued: num(certs?.issued), certificatesWaiting: num(certs?.waiting),
      contactMessages: num(messages?.received), contactUnread: num(messages?.unread),
      consultationsRequested: num(consultations?.requested), consultationsWaiting: num(consultations?.waiting),
      refundsRequested: num(refunds?.requested), refundsWaiting: num(refunds?.waiting),
      surveysSent: num(satisfaction?.sent), surveysAnswered: num(satisfaction?.answered),
      surveyScore: satisfaction?.score === null || satisfaction?.score === undefined ? null : Number(Number(satisfaction.score).toFixed(1)),
    },
  };
}

// ── فريق الدقي (ومثله فريق التجمع) ──────────────────────────────────────────
// A physical branch's team: its manager and its reception, its clients, the
// money taken at it and its rounds (lib/physicalBranches.js).
async function buildBranchTeamReport({ tenantId, from, to, today, branch = 'DAQQI' }, db = pool) {
  const b = bounds(from, to);
  const def = PHYSICAL_BRANCHES[branch] || PHYSICAL_BRANCHES.DAQQI;
  const members = await staffInRoles(db, tenantId, [def.managerRole, def.receptionRole]);
  const contacts = await contactsByStaff(db, tenantId, b);
  const [created] = await db.query(
    `SELECT LOWER(a.actor) AS rep, COUNT(DISTINCT a.entity_id) AS n
       FROM activity_logs a
       JOIN subscribers s ON s.id=a.entity_id AND s.tenant_id=a.tenant_id AND s.branch=?
      WHERE a.tenant_id=? AND a.at >= ? AND a.at < ? AND a.entity='subscribers' AND a.action='create'
      GROUP BY LOWER(a.actor)`,
    [def.key, tenantId, b.startUtc, b.endUtc]
  );
  const [recorded] = await db.query(
    `SELECT p.staff_id AS rep, COUNT(*) AS payments, SUM(${MONEY_EGP}) AS moneyEgp
       FROM payments p
      WHERE p.tenant_id=? AND p.deleted_at IS NULL AND (p.status IS NULL OR p.status='paid') AND p.date >= ? AND p.date < ?
      GROUP BY p.staff_id`,
    [tenantId, from, b.dayAfter]
  );
  const [leads] = await db.query(
    `SELECT assigned_sales_id AS rep, COUNT(*) AS received, SUM(status='converted') AS converted
       FROM leads
      WHERE tenant_id=? AND hidden=0 AND assigned_at >= ? AND assigned_at < ?
      GROUP BY assigned_sales_id`,
    [tenantId, b.startUtc, b.endUtc]
  );
  const [[money]] = await db.query(
    `SELECT COUNT(*) AS payments, SUM(p.is_installment=0) AS bookings, SUM(${MONEY_EGP}) AS moneyEgp
       FROM payments p
      WHERE p.tenant_id=? AND p.deleted_at IS NULL AND (p.status IS NULL OR p.status='paid') AND p.date >= ? AND p.date < ? AND p.branch=?`,
    [tenantId, from, b.dayAfter, def.key]
  );
  const [[clients]] = await db.query(
    `SELECT SUM(created_at >= ? AND created_at < ?) AS newClients, COUNT(*) AS allClients
       FROM subscribers WHERE tenant_id=? AND deleted_at IS NULL AND branch=?`,
    [b.startUtc, b.endUtc, tenantId, def.key]
  );
  const [[rounds]] = await db.query(
    "SELECT SUM(status='ACTIVE') AS active, COUNT(*) AS total FROM daqqi_rounds WHERE tenant_id=? AND branch=?",
    [tenantId, def.key]
  );
  const createdBy = byKey(created);
  const recordedBy = byKey(recorded);
  const leadsBy = byKey(leads);
  const rows = members.map(member => {
    const id = String(member.id);
    const c = contacts.get(id) || {};
    const r = recordedBy.get(id) || {};
    const l = leadsBy.get(id) || {};
    return {
      id, name: member.name, role: member.role,
      calls: num(c.calls), whatsapp: num(c.whatsapp), reached: num(c.reached),
      newClients: num(createdBy.get(String(member.email || '').toLowerCase())?.n),
      payments: num(r.payments), moneyEgp: Math.round(num(r.moneyEgp)),
      leadsReceived: num(l.received), leadsConverted: num(l.converted),
    };
  });
  return {
    team: def.key === 'DAQQI' ? 'daqqi' : def.key.toLowerCase(), from, to, today, rows,
    totals: {
      calls: sumRows(rows, 'calls'), newClients: num(clients?.newClients), allClients: num(clients?.allClients),
      payments: num(money?.payments), bookings: num(money?.bookings), moneyEgp: Math.round(num(money?.moneyEgp)),
      leadsReceived: sumRows(rows, 'leadsReceived'),
      activeRounds: num(rounds?.active), rounds: num(rounds?.total),
    },
  };
}

const buildDaqqiTeamReport = (options, db) => buildBranchTeamReport({ ...options, branch: 'DAQQI' }, db);
const buildTagamoaTeamReport = (options, db) => buildBranchTeamReport({ ...options, branch: 'TAGAMOA' }, db);

const TEAM_REPORTS = {
  online: buildOnlineTeamReport,
  support: buildSupportTeamReport,
  daqqi: buildDaqqiTeamReport,
  tagamoa: buildTagamoaTeamReport,
};

module.exports = { TEAM_REPORTS, buildBranchTeamReport, buildDaqqiTeamReport, buildTagamoaTeamReport, buildOnlineTeamReport, buildSupportTeamReport, MONEY_EGP };
