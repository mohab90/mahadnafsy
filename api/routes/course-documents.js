'use strict';

// Three PDFs per course, opened by what the client has paid (lib/courseDocuments.js).
//   Admin    GET/PUT/DELETE /api/admin/courses/:id/documents[/:tier]   upload, replace or remove one tier's PDF
//   Site     GET /api/courses/:course/documents                        what exists and whether it is open for the person looking (never where the file is)
//            GET /api/courses/:course/documents/:tier/file             the PDF itself — FREE to anybody, the others only to a signed-in client who has earned it

const express = require('express');
const fs = require('node:fs');
const multer = require('multer');
const { requireAuth, requireAdminOrStaff, requirePermission, optionalAuth } = require('../middleware/auth');
const { publicLimiter, uploadLimiter } = require('../middleware/rateLimits');
const { writeAuditEvent } = require('../lib/auditTrail');
const { uuidv4 } = require('../lib/id');
const { pool } = require('../lib/db');
const docs = require('../lib/courseDocuments');
const logger = require('../lib/logger').child({ module: 'course-documents' });

const router = express.Router();
fs.mkdirSync(docs.TEMP_DIR, { recursive: true });
if (docs.ROOT_IN_RELEASE && process.env.NODE_ENV === 'production') {
  logger.warn(`course documents are stored inside the release directory (${docs.ROOT}) and the next deploy would delete them; set COURSE_DOCUMENT_DIR to a directory outside it`);
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, docs.TEMP_DIR),
    filename: (_req, _file, cb) => cb(null, `pending-${uuidv4()}`),
  }),
  limits: { files: 1, fileSize: docs.MAX_BYTES },
  fileFilter: (_req, file, cb) => cb(null, /pdf/i.test(String(file.mimetype || '')) || /\.pdf$/i.test(String(file.originalname || ''))),
});

async function courseOf(tenantId, key) {
  const [[course]] = await pool.query(
    'SELECT id, slug, is_published FROM courses WHERE tenant_id=? AND (id=? OR slug=?) AND deleted_at IS NULL LIMIT 1', [tenantId, key, key]);
  return course || null;
}

// ── Admin ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

router.get('/api/admin/courses/:id/documents', requireAuth, requireAdminOrStaff, requirePermission('view_courses'), async (req, res) => {
  try {
    const course = await courseOf(req.tenantId, req.params.id);
    if (!course) return res.status(404).json({ error: 'الكورس مش موجود' });
    const rows = await docs.listDocuments(pool, req.tenantId, course.id);
    res.set('Cache-Control', 'private, no-store');
    res.json({ documents: rows.map(docs.publicShape), tiers: docs.TIERS, requirements: docs.REQUIREMENT });
  } catch (error) { logger.error('list', { err: error.message }); res.status(500).json({ error: 'Internal server error' }); }
});

// What happens once the upload has been read from the request (multer's part is above): checked, stored, recorded.
async function afterUpload(req, res, uploadError) {
  try {
    if (uploadError) return res.status(400).json({ error: uploadError instanceof multer.MulterError ? uploadError.message : 'الملف غير مقبول' });
    const tier = docs.normalizeTier(req.params.tier);
    if (!tier) return res.status(400).json({ error: 'نوع الملف غير معروف' });
    if (!req.file) return res.status(400).json({ error: 'ارفع ملف PDF' });
    const course = await courseOf(req.tenantId, req.params.id);
    if (!course) return res.status(404).json({ error: 'الكورس مش موجود' });
    const saved = await docs.saveDocument(pool, {
      tenantId: req.tenantId, courseId: course.id, tier, title: req.body?.title, tempPath: req.file.path,
      originalName: req.file.originalname, uploadedBy: req.user?.uid || null,
    });
    await writeAuditEvent({ req, action: 'course_document.uploaded', entityType: 'course_document', entityId: `${course.id}:${tier}`, metadata: { size: saved.size } })
      .catch(error => logger.warn('audit not written', { err: error.message }));
    res.json({ ok: true, document: saved });
  } catch (error) {
    const refusal = /^invalid/i.test(error.message || '');
    if (!refusal) logger.error('upload', { err: error.message });
    res.status(refusal ? 400 : 500).json({ error: refusal ? error.message.replace(/^invalid: /, '') : 'Upload failed' });
  } finally {
    if (req.file?.path) await fs.promises.unlink(req.file.path).catch(() => {});
  }
}

