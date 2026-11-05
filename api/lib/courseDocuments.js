'use strict';

/**
 * Three PDFs per course, each opened by what the client has paid (5 Nov 2026).
 *
 *   FREE            anybody — the course page shows it to every visitor
 *   FIRST_PAYMENT   a client who booked the course and paid a first payment on it
 *   EIGHTY_PERCENT  the full document, once 80% or more of the course's price is paid
 *
 * The file lives in a private folder (COURSE_DOCUMENT_DIR, default <api>/uploads/documents — nothing serves it as a static path) and is handed out only by the route
 * that asks this module, per request, who may open it. A PDF's address is never sent to a screen: a screen is sent the file's name, its size and whether it is open
 * for the person looking, and asks the server for the file.
 *
 * «Paid» is the same balance every other screen shows (lib/agreedPrice.js itemBalances): the payments that are paid, in the course's own currency, plus what was paid
 * before the system; a course inside a track the client holds is read through the track, as the lists do (balanceFor).
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { uuidv4 } = require('./id');
const { safeTenantSegment } = require('./uploadSafety');
const { itemBalances, balanceFor } = require('./agreedPrice');
const { resolveSubscriberRow } = require('./subscriberIdentity');

const ROOT = path.resolve(process.env.COURSE_DOCUMENT_DIR || path.join(__dirname, '..', 'uploads', 'documents'));
const TEMP_DIR = path.join(ROOT, '.tmp');
// A release replaces the API's folder, so documents kept inside it would go with the next deploy (as videos would: VIDEO_UPLOAD_DIR). The server says so at boot.
const RELEASE_ROOT = path.resolve(__dirname, '..');
const ROOT_IN_RELEASE = ROOT === RELEASE_ROOT || ROOT.startsWith(`${RELEASE_ROOT}${path.sep}`);
const TIERS = Object.freeze(['FREE', 'FIRST_PAYMENT', 'EIGHTY_PERCENT']);
const MAX_BYTES = Math.min(Math.max(Number(process.env.COURSE_DOCUMENT_MAX_BYTES) || 50 * 1024 * 1024, 1024 * 1024), 200 * 1024 * 1024);
const EIGHTY_PERCENT = 0.8;

/** What the page tells a visitor a locked file waits for. */
const REQUIREMENT = Object.freeze({
  FREE: 'مجاني مع الكورس',
  FIRST_PAYMENT: 'بعد حجز الكورس ودفع أول قسط',
  EIGHTY_PERCENT: 'بعد دفع 80% أو أكتر من قيمة الكورس',
});

const normalizeTier = value => {
  const tier = String(value || '').trim().toUpperCase().replace(/-/g, '_');
  return TIERS.includes(tier) ? tier : null;
};

const segment = value => (/^[A-Za-z0-9_-]{1,64}$/.test(String(value)) ? String(value) : crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 32));

/** The folder of one course's documents, inside the private root and nowhere else. */
function courseDirectory(tenantId, courseId) {
  const directory = path.resolve(ROOT, safeTenantSegment(tenantId), segment(courseId));
  if (!directory.startsWith(`${ROOT}${path.sep}`)) throw new Error('Invalid document path');
  return directory;
}

function filePathOf(row) {
  const directory = courseDirectory(row.tenant_id, row.course_id);
  const file = path.resolve(directory, row.stored_name);
  if (!file.startsWith(`${directory}${path.sep}`) || path.basename(row.stored_name) !== row.stored_name) throw new Error('Invalid document path');
  return file;
}

/** A PDF starts with «%PDF-» (within its first kilobyte, as readers accept); anything else is refused whatever it is called. */
async function inspectPdf(filePath) {
  const handle = await fs.promises.open(filePath, 'r');
  try {
    const { size } = await handle.stat();
    if (size <= 0) throw new Error('invalid: the file is empty');
    if (size > MAX_BYTES) throw new Error(`invalid: the file is larger than ${Math.round(MAX_BYTES / 1024 / 1024)} MB`);
    const head = Buffer.alloc(Math.min(1024, size));
    await handle.read(head, 0, head.length, 0);
    if (!head.includes(Buffer.from('%PDF-'))) throw new Error('invalid: the file is not a PDF');
    return { size };
  } finally { await handle.close(); }
}

function sha256Of(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    fs.createReadStream(filePath).on('data', chunk => hash.update(chunk)).on('error', reject).on('end', () => resolve(hash.digest('hex')));
  });
}

const cleanName = value => String(value || 'document.pdf').replace(/[\u0000-\u001f\u007f/\\]/g, ' ').trim().slice(0, 300) || 'document.pdf';

async function listDocuments(db, tenantId, courseId) {
  const [rows] = await db.query(
    `SELECT id, tenant_id, course_id, tier, title, original_name, stored_name, size_bytes, uploaded_by, created_at, updated_at
       FROM course_documents WHERE tenant_id=? AND course_id=? ORDER BY FIELD(tier, 'FREE','FIRST_PAYMENT','EIGHTY_PERCENT')`,
    [tenantId, courseId]);
  return rows;
}

const publicShape = row => ({
  tier: row.tier,
  title: row.title,
  fileName: row.original_name,
  size: Number(row.size_bytes) || 0,
  updatedAt: row.updated_at,
});

