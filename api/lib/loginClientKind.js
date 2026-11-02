'use strict';
/**
 * Who a sign-in belongs to in the client base (2 Nov 2026: «لازم شيت تسجيل الدخول يقرا إن دا نفس العميل الحاجز عندنا مينفعش يقرا على إنه عميل
 * محتمل تاني أو عميل مختلف … عمود الفرع: أونلاين محلي أو دولي أو سعودي أو الدقي أو محتمل»).
 *
 * The sign-in pages joined a login to its client only through subscribers.firebase_uid, the link a client gets the first time they open their own
 * page. A client who signed in and never opened it — or whose number is stored as 01XXXXXXXXX while the account holds 1XXXXXXXXX — read as nobody,
 * or as a new lead. This finds the client by every spelling of the number and by the email, the way the account itself is matched
 * (lib/subscriberIdentity.js), and says what the person is: a client of which branch, or a lead.
 *
 * One query for the clients and one for the leads, for a whole page of rows.
 */
const { matchingSpellings } = require('./phoneNumber');

const BRANCH_LABELS = {
  ONLINE_EGYPT: 'أونلاين محلي',
  ONLINE_ABROAD: 'أونلاين دولي',
  ONLINE_SAUDI: 'أونلاين سعودي',
  DAQQI: 'الدقي',
  TAGAMOA: 'التجمع',
};
const branchLabel = branch => BRANCH_LABELS[String(branch || '').toUpperCase()] || 'أونلاين محلي';

/**
 * @param db  pool
 * @param {{ tenantId: string, people: { key: string, phone?: string|null, email?: string|null, subscriberId?: string|null }[] }} input
 * @returns {Promise<Map<string, { kind: 'client'|'lead'|'none', branch_label: string, subscriber_id: string|null, client_code: string|null, lead_id: string|null, also_lead: boolean }>>}
 */
async function clientKinds(db, { tenantId, people }) {
  const result = new Map();
  const spellingsOf = new Map();
  const wanted = new Set();
  const emails = new Set();
  const emailOf = new Map();
  for (const person of people) {
    const spellings = matchingSpellings(person.phone).filter(Boolean);
    spellingsOf.set(person.key, spellings);
    spellings.forEach(value => wanted.add(value));
    const email = String(person.email || '').trim().toLowerCase();
    if (email) { emails.add(email); emailOf.set(person.key, email); }
  }

  const clients = [];
  const byDigits = new Map();
  const byEmail = new Map();
  if (wanted.size || emails.size || people.some(person => person.subscriberId)) {
    const terms = [];
    const params = [tenantId];
    if (wanted.size) { terms.push(`phone_digits IN (${[...wanted].map(() => '?').join(',')})`); params.push(...wanted); }
    if (emails.size) { terms.push(`email IN (${[...emails].map(() => '?').join(',')})`); params.push(...emails); }
    const ids = [...new Set(people.map(person => person.subscriberId).filter(Boolean))];
    if (ids.length) { terms.push(`id IN (${ids.map(() => '?').join(',')})`); params.push(...ids); }
    const [rows] = await db.query(
      `SELECT id, client_code, name, branch, phone_digits, LOWER(TRIM(email)) AS email_key FROM subscribers
        WHERE tenant_id=? AND deleted_at IS NULL AND (${terms.join(' OR ')}) LIMIT 5000`, params);
    for (const row of rows) {
      clients.push(row);
      if (row.phone_digits) byDigits.set(String(row.phone_digits), row);
      if (row.email_key) byEmail.set(row.email_key, row);
    }
  }
  const clientById = new Map(clients.map(row => [String(row.id), row]));

  const leadsByDigits = new Map();
  const leadsByEmail = new Map();
  if (wanted.size || emails.size) {
    const terms = [];
    const params = [tenantId];
    if (wanted.size) { terms.push(`phone_digits IN (${[...wanted].map(() => '?').join(',')})`); params.push(...wanted); }
    if (emails.size) { terms.push(`email IN (${[...emails].map(() => '?').join(',')})`); params.push(...emails); }
    const [rows] = await db.query(
      `SELECT id, client_code, name, phone_digits, LOWER(TRIM(email)) AS email_key FROM leads
        WHERE tenant_id=? AND (hidden IS NULL OR hidden=0) AND (${terms.join(' OR ')}) ORDER BY created_at DESC LIMIT 5000`, params);
    for (const row of rows) {
      if (row.phone_digits && !leadsByDigits.has(String(row.phone_digits))) leadsByDigits.set(String(row.phone_digits), row);
      if (row.email_key && !leadsByEmail.has(row.email_key)) leadsByEmail.set(row.email_key, row);
    }
  }

  for (const person of people) {
    const spellings = spellingsOf.get(person.key) || [];
    const client = (person.subscriberId && clientById.get(String(person.subscriberId)))
      || spellings.map(value => byDigits.get(value)).find(Boolean)
      || (emailOf.get(person.key) && byEmail.get(emailOf.get(person.key)))
      || null;
    const lead = spellings.map(value => leadsByDigits.get(value)).find(Boolean)
      || (emailOf.get(person.key) && leadsByEmail.get(emailOf.get(person.key)))
      || null;
    if (client) {
      result.set(person.key, {
        kind: 'client', branch_label: branchLabel(client.branch), subscriber_id: String(client.id), client_code: client.client_code || null, name: client.name || null,
        lead_id: lead ? String(lead.id) : null, also_lead: Boolean(lead),
      });
    } else if (lead) {
      result.set(person.key, { kind: 'lead', branch_label: 'محتمل', subscriber_id: null, client_code: lead.client_code || null, name: lead.name || null, lead_id: String(lead.id), also_lead: false });
    } else {
      result.set(person.key, { kind: 'none', branch_label: '—', subscriber_id: null, client_code: null, name: null, lead_id: null, also_lead: false });
    }
  }
  return result;
}

module.exports = { BRANCH_LABELS, branchLabel, clientKinds };