router.put('/api/admin/courses/:id/documents/:tier', requireAuth, requireAdminOrStaff, requirePermission('manage_courses'), uploadLimiter, (req, res) => {
  if (!docs.normalizeTier(req.params.tier)) return res.status(400).json({ error: 'نوع الملف غير معروف' });
  upload.single('pdf')(req, res, uploadError => { void afterUpload(req, res, uploadError); });
});

router.delete('/api/admin/courses/:id/documents/:tier', requireAuth, requireAdminOrStaff, requirePermission('manage_courses'), async (req, res) => {
  try {
    const tier = docs.normalizeTier(req.params.tier);
    if (!tier) return res.status(400).json({ error: 'نوع الملف غير معروف' });
    const course = await courseOf(req.tenantId, req.params.id);
    if (!course) return res.status(404).json({ error: 'الكورس مش موجود' });
    const removed = await docs.removeDocument(pool, { tenantId: req.tenantId, courseId: course.id, tier });
    if (!removed) return res.status(404).json({ error: 'مفيش ملف هنا' });
    await writeAuditEvent({ req, action: 'course_document.removed', entityType: 'course_document', entityId: `${course.id}:${tier}`, metadata: {} })
      .catch(error => logger.warn('audit not written', { err: error.message }));
    res.json({ ok: true });
  } catch (error) { logger.error('remove', { err: error.message }); res.status(500).json({ error: 'Internal server error' }); }
});

// ── The site ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

router.get('/api/courses/:course/documents', publicLimiter, optionalAuth, async (req, res) => {
  try {
    const course = await courseOf(req.tenantId, req.params.course);
    if (!course) return res.status(404).json({ error: 'الكورس مش موجود' });
    const earned = await docs.clientEarned(pool, { tenantId: req.tenantId, req, courseId: course.id });
    // a course not yet published is for those already in it
    if (!Number(course.is_published) && !earned.enrolled) return res.status(404).json({ error: 'الكورس مش موجود' });
    const rows = await docs.listDocuments(pool, req.tenantId, course.id);
    // who is looking changes the answer: a shared cache must never hold it
    res.set('Cache-Control', 'private, no-store');
    res.set('Vary', 'Cookie');
    res.json({ documents: docs.describeFor(rows, earned) });
  } catch (error) { logger.error('site list', { err: error.message }); res.status(500).json({ error: 'Internal server error' }); }
});

router.get('/api/courses/:course/documents/:tier/file', publicLimiter, optionalAuth, async (req, res) => {
  try {
    const tier = docs.normalizeTier(req.params.tier);
    if (!tier) return res.status(404).json({ error: 'الملف مش موجود' });
    const course = await courseOf(req.tenantId, req.params.course);
    if (!course) return res.status(404).json({ error: 'الملف مش موجود' });
    const earned = await docs.clientEarned(pool, { tenantId: req.tenantId, req, courseId: course.id });
    if (!Number(course.is_published) && !earned.enrolled) return res.status(404).json({ error: 'الملف مش موجود' });
    const [[row]] = await pool.query('SELECT * FROM course_documents WHERE tenant_id=? AND course_id=? AND tier=? LIMIT 1', [req.tenantId, course.id, tier]);
    if (!row) return res.status(404).json({ error: 'الملف مش موجود' });
    if (!earned.open[tier]) {
      return res.status(earned.signedIn ? 403 : 401).json({
        error: docs.REQUIREMENT[tier], code: earned.signedIn ? 'DOCUMENT_LOCKED' : 'SIGN_IN_REQUIRED', requirement: docs.REQUIREMENT[tier],
      });
    }
    const file = docs.filePathOf(row);
    const stat = await fs.promises.stat(file).catch(() => null);
    if (!stat) { logger.error('file missing on disk', { courseId: course.id, tier }); return res.status(404).json({ error: 'الملف مش موجود' }); }
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Length': String(stat.size),
      'Content-Disposition': `inline; filename="document.pdf"; filename*=UTF-8''${encodeURIComponent(row.original_name)}`,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      // the free one may be kept by anybody; the others are this client's alone
      'Cache-Control': tier === 'FREE' ? 'public, max-age=300' : 'private, no-store',
    });
    fs.createReadStream(file).on('error', error => { logger.error('stream', { err: error.message }); res.destroy(error); }).pipe(res);
  } catch (error) { logger.error('site file', { err: error.message }); if (!res.headersSent) res.status(500).json({ error: 'Internal server error' }); }
});

module.exports = router;
module.exports.afterUpload = afterUpload;
