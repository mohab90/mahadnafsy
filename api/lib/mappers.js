'use strict';
// ── Data Mappers (snake_case DB rows → camelCase TypeScript types) ────────────
const { tryJson, parseCrm } = require('./helpers');
const { pool } = require('./db');
const { safeDateOnly } = require('./dates');
const { uuidv4 } = require('./id');
const { mapInstallmentPlan } = require('./installmentMath');

/**
 * A money column as a number.
 *
 * price_egp and its siblings are DECIMAL(10,2), and mysql2 hands a DECIMAL back
 * as a **string** — "7900.00". `r.price_egp || 0` kept the string, so every
 * price reached the browser as text. Two things followed:
 *
 *   the compare   CourseCard asked `oldPrice > currentPrice` and got a
 *                 lexicographic answer: "11500.00" > "5600.00" is false, so ten
 *                 of the institute's thirty-one products showed no discount at
 *                 all — every one of them a ~51% cut on its headline programme.
 *
 *   the display   the string was printed as it arrived: «14800.00 ج.م» instead
 *                 of «14,800 ج.م», on every card of every catalogue page.
 *
 * Fixed at the boundary rather than at each of the five comparisons, because
 * the next screen to read a price should not have to know this.
 */
const money = value => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

// ── Column lists for hot-path queries ────────────────────────────────────────
const COURSE_COLS = `id, course_code, slug, title, title_en, title_ar, description,
  short_description, instructor, instructor_id, thumbnail, category, type,
  price_egp, price_sar, price_usd, orig_price_egp, orig_price_sar, orig_price_usd,
  rating, students, duration, level, hours, access_months, promo_video_url, live_session_url,
  certificate_template_url, certificate_template_name, is_published, sort_order,
  modules_json, gallery_images_json, details_content_json, course_modules_json, created_at`;

// Lighter column set for list/grid views (Home, Courses grid, Bundle course lists) —
// excludes the full description + curriculum/gallery JSON blobs, which only
// CourseDetails.tsx renders and which it fetches itself via GET /api/courses/:id.
// Cuts the catalog payload roughly in half on every fresh session load.
const COURSE_LIST_COLS = `id, course_code, slug, title, title_en, title_ar,
  short_description, instructor, instructor_id, thumbnail, category, type,
  price_egp, price_sar, price_usd, orig_price_egp, orig_price_sar, orig_price_usd,
  rating, students, duration, level, hours, is_published, sort_order, created_at`;

/**
 * The PDFs attached to a set of courses, as a Map of course id to the array the
 * screens expect.
 *
 * course_materials has existed since the schema was written, with exactly the
 * columns the course editor collects — and no route had ever read or written
 * it. So «المادة العلمية (ملفات PDF)» saved, reported «تم حفظ الكورس بنجاح»,
 * and came back empty; and every enrolled student's المادة العلمية tab said
 * «لا توجد مادة علمية متاحة حاليا», for every course, permanently.
 *
 * Batched rather than per-course: the enrolled-courses read hands this every
 * course a student is on at once.
 */
async function loadCourseMaterials(db, courseIds) {
  const ids = [...new Set((courseIds || []).filter(Boolean))];
  if (!ids.length) return new Map();
  const [rows] = await db.query(
    `SELECT id, course_id, title, url, access_level, sort_order
       FROM course_materials WHERE course_id IN (${ids.map(() => '?').join(',')})
      ORDER BY sort_order ASC, title ASC`,
    ids
  );
  const byCourse = new Map();
  for (const row of rows) {
    if (!byCourse.has(row.course_id)) byCourse.set(row.course_id, []);
    byCourse.get(row.course_id).push({
      id: row.id,
      title: row.title,
      url: row.url,
      // The column is an ENUM of PARTIAL/FULL; both screens compare lowercase.
      accessLevel: String(row.access_level || 'full').toLowerCase(),
    });
  }
  return byCourse;
}

/** Replace a course's materials with exactly what was submitted. */
async function saveCourseMaterials(db, courseId, materials) {
  if (!Array.isArray(materials)) return;
  await db.query('DELETE FROM course_materials WHERE course_id=?', [courseId]);
  const rows = materials
    .filter(item => String(item?.title || '').trim() && String(item?.url || '').trim())
    .slice(0, 200);
  if (!rows.length) return;
  await db.query(
    `INSERT INTO course_materials (id, course_id, title, url, access_level, sort_order)
     VALUES ${rows.map(() => '(?,?,?,?,?,?)').join(',')}`,
    rows.flatMap((item, index) => [
      uuidv4(),
      courseId,
      String(item.title).trim().slice(0, 500),
      String(item.url).trim(),
      String(item.accessLevel || item.access_level || 'full').toUpperCase() === 'PARTIAL' ? 'PARTIAL' : 'FULL',
      Number.isFinite(Number(item.sortOrder)) ? Number(item.sortOrder) : index,
    ])
  );
}

