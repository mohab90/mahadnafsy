'use strict';

// A collection officer's sheet, synced: «اقدر اضيف لينك الشيت وتنزل الداتا
// باسمه ولازم تمنع ان يكون في مكرر واي عميل بيترفع لازم يسجل باسم مسئول
// التحصيل».
//
// Every row becomes a client under that officer, once:
//   - someone already on the system (same phone or email) is not created
//     again. If nobody holds them they are handed to this officer; if another
//     officer holds them they stay, and the run says how many;
//   - a new person is created with the officer set, in «محلي قديم» or «دولي
//     قديم» as the sheet says, enrolled in the course the sheet names;
//   - the sheet's course price lands as the client's price for the course, and
//     the price less the sheet's remaining (or, with no remaining column, what
//     was collected — «المحصل») as «مدفوع قبل السيستم»: money paid before the
//     system, counted in every balance and never as revenue.
//
// The same import serves an uploaded file (the screen parses it and sends the
// rows) and a linked Google Sheet (fetched and parsed here), so both dedupe
// and assign the same way. Linked sheets are synced again every half hour.

const { pool } = require('./db');
const { uuidv4 } = require('./id');
const logger = require('./logger');
const { toIdentity } = require('./phoneNumber');
const { getNextClientCode } = require('./mappers');
const { branchIdForBranch } = require('./branches');
const { matchCourseId } = require('./courseMatch');
const { grantCourseSelections } = require('./entitlements');
const { findLeadByContact } = require('./leadMatching');
const { transitionLead } = require('./leadState');
const { fetchCsvFollowRedirects, isHtmlResponse } = require('./sheets');
const { setTenantSetting } = require('./tenantSettings');
const { loadCollectionConfig, pickCollectionOfficer, subscriberMarket } = require('./collectionDistribution');
const { detectLayout, paidBefore, parseAmount, splitPhones, tabClientRows } = require('./sheetCells');
const { cairoToday } = require('./dates');

const { parseCsv } = require('./csv');

// A linked sheet read the way the import screens read an uploaded file
// (sheetCells.js): the heading row found, or the columns told apart by what is
// in them, and every cell cleaned.
function sheetRows(text) {
  const rows = parseCsv(text);
  return tabClientRows({ name: 'sheet', rows }, detectLayout(rows)).filter(row => row._name || row._phone);
}

const cell = value => String(value ?? '').trim();
const amount = value => parseAmount(value) || 0;
// The sheet's date for a new client, when it is one: not before 2015, not ahead of today.
const sheetDate = value => (/^\d{4}-\d{2}-\d{2}$/.test(cell(value)) && cell(value) >= '2015-01-01'
  && cell(value) <= cairoToday() ? `${cell(value)} 12:00:00` : null);

