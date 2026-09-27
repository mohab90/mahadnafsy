'use strict';

const { pool } = require('./db');
const { uuidv4 } = require('./id');

function normalizeBranch(value) {
  return String(value || '*').trim().toUpperCase().replace(/[-\s]/g, '_') || '*';
}

// A course entry as the leads table stores it: a course id, or 'bundle:<id>'
// for a track. An older save left some tracks as the bare bundle id.
function courseKey(value) {
  const id = String(value || '').trim();
  return /^b-/.test(id) ? `bundle:${id}` : id;
}

const sourceKey = value => String(value || '').trim().toLowerCase();

// A stored rule list: a JSON array, or NULL for "all". Empty means all too, so
// clearing every box can never quietly mean "nothing".
function parseRuleList(value) {
  if (value == null || value === '') return null;
  let list = value;
  if (typeof value === 'string') {
    try { list = JSON.parse(value); } catch { return null; }
  }
  if (!Array.isArray(list)) return null;
  const clean = [...new Set(list.map(item => String(item || '').trim()).filter(Boolean))];
  return clean.length ? clean : null;
}

// What a lead is, for routing: where it came from and what it asked about.
// Takes a leads row (source, interested_course_ids_json, crm_json) or the
// same facts already in hand ({ source, courseIds }).
function leadRoutingFacts(lead) {
  if (!lead) return null;
  let courseIds = lead.courseIds;
  if (!Array.isArray(courseIds)) {
    courseIds = parseRuleList(lead.interested_course_ids_json);
    if (!courseIds && lead.crm_json) {
      try { courseIds = parseRuleList(JSON.parse(lead.crm_json).interestedCourseIds); } catch { courseIds = null; }
    }
  }
  return { source: lead.source || '', courseIds: (courseIds || []).map(courseKey).filter(Boolean) };
}

// Whether a rep's rules take this lead. No lead in hand (a caller that has not
// said what it is placing) takes everyone, as before; a rep with no rules takes
// every lead. A rule on courses takes a lead that asked for any one of them — a
// lead that named no course goes only to reps who take all courses.
function repTakesLead(rep, lead) {
  const facts = leadRoutingFacts(lead);
  if (!facts) return true;
  const courses = parseRuleList(rep.courseIds);
  if (courses) {
    const wanted = new Set(courses.map(courseKey));
    if (!facts.courseIds.some(id => wanted.has(id))) return false;
  }
  const sources = parseRuleList(rep.sources);
  if (sources && !sources.map(sourceKey).includes(sourceKey(facts.source))) return false;
  return true;
}

async function listAssignmentMembers(tenantId, db = pool) {
  const [rows] = await db.query(
    `SELECT p.id,p.staff_id AS staffId,s.name AS staffName,p.branch_key AS branchKey,
            p.team_key AS teamKey,p.weight,p.max_open_leads AS maxOpenLeads,
            p.is_available AS isAvailable,p.last_assigned_at AS lastAssignedAt,
            p.intake_limit AS intakeLimit,p.intake_period AS intakePeriod,
            p.course_ids_json AS courseIdsJson,p.sources_json AS sourcesJson
       FROM crm_assignment_members p
       JOIN staff s ON s.id=p.staff_id AND s.tenant_id=p.tenant_id
        AND s.is_active=1 AND s.deleted_at IS NULL AND UPPER(s.role)='SALES'
      WHERE p.tenant_id=? ORDER BY p.team_key,p.branch_key,s.name`,
    [tenantId]
  );
  return rows.map(({ courseIdsJson, sourcesJson, ...row }) => ({
    ...row,
    courseIds: parseRuleList(courseIdsJson) || [],
    sources: parseRuleList(sourcesJson) || [],
    weight: Number(row.weight || 1),
    maxOpenLeads: row.maxOpenLeads == null ? null : Number(row.maxOpenLeads),
    intakeLimit: row.intakeLimit == null ? null : Number(row.intakeLimit),
    intakePeriod: row.intakePeriod || 'day',
    isAvailable: Boolean(row.isAvailable),
  }));
}