/** The spellings client/types.ts and admin/types.ts both declare for a course. */
const COURSE_TYPES = Object.freeze({ RECORDED: 'Recorded', LIVE: 'Live', MIX: 'Mix' });
const COURSE_CATEGORIES = Object.freeze({
  THERAPY: 'Therapy', DIAGNOSIS: 'Diagnosis', CHILD: 'Child', GENERAL: 'General',
});

const canonicalCourseType = value =>
  COURSE_TYPES[String(value || '').trim().toUpperCase()] || 'Recorded';

const canonicalCourseCategory = value =>
  COURSE_CATEGORIES[String(value || '').trim().toUpperCase()] || 'General';

function mapCourse(r, materials) {
  return {
    id: r.id,
    courseCode: r.course_code,
    slug: r.slug,
    title: r.title,
    titleEn: r.title_en,
    titleAr: r.title_ar,
    description: r.description,
    shortDescription: r.short_description,
    instructor: r.instructor,
    instructorId: r.instructor_id || undefined,
    thumbnail: r.thumbnail,
    // Spelled the way both apps declare them, not the way the column stores
    // them. courses.type and courses.category are ENUMs whose members are
    // upper case, and MySQL stores the *declared* spelling — so the admin form
    // sends 'Mix' and the row comes back 'MIX'. Every screen compares the
    // declared spelling with ===, which is case-sensitive, so:
    //
    //   • both filters on /courses matched nothing — picking any type or any
    //     category emptied the page
    //   • every course card read «مسجل», including all 20 'MIX' ones
    //   • the admin's own type dropdown showed no selection
    //
    // Normalised here rather than at each comparison, so there is one spelling
    // on the wire and the screens keep the vocabulary their types declare.
    category: canonicalCourseCategory(r.category),
    type: canonicalCourseType(r.type),
    price:         { EGP: money(r.price_egp), SAR: money(r.price_sar), USD: money(r.price_usd) },
    originalPrice: { EGP: money(r.orig_price_egp), SAR: money(r.orig_price_sar), USD: money(r.orig_price_usd) },
    rating: r.rating,
    // `courses.students` is a denormalised counter that nothing in the codebase
    // has ever incremented — it sat at 0 for every course while enrollments held
    // hundreds, so every card on the public site read "0 طالب" on courses with
    // 691, 280, 273 real students. Public routes now pass a live count as
    // enrolled_count; the stale column is only the fallback.
    students: Math.max(0, Number(r.enrolled_count ?? r.students) || 0),
    duration: r.duration,
    level: r.level,
    hours: r.hours,
    // How many months an enrolment keeps the course; NULL means unlimited. The
    // course editor has a field for it and the save writes it, but no read path
    // returned it — so the field opened empty on every edit and the save then
    // wrote NULL back. A course set to expire quietly became unlimited the next
    // time anyone touched it. Absent rather than null where the caller used the
    // lighter column list, so "not loaded" stays distinguishable from "unlimited".
    ...('access_months' in r ? { accessMonths: r.access_months } : {}),
    promoVideoUrl: r.promo_video_url,
    liveSessionUrl: r.live_session_url,
    certificateTemplateUrl: r.certificate_template_url,
    certificateTemplateName: r.certificate_template_name,
    isPublished: !!r.is_published,
    sortOrder: r.sort_order,
    modules: tryJson(r.modules_json, []),
    galleryImages: tryJson(r.gallery_images_json, []),
    detailsContent: tryJson(r.details_content_json, {}),
    courseModules: tryJson(r.course_modules_json, []),
    // Only attached where the caller loaded them: a screen that did not ask for
    // materials should see the field absent rather than wrongly empty.
    ...(materials ? { materials } : {}),
    createdAt: r.created_at,
  };
}

/**
 * What a bundle needs to say about each course it contains.
 *
 * A bundle used to embed the whole course object, and /api/courses then returned
 * the same 24 courses again on the same page load. The embedded copies were
 * 13,410 of the endpoint's 26,765 bytes — half the payload, duplicated.
 *
 * These seven fields are every one that any screen reads off a bundle's course:
 * the timeline rows on the bundle page (title, shortDescription, duration,
 * level), the cards on /bundles (thumbnail, instructor), the links (slug), and
 * the id that both apps match on. Anything more is weight nobody unpacks.
 */
