'use strict';

// «ليه اصلا اسم هنا مش بيظهر وبيظهر الايميل؟ … اسم الموظف اللى يظهر مش الايميل
// ابدا» (8 Oct 2026). Who did something is stored as a staff id in some places
// and as the signed-in address in others (an enrolment, a course opened, a
// period-close request). Every screen that shows it asks here: an id or an
// address becomes the employee's name, the owner's address «الإدارة», and an
// address no employee has any more «موظف سابق» — never the address itself.

const { pool } = require('./db');

const SYSTEM = { system: 'النظام', admin: 'الإدارة', autopilot: 'النظام', 'ai-autopilot': 'المساعد الذكي (تلقائي)' };
const ownerAddresses = () => String(process.env.ADMIN_EMAILS || '')
  .split(',').map(value => value.trim().toLowerCase()).filter(Boolean);
const looksLikeAddress = value => /@/.test(String(value || ''));

// A tenant's employees, read once a minute: lists of thousands of rows (every
// payment's «بواسطة») resolve their names without a query each.
const directories = new Map();
async function staffDirectory(tenantId, db = pool) {
  const cached = directories.get(tenantId);
  if (cached && Date.now() - cached.at < 60_000) return cached.resolve;
  // The whole (short) staff list, matched here: lower-casing the column in SQL
  // would defeat its index for every caller.
  const [people] = await db.query('SELECT id, name, email FROM staff WHERE tenant_id=?', [tenantId]);
  const byId = new Map(people.map(person => [String(person.id), person.name]));
  const byAddress = new Map(people.filter(person => person.email).map(person => [String(person.email).trim().toLowerCase(), person.name]));
  const owners = new Set(ownerAddresses());
  const resolve = value => {
    const text = String(value ?? '').trim();
    if (!text) return value;
    if (byId.has(text)) return byId.get(text);
    if (!looksLikeAddress(text)) return SYSTEM[text.toLowerCase()] || text;
    const lower = text.toLowerCase();
    return byAddress.get(lower) || (owners.has(lower) ? 'الإدارة' : 'موظف سابق');
  };
  directories.set(tenantId, { at: Date.now(), resolve });
  return resolve;
}

/** A map from every actor value given to the name to show for it. */
async function staffNames(tenantId, actors, db = pool) {
  const resolve = await staffDirectory(tenantId, db);
  return new Map([...new Set((actors || []).map(value => String(value || '').trim()).filter(Boolean))]
    .map(value => [value, resolve(value)]));
}

/** Who signs a row being written: the employee's name, the owner as «الإدارة» — never the address. */
function signerName(req) {
  return req?.staffRecord?.name || (req?.isSuperAdmin ? 'الإدارة' : null) || req?.user?.name || 'الإدارة';
}

/** The rows with their `field` shown by name (the field itself replaced). */
async function withStaffNames(tenantId, rows, field, db = pool) {
  const names = await staffNames(tenantId, rows.map(row => row?.[field]), db);
  return rows.map(row => (row && row[field] ? { ...row, [field]: names.get(String(row[field]).trim()) || row[field] } : row));
}

module.exports = { signerName, staffDirectory, staffNames, withStaffNames, looksLikeAddress };