async function saveAssignmentMembers(tenantId, members, db = pool) {
  if (!Array.isArray(members)) {
    const error = new Error('Assignment members are required'); error.statusCode = 400; throw error;
  }
  // Checked in one pass, before anything is written, and reported by name.
  //
  // This used to throw "Active sales staff not found" on the first bad row and
  // stop — no name, no id, no hint which of the six members it meant. The CRM
  // settings modal saves the sources, the pipeline and this list together, so a
  // member whose role changed to COLLECTION after they were added made saving
  // the *Google Sheets* configuration fail with a message about sales staff.
  // Whoever hit it had no way to know who to remove or which tab to look at.
  const invalid = [];
  for (const member of members) {
    const staffId = String(member.staffId || '');
    const [[row]] = await db.query(
      `SELECT id, name, role, is_active, deleted_at FROM staff
        WHERE tenant_id=? AND id=? LIMIT 1`,
      [tenantId, staffId]
    );
    // getNextSalesRep only ever picks staff whose role is SALES, so a member who
    // is anything else can never be handed a lead — keeping the row would be a
    // silent no-op rather than a working configuration.
    const usable = row && String(row.role || '').toUpperCase() === 'SALES'
      && Number(row.is_active) === 1 && !row.deleted_at;
    if (!usable) {
      const who = row?.name || member.staffName || staffId || '(بدون اسم)';
      invalid.push(!row ? `${who}: غير موجود`
        : row.deleted_at ? `${who}: محذوف`
          : Number(row.is_active) !== 1 ? `${who}: غير نشط`
            : `${who}: دوره ${row.role} وليس SALES`);
    }
  }
  if (invalid.length) {
    const error = new Error(
      `تعذّر حفظ توزيع العملاء المحتملين — الأعضاء دول مش ضمن فريق المبيعات النشط: ${invalid.join(' · ')}. `
      + 'شيلهم من تبويب «التوزيع» وجرّب تاني.'
    );
    error.statusCode = 409;
    throw error;
  }

  for (const member of members) {
    const staffId = String(member.staffId || '');
    const branchKey = normalizeBranch(member.branchKey);
    const teamKey = String(member.teamKey || 'sales').trim().toLowerCase().slice(0, 64);
    const weight = Math.min(Math.max(Number(member.weight) || 1, 0.1), 100);
    const maxOpenLeads = member.maxOpenLeads === '' || member.maxOpenLeads == null
      ? null : Math.min(Math.max(Number(member.maxOpenLeads) || 0, 0), 100000);
    // A cap on what arrives, beside the cap on what is held. Blank and zero
    // both mean no rate cap: a zero would otherwise read as "assign nobody",
    // which is what is_available already says more clearly.
    const intakeLimit = member.intakeLimit === '' || member.intakeLimit == null
      || Number(member.intakeLimit) <= 0
      ? null : Math.min(Math.round(Number(member.intakeLimit)), 100000);
    const intakePeriod = ['day', 'fortnight', 'month'].includes(member.intakePeriod)
      ? member.intakePeriod : 'day';
    // Which leads, beside how many: NULL is "all", as it was before these existed.
    const courseIds = parseRuleList(member.courseIds);
    const sources = parseRuleList(member.sources);
    await db.query(
      `INSERT INTO crm_assignment_members
       (id,tenant_id,staff_id,branch_key,team_key,weight,max_open_leads,is_available,intake_limit,intake_period,
        course_ids_json,sources_json)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE weight=VALUES(weight),max_open_leads=VALUES(max_open_leads),
         is_available=VALUES(is_available),intake_limit=VALUES(intake_limit),
         intake_period=VALUES(intake_period),course_ids_json=VALUES(course_ids_json),
         sources_json=VALUES(sources_json)`,
      [member.id || uuidv4(), tenantId, staffId, branchKey, teamKey, weight, maxOpenLeads,
        member.isAvailable === false ? 0 : 1, intakeLimit, intakePeriod,
        courseIds ? JSON.stringify([...new Set(courseIds.map(courseKey))]) : null,
        sources ? JSON.stringify(sources) : null]
    );
  }

  // The payload is the whole intended list, so anyone no longer in it has been
  // removed and their row has to go with them. Without this the function only
  // ever inserted and updated: taking someone out of the list in the UI and
  // saving returned ok:true and left them in the table, so a member could be
  // added but never removed — including the one whose stale row was blocking
  // every save of this screen.
  const keepIds = [...new Set(members.map(member => String(member.staffId || '')).filter(Boolean))];
  if (keepIds.length) {
    await db.query(
      `DELETE FROM crm_assignment_members
        WHERE tenant_id=? AND staff_id NOT IN (${keepIds.map(() => '?').join(',')})`,
      [tenantId, ...keepIds]
    );
  } else {
    // An empty list means "distribute to nobody", which is a real choice — the
    // round-robin then falls back to every active SALES rep unweighted.
    await db.query('DELETE FROM crm_assignment_members WHERE tenant_id=?', [tenantId]);
  }
  return listAssignmentMembers(tenantId, db);
}

module.exports = {
  leadRoutingFacts, listAssignmentMembers, normalizeBranch, parseRuleList, repTakesLead, saveAssignmentMembers,
};