const BUNDLE_COURSE_FIELDS = ['id', 'slug', 'title', 'thumbnail', 'shortDescription', 'duration', 'level', 'instructor'];

const bundleCourseSummary = course => {
  const summary = {};
  for (const key of BUNDLE_COURSE_FIELDS) summary[key] = course[key];
  return summary;
};

function mapBundle(r, allCourses = []) {
  const courseIds = r.course_ids_csv ? r.course_ids_csv.split(',') : [];
  const courses = courseIds
    .map(id => allCourses.find(c => c.id === id))
    .filter(Boolean)
    .map(bundleCourseSummary);
  return {
    id: r.id,
    title: r.title,
    titleEn: r.title_en,
    slug: r.slug,
    shortDescription: r.short_description,
    description: r.description,
    thumbnail: r.thumbnail,
    videoUrl: r.video_url,
    price:         { EGP: money(r.price_egp), SAR: money(r.price_sar), USD: money(r.price_usd) },
    originalPrice: { EGP: money(r.orig_price_egp), SAR: money(r.orig_price_sar), USD: money(r.orig_price_usd) },
    detailsContent: tryJson(r.details_content_json, {}),
    isPublished: !!r.is_published,
    courses,
  };
}

/**
 * @param r therapist row, optionally carrying `slots`
 * @param includeMeetingLinks pass true only from an authenticated route — see
 *        availableSlots below for why the default is off.
 */
function mapTherapist(r, includeMeetingLinks = false) {
  const priceEgp = money(r.price_egp);
  const priceSar = money(r.price_sar);
  const priceUsd = money(r.price_usd);
  const mp = (r.meeting_provider || 'GOOGLE_MEET').toLowerCase();
  return {
    id: r.id,
    staffId: r.staff_id || undefined,
    name: r.name,
    specialty: r.specialty || '',
    image: r.image || '',
    experience: r.experience || 0,
    rating: r.rating || 5,
    title: r.title || '',
    bio: r.bio || '',
    price: { EGP: priceEgp, SAR: priceSar, USD: priceUsd },
    featured: !!r.featured,
    sortOrder: r.sort_order || 0,
    showOnHome: !!r.show_on_home,
    showOnAbout: !!r.show_on_about,
    isActive: !!r.is_active,
    languages: tryJson(r.languages_json, []),
    focusAreas: tryJson(r.focus_areas_json, []),
    qualifications: tryJson(r.qualifications_json, []),
    consultationSettings: {
      enabled: !!r.is_consultation_enabled,
      sessionDurationMinutes: r.session_duration_minutes || 60,
      sessionPrice: { EGP: priceEgp, SAR: priceSar, USD: priceUsd },
      meetingProvider: mp,
      providerBaseUrl: r.provider_base_url || '',
      autoCreateMeetingLink: true,
      intakeFormUrl: '',
      bookingNotes: '',
      // meetingLink is the real join URL for a session and is opt-in, because
      // this mapper serves GET /api/therapists — public, unauthenticated and
      // answered with `Cache-Control: public, max-age=600`. Every therapist's
      // join link for every active slot was on the open internet, on the site
      // of a psychology institute whose own booking page promises «سرية تامة».
      //
      // The booking pages only ever needed the day, the time and the id. The
      // admin editor and the therapist's own portal ask for it explicitly.
      availableSlots: (r.slots || []).map(s => ({
        id: s.id, day: s.day, startTime: s.start_time, endTime: s.end_time,
        timezone: s.timezone || '', label: s.label || '',
        ...(includeMeetingLinks ? { meetingLink: s.meeting_link || '' } : {}),
        isActive: !!s.is_active,
      })),
      portal: { username: '', password: '', temporaryPassword: true },
    },
  };
}

function mapLecture(r) {
  return {
    id: r.id,
    courseId: r.course_id,
    chapterId: r.chapter_id,
    title: r.title,
    description: r.description,
    videoUrl: r.video_url,
    duration: r.duration,
    isPreview: !!r.is_preview,
    order: r.sort_order,
    sortOrder: r.sort_order,
    isPublished: !!r.is_published,
    lectureType: r.lecture_type || 'recorded',
    dripUnlockDays: r.drip_unlock_days || 0,
  };
}

function mapChapter(r) {
  return {
    id: r.id,
    courseId: r.course_id,
    title: r.title,
    order: r.sort_order,
    sortOrder: r.sort_order,
  };
}