// One new client, in one transaction: the row, the course the sheet names (as
// the old-data import always enrolled it) and the lead they came from, if any.
async function createClient(conn, { tenantId, staff, kind, branch: chosenBranch, source, row, email, phone, otherPhones = [], courseId, actor }) {
  const branch = chosenBranch || (kind === 'old_intl' ? 'ONLINE_ABROAD' : 'ONLINE_EGYPT');
  const branchId = branchIdForBranch(branch);
  const paid = amount(row._paid);
  const expected = amount(row._expected);
  // «مدفوع قبل السيستم» is the price less what the sheet says is still owed —
  // the figure the desk keeps — or, with no remaining column, what it says
  // was collected.
  const prior = paidBefore(row);
  const crm = {
    clientStatus: kind, status: 'active', source,
    ...(courseId && expected > 0 ? { customPrices: { [courseId]: expected } } : {}),
    ...(courseId && prior > 0 ? { priorPaid: { [courseId]: prior } } : {}),
  };
  // A refund, and a collected figure that disagrees with the remaining, are
  // shown rather than netted; what could not be tied to a course stays
  // readable on the client.
  const refund = amount(row._refund);
  const stated = parseAmount(row._remaining);
  const course = cell(row._course);
  const notes = [cell(row._notes),
    refund > 0 ? `استرداد سابق: ${refund}` : '',
    stated !== null && paid > 0 && expected - paid !== stated ? `المحصل في الملف ${paid} والمتبقي ${stated} — اتحسب المتبقي` : '',
    otherPhones.length ? `أرقام تانية: ${otherPhones.join(' ، ')}` : '',
    ...(Array.isArray(row._issues) ? row._issues.map(cell) : []),
    cell(row._officer) && !staff ? `مسئول التحصيل في الشيت: ${cell(row._officer)}` : '',
    cell(row._sales) ? `المبيعات في الشيت: ${cell(row._sales)}` : '',
    cell(row._cert) ? `شهادة: ${cell(row._cert)}` : '',
    cell(row._attendance) ? `حضور: ${cell(row._attendance)}` : '',
    !courseId && course ? `الكورس: ${course}` : '',
    !courseId && paid > 0 ? `المحصل: ${paid}` : '',
    !courseId && expected > 0 ? `قيمة الكورس: ${expected}` : '',
    !courseId && stated !== null && course ? `المتبقي: ${stated}` : '']
    .filter(Boolean).join(' | ').slice(0, 2000) || null;
  const id = uuidv4();
  await conn.beginTransaction();
  try {
    await conn.query(
      `INSERT INTO subscribers
         (id, tenant_id, client_code, name, email, phone, branch, branch_id, is_active, notes,
          assigned_cs_id, assigned_cs_name, crm_json, source, created_at)
       VALUES (?,?,?,?,?,?,?,?,1,?,?,?,?,?,COALESCE(?, NOW()))`,
      [id, tenantId, await getNextClientCode(conn), (cell(row._name) || phone || '').slice(0, 255), email || null,
        phone || null, branch, branchId, notes, staff?.id || null, staff?.name || null, JSON.stringify(crm),
        String(source).slice(0, 100), sheetDate(row._date)]);
    if (courseId) {
      await grantCourseSelections({
        tenantId, subscriberId: id, selections: [{ courseId }], branchId, source: 'collection_sheet', actor,
      }, conn);
    }
    const lead = await findLeadByContact(conn, { tenantId, phone, email });
    if (lead) {
      await conn.query('UPDATE subscribers SET lead_id=? WHERE id=? AND tenant_id=? AND lead_id IS NULL', [lead.id, id, tenantId]);
      await transitionLead({
        tenantId, leadId: lead.id, toStatus: 'converted', db: conn, actor,
        reason: 'Subscriber linked and lead converted', metadata: { subscriberId: id },
      });
    }
    await conn.commit();
  } catch (error) {
    await conn.rollback().catch(() => {});
    throw error;
  }
  return id;
}

/**
 * Import rows under one officer. `rows`: the old-data screen's rows ({ _name,
 * _phone, _email, _course, _paid, _expected, … }). Returns { created, assigned,
 * skipped, others, failed }.
 *
 * The online desk's import («استيراد عملاء» in the tab's settings) runs the
 * same rows with no officer (`staff` null: created unassigned, someone already
 * on the system left as they are) and may name the branch, for «النشطين»
 * in riyal or dollar.
 */
async function importCollectionRows({ tenantId, staff = null, kind = 'old_local', branch = null, source = 'شيت تحصيل', rows, actor = null, autoAssign = false }, db = pool) {
  const conn = await db.getConnection();
  try {
    const [existing] = await conn.query(
      'SELECT id, phone, email, assigned_cs_id FROM subscribers WHERE tenant_id=? AND deleted_at IS NULL', [tenantId]);
    const byPhone = new Map();
    const byEmail = new Map();
    for (const row of existing) {
      const identity = toIdentity(row.phone);
      if (identity) byPhone.set(identity, row);
      if (row.email) byEmail.set(String(row.email).trim().toLowerCase(), row);
    }
    const [courses] = await conn.query('SELECT id, title FROM courses WHERE tenant_id=? AND deleted_at IS NULL', [tenantId]);
    const [bundles] = await conn.query('SELECT id, title FROM bundles WHERE tenant_id=? AND deleted_at IS NULL', [tenantId]);

    const result = { created: 0, assigned: 0, skipped: 0, others: 0, failed: 0 };
    const seen = new Set();
    for (const row of rows || []) {
      // The cell cleaned again here: a row from an older screen, or a linked
      // sheet, may still carry «01558282609-01050954780» or a dropped zero.
      const { phones } = splitPhones(cell(row._phone));
      const phonesAll = [...phones, ...splitPhones(cell(row._otherPhones)).phones.filter(phone => !phones.includes(phone))];
      const identities = phonesAll.map(toIdentity).filter(Boolean);
      const identity = identities[0] || '';
      const email = cell(row._email).toLowerCase();
      // A row with neither a phone nor an email cannot be told apart from
      // anyone, so it is not created at all.
      const key = identity || email;
      if (!key || seen.has(key)) { result.skipped += 1; continue; }
      identities.forEach(each => seen.add(each));
      seen.add(key);

      const found = identities.map(id => byPhone.get(id)).find(Boolean) || (email && byEmail.get(email)) || null;
      if (found) {
        if (!staff) {
          result.skipped += 1;
        } else if (!found.assigned_cs_id) {
          await conn.query('UPDATE subscribers SET assigned_cs_id=?, assigned_cs_name=? WHERE id=? AND tenant_id=?',
            [staff.id, staff.name, found.id, tenantId]);
          found.assigned_cs_id = staff.id;
          result.assigned += 1;
        } else if (String(found.assigned_cs_id) === String(staff.id)) {
          result.skipped += 1;
        } else {
          result.others += 1;
        }
        continue;
      }

      try {
        const courseId = cell(row._course) ? matchCourseId(cell(row._course), courses, bundles) : null;
        // The old-data screens hand a new client to collection by the
        // distribution rules, as a client added by hand is.
        const officer = staff || (autoAssign ? await pickCollectionOfficer(conn, tenantId, {
          market: subscriberMarket({ branch: branch || (kind === 'old_intl' ? 'ONLINE_ABROAD' : 'ONLINE_EGYPT') }),
        }) : null);
        const id = await createClient(conn, {
          tenantId, staff: officer, kind, branch, source, row, email, phone: phonesAll[0] || null, otherPhones: phonesAll.slice(1), courseId, actor,
        });
        const created = { id, assigned_cs_id: officer?.id || null };
        identities.forEach(each => byPhone.set(each, created));
        if (email) byEmail.set(email, created);
        result.created += 1;
      } catch (error) {
        result.failed += 1;
        logger.warn('[collection-sheets] row not imported', { error: error.message });
      }
    }
    return result;
  } finally {
    conn.release();
  }
}