/**
 * Put `tempPath` (an upload already on this disk) in as the course's document for `tier`, replacing the one that was there. The upload is checked first; the old file is
 * removed only after the new row is in.
 */
async function saveDocument(db, { tenantId, courseId, tier, title, tempPath, originalName, uploadedBy = null }) {
  const { size } = await inspectPdf(tempPath);
  const directory = courseDirectory(tenantId, courseId);
  await fs.promises.mkdir(directory, { recursive: true });
  const storedName = `${tier.toLowerCase()}-${uuidv4()}.pdf`;
  const finalPath = path.resolve(directory, storedName);
  const hash = await sha256Of(tempPath);
  await fs.promises.rename(tempPath, finalPath).catch(async error => {
    if (error.code !== 'EXDEV') throw error;
    await fs.promises.copyFile(tempPath, finalPath);
    await fs.promises.unlink(tempPath).catch(() => {});
  });
  const [[before]] = await db.query('SELECT id, tenant_id, course_id, stored_name FROM course_documents WHERE tenant_id=? AND course_id=? AND tier=? LIMIT 1', [tenantId, courseId, tier]);
  try {
    await db.query(
      `INSERT INTO course_documents (id, tenant_id, course_id, tier, title, original_name, stored_name, size_bytes, sha256, uploaded_by)
       VALUES (?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE title=VALUES(title), original_name=VALUES(original_name), stored_name=VALUES(stored_name), size_bytes=VALUES(size_bytes),
                               sha256=VALUES(sha256), uploaded_by=VALUES(uploaded_by)`,
      [uuidv4(), tenantId, courseId, tier, String(title || '').trim().slice(0, 300) || cleanName(originalName).replace(/\.pdf$/i, ''), cleanName(originalName), storedName, size, hash, uploadedBy]);
  } catch (error) {
    await fs.promises.unlink(finalPath).catch(() => {});
    throw error;
  }
  if (before) await fs.promises.unlink(filePathOf(before)).catch(() => {});
  const [[row]] = await db.query('SELECT * FROM course_documents WHERE tenant_id=? AND course_id=? AND tier=? LIMIT 1', [tenantId, courseId, tier]);
  return publicShape(row);
}

async function removeDocument(db, { tenantId, courseId, tier }) {
  const [[row]] = await db.query('SELECT id, tenant_id, course_id, stored_name FROM course_documents WHERE tenant_id=? AND course_id=? AND tier=? LIMIT 1', [tenantId, courseId, tier]);
  if (!row) return false;
  await db.query('DELETE FROM course_documents WHERE id=? AND tenant_id=?', [row.id, tenantId]);
  await fs.promises.unlink(filePathOf(row)).catch(() => {});
  return true;
}

/**
 * What this request's client has earned of a course's documents.
 * `enrolled` is an active enrolment in the course or in a track that holds it (a course on a limited, preview access counts: it is a booking).
 * `paid` is the money in, in the course's own currency (what the system recorded as paid, plus what was paid before it).
 */
async function clientEarned(db, { tenantId, req, courseId }) {
  const empty = { signedIn: Boolean(req?.user?.uid), subscriberId: null, enrolled: false, paid: 0, expected: 0, open: { FREE: true, FIRST_PAYMENT: false, EIGHTY_PERCENT: false } };
  if (!req?.user?.uid) return empty;
  const subscriber = await resolveSubscriberRow(req, ['id'], db);
  if (!subscriber) return empty;
  const [[enrolment]] = await db.query(
    `SELECT 1 AS yes FROM enrollments e
      WHERE e.tenant_id=? AND e.subscriber_id=? AND e.status='active'
        AND (e.course_id=? OR e.bundle_id IN (SELECT bc.bundle_id FROM bundle_courses bc WHERE bc.tenant_id=e.tenant_id AND bc.course_id=?))
      LIMIT 1`,
    [tenantId, subscriber.id, courseId, courseId]);
  const enrolled = Boolean(enrolment);
  const line = balanceFor(await itemBalances(db, { tenantId, subscriberId: subscriber.id }), String(courseId));
  const paid = (Number(line?.paid) || 0) + (Number(line?.priorPaid) || 0);
  const expected = Number(line?.expected) || 0;
  // a course with no price owes nothing: booking it is enough; otherwise 80% is checked in whole piasters so 79.999 is not 80
  const eighty = enrolled && (expected <= 0 || Math.round(paid * 100) >= Math.round(expected * 100 * EIGHTY_PERCENT));
  return {
    signedIn: true, subscriberId: subscriber.id, enrolled, paid, expected,
    open: { FREE: true, FIRST_PAYMENT: enrolled && (paid > 0 || expected <= 0), EIGHTY_PERCENT: eighty },
  };
}

/** What a screen is told: each document with whether it is open for this client — never where the file is. */
function describeFor(rows, earned) {
  return rows.map(row => ({
    ...publicShape(row),
    open: Boolean(earned.open[row.tier]),
    requirement: REQUIREMENT[row.tier],
  }));
}

module.exports = {
  ROOT, ROOT_IN_RELEASE, TEMP_DIR, TIERS, MAX_BYTES, REQUIREMENT,
  normalizeTier, courseDirectory, filePathOf, inspectPdf, listDocuments, publicShape, saveDocument, removeDocument, clientEarned, describeFor,
};