function mapSubscriber(r) {
  const crm = parseCrm(r.crm_json);
  const activeEnrollments = (r.enrollments || []).filter(e => !e.status || e.status === 'active');
  const enrolledCourseIds = [...new Set(activeEnrollments.map(e => String(e.course_id || e.c_id)).filter(Boolean))];
  const paymentHistory = Array.isArray(r.payments) ? r.payments.map(p => {
    const dateStr = safeDateOnly(p.date);
    return {
      id: p.id,
      amount: Number(p.amount) || 0,
      currency: p.currency || 'EGP',
      paymentType: (p.payment_type || p.paymentType || 'other').toLowerCase(),
      paymentMethod: p.payment_method || p.paymentMethod || null,
      transactionId: p.transaction_id || p.transactionId || null,
      isInstallment: !!(p.is_installment || p.isInstallment),
      courseId: p.course_id || p.courseId || null,
      bundleId: p.bundle_id || p.bundleId || null,
      courseExpected: p.course_expected != null ? Number(p.course_expected) : (p.courseExpected != null ? Number(p.courseExpected) : undefined),
      note: p.note || null,
      at: p.at || dateStr,
      status: p.status || 'paid',
      staffId: p.staff_id || p.staffId || null,
      staffName: p.staff_name || p.staffName || null,
      fromAccountNumber: p.from_account || p.fromAccountNumber || null,
      source: p.source || null,
      itemTitle: p.item_title || p.itemTitle || null,
      certType: p.cert_type || p.certType || null,
      certId: p.certificate_request_id || p.certId || null,
      branch: p.branch || null,
      invoiceNumber: p.document_number || p.invoiceNumber || null,
    };
  }) : [];
  const dbCourseAccess = {};
  for (const e of activeEnrollments) {
    const cid = String(e.course_id || e.c_id || '');
    if (!cid) continue;
    if (e.access_type === 'limited' && e.lecture_limit) {
      dbCourseAccess[cid] = { mode: 'limited', lectureLimit: Number(e.lecture_limit) };
    } else {
      dbCourseAccess[cid] = 'full';
    }
  }
  return {
    id: r.id,
    name: r.name,
    email: r.email,
    phone: r.phone,
    firebaseUid: r.firebase_uid,
    isActive: !!r.is_active,
    source: r.source || null,
    notes: r.notes,
    createdAt: r.created_at,
    enrolledCourseIds,
    courseAccess: dbCourseAccess,
    lectureProgress: {},
    // The customer types an English name for their certificate and it is saved,
    // but nothing ever handed it back: the settings field reset itself on every
    // visit, the certificate request went out without it, and the preview
    // printed the Arabic name. Read from the column and from the CRM blob the
    // profile route writes into, so a name saved either way surfaces.
    nameEn: r.name_en || crm.nameEn || null,
    clientCode: r.client_code || crm.clientCode || null,
    // The plan the customer is actually paying was admin-only. Their payments
    // tab declares a section for it and their dashboard computes upcoming due
    // dates from it; both read an array that was never sent, so a customer on a
    // four-instalment plan saw no plan, no schedule and no next due date.
    installmentPlans: (r.installmentPlans || []).map(mapInstallmentPlan),
    enrollments: activeEnrollments.map(e => ({
      id: e.id,
      courseId: e.course_id || e.c_id,
      courseTitle: e.c_title,
      courseSlug: e.c_slug,
      courseThumbnail: e.c_thumb,
      instructor: e.c_instructor,
      accessLevel: e.access_level,
      enrolledAt: e.enrolled_at,
    })),
    paymentHistory,
    // Temporary compatibility alias for callers that adopted the raw API name.
    payments: paymentHistory,
    certRequests: (r.certRequests || []).map(cr => ({
      id: cr.id,
      type: cr.type || null,
      courseId: cr.course_id || cr.courseId || null,
      courseTitle: cr.c_title || cr.courseTitle || null,
      status: cr.status || 'pending',
      price: cr.price != null ? Number(cr.price) : null,
      paidAmount: cr.paid_amount != null ? Number(cr.paid_amount) : (cr.paidAmount != null ? Number(cr.paidAmount) : 0),
      currency: cr.currency || 'EGP',
      requestedAt: cr.requested_at || cr.requestedAt || null,
      note: cr.note || null,
      adminNote: cr.admin_note || cr.adminNote || null,
    })),
    // Client reads `extraCertificateRequests` (lowercase status/type). Back it with the SAME
    // certificate_requests table (single source of truth) so client + admin see the same data.
    extraCertificateRequests: (r.certRequests || []).map(cr => ({
      id: cr.id,
      type: String(cr.type || '').toLowerCase(),
      courseId: cr.course_id || cr.courseId || null,
      customName: cr.custom_name || null,
      nameAr: cr.name_ar || null,
      nameEn: cr.name_en || null,
      nationality: String(cr.nationality || '').toLowerCase() || undefined,
      idNumber: cr.id_number || undefined,
      status: String(cr.status || 'pending').toLowerCase(),
      price: cr.price != null ? Number(cr.price) : undefined,
      paidAmount: cr.paid_amount != null ? Number(cr.paid_amount) : (cr.paidAmount != null ? Number(cr.paidAmount) : 0),
      currency: cr.currency || undefined,
      requestedAt: cr.requested_at || cr.requestedAt || null,
      note: cr.note || null,
      // The three the sibling list above carries and this one dropped. The
      // customer's certificates screen renders req.adminNote — so every note an
      // admin wrote them through PATCH /api/admin/certificate-requests/:id
      // arrived as undefined and the paragraph never drew. issuedAt and
      // courseTitle are declared on the client's own type and were unreachable
      // for the same reason.
      adminNote: cr.admin_note || cr.adminNote || null,
      issuedAt: cr.issued_at || cr.issuedAt || null,
      courseTitle: cr.c_title || cr.courseTitle || null,
    })),
  };
}