async function officerById(db, tenantId, staffId) {
  const [[staff]] = await db.query(
    `SELECT id, name FROM staff WHERE id=? AND tenant_id=? AND UPPER(role)='COLLECTION'
        AND is_active=1 AND deleted_at IS NULL LIMIT 1`, [staffId, tenantId]);
  return staff || null;
}

function refused(message, statusCode) {
  return Object.assign(new Error(message), { statusCode });
}

/** Fetch one linked sheet and import it under its officer; the run is recorded on the sheet. */
async function syncCollectionSheet(tenantId, sheetId, { actor = 'collection-sheet-sync', db = pool } = {}) {
  const sheet = (await loadCollectionConfig(db, tenantId)).sheets.find(entry => entry.id === sheetId);
  if (!sheet) throw refused('الشيت مش موجود', 404);
  const staff = await officerById(db, tenantId, sheet.staffId);
  if (!staff) throw refused('مسئول التحصيل ده مش نشط', 409);
  const csv = await fetchCsvFollowRedirects(
    `https://docs.google.com/spreadsheets/d/${sheet.sheetId}/export?format=csv${sheet.gid ? `&gid=${sheet.gid}` : ''}`);
  if (!csv || isHtmlResponse(csv.slice(0, 500))) throw refused('الشيت مش متاح — خليه «أي حد معاه الرابط يقدر يشوف»', 422);
  const result = await importCollectionRows({
    tenantId, staff, kind: sheet.clientStatus, source: `شيت ${sheet.name || staff.name}`, rows: sheetRows(csv), actor,
  }, db);
  // Re-read before writing, so a sheet linked meanwhile is not dropped.
  const latest = await loadCollectionConfig(db, tenantId);
  latest.sheets = latest.sheets.map(entry => (entry.id === sheetId
    ? { ...entry, lastSyncAt: new Date().toISOString(), lastResult: result } : entry));
  await setTenantSetting('collection_distribution', latest, { tenantId, db });
  return result;
}

/** Every linked sheet set to sync, in every tenant, for the half-hourly job. */
async function syncAllCollectionSheets() {
  const [tenants] = await pool.query("SELECT tenant_id FROM tenant_settings WHERE section='collection_distribution'");
  let created = 0;
  for (const { tenant_id: tenantId } of tenants) {
    const { sheets } = await loadCollectionConfig(pool, tenantId);
    for (const sheet of sheets.filter(entry => entry.autoSync)) {
      try {
        created += (await syncCollectionSheet(tenantId, sheet.id)).created;
      } catch (error) {
        logger.warn('[collection-sheets] sync failed', { sheet: sheet.name || sheet.id, error: error.message });
      }
    }
  }
  return { created };
}

module.exports = { importCollectionRows, officerById, parseCsv, sheetRows, syncAllCollectionSheets, syncCollectionSheet };