// Atomic sequential client code — uses client_code_counter table
async function getNextClientCode(conn) {
  await conn.query('UPDATE client_code_counter SET next_value = next_value + 1 WHERE id = 1');
  const [[row]] = await conn.query('SELECT next_value FROM client_code_counter WHERE id = 1');
  return `C${row.next_value - 1}`;
}

// includeAnswers=false strips correctIndex (and explanation, which can imply it)
// from every question — the shape served to the public GET /api/quizzes so a
// visitor with no session can't just read the answer key out of the network
// tab (LMS-05). The authenticated admin listing and the server-side grader in
// lib/quizGrading.js are the only callers that pass includeAnswers=true.
function mapQuiz(r, { includeAnswers = false } = {}) {
  const rawQuestions = tryJson(r.questions_json, []);
  const questions = Array.isArray(rawQuestions) ? rawQuestions.map(q => {
    if (includeAnswers) return q;
    const { correctIndex: _correctIndex, explanation: _explanation, ...safe } = q;
    return safe;
  }) : [];
  return {
    id: r.id,
    courseId: r.course_id,
    title: r.title,
    questions,
    passingScore: Number(r.passing_score) || 70,
    requiredForCompletion: r.required_for_completion !== 0 && r.required_for_completion !== false,
    generatedByAI: !!r.generated_by_ai,
    sourceMaterial: r.source_material || undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at || r.created_at,
  };
}

// mysql2 returns DECIMAL as a string — the pool leaves decimalNumbers unset on
// purpose, since flipping it would change the wire type of every money value in
// the system at once. The consequence is local and sharp: a screen that adds two
// of them gets "0.00" + "150.00" = "0.00150.00", which is NaN the moment anything
// compares it, so a real deduction renders as «—» and a run total prints as
// "09500.008000.00". Routes that hand money rows to a screen convert here.
function toNumbers(row, fields) {
  const out = { ...row };
  for (const field of fields) {
    if (out[field] !== undefined && out[field] !== null) out[field] = Number(out[field]);
  }
  return out;
}

const LIVE_STREAM_COLS = `id, title, instructor_id, instructor_name, scheduled_at, duration_minutes,
       stream_url, platform, visibility, target_course_ids_json, status, recording_url,
       description, created_at`;

/**
 * A live_streams row as both apps read it. These went out raw once, and the
 * screens read scheduledAt, streamUrl, instructorName and durationMinutes off a
 * row carrying snake_case — the session list drew with no presenter, no time
 * and no way to join, and «مباشر الآن» never lit because the enum is upper case
 * and the screens compare it in lower.
 */
function mapLiveStream(row) {
  return {
    id: row.id,
    title: row.title,
    instructorId: row.instructor_id || undefined,
    instructorName: row.instructor_name || '',
    scheduledAt: row.scheduled_at,
    durationMinutes: row.duration_minutes != null ? Number(row.duration_minutes) : undefined,
    streamUrl: row.stream_url || '',
    platform: String(row.platform || '').toLowerCase() || undefined,
    visibility: String(row.visibility || '').toLowerCase(),
    targetCourseIds: tryJson(row.target_course_ids_json, []),
    status: String(row.status || '').toLowerCase(),
    recordingUrl: row.recording_url || undefined,
    description: row.description || undefined,
    createdAt: row.created_at,
  };
}

module.exports = { toNumbers, loadCourseMaterials, saveCourseMaterials, COURSE_COLS, COURSE_LIST_COLS, mapCourse, mapBundle, mapTherapist, mapLecture, mapChapter, mapSubscriber, getNextClientCode, mapQuiz, LIVE_STREAM_COLS, mapLiveStream };
