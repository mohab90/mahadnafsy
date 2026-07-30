'use strict';
// ── Data Mappers (snake_case DB rows → camelCase TypeScript types) ────────────
const { tryJson, parseCrm } = require('./helpers');
const { pool } = require('./db');
const { safeDateOnly } = require('./dates');

// ── Column lists for hot-path queries ────────────────────────────────────────
const COURSE_COLS = `id, course_code, slug, title, title_en, title_ar, description,
  short_description, instructor, instructor_id, thumbnail, category, type,
  price_egp, price_sar, price_usd, orig_price_egp, orig_price_sar, orig_price_usd,
  rating, students, duration, level, hours, promo_video_url, live_session_url,
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

function mapCourse(r) {
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
    category: r.category,
    type: r.type,
    price:         { EGP: r.price_egp     || 0, SAR: r.price_sar     || 0, USD: r.price_usd     || 0 },
    originalPrice: { EGP: r.orig_price_egp|| 0, SAR: r.orig_price_sar|| 0, USD: r.orig_price_usd|| 0 },
    rating: r.rating,
    students: Math.max(0, Number(r.students) || 0),
    duration: r.duration,
    level: r.level,
    hours: r.hours,
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
    createdAt: r.created_at,
  };
}

function mapBundle(r, allCourses = []) {
  const courseIds = r.course_ids_csv ? r.course_ids_csv.split(',') : [];
  const courses = courseIds.map(id => allCourses.find(c => c.id === id)).filter(Boolean);
  return {
    id: r.id,
    title: r.title,
    titleEn: r.title_en,
    slug: r.slug,
    shortDescription: r.short_description,
    description: r.description,
    thumbnail: r.thumbnail,
    videoUrl: r.video_url,
    price:         { EGP: r.price_egp     || 0, SAR: r.price_sar     || 0, USD: r.price_usd     || 0 },
    originalPrice: { EGP: r.orig_price_egp|| 0, SAR: r.orig_price_sar|| 0, USD: r.orig_price_usd|| 0 },
    detailsContent: tryJson(r.details_content_json, {}),
    isPublished: !!r.is_published,
    courses,
  };
}

function mapTherapist(r) {
  const priceEgp = r.price_egp || 0;
  const priceSar = r.price_sar || 0;
  const priceUsd = r.price_usd || 0;
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
      availableSlots: (r.slots || []).map(s => ({
        id: s.id, day: s.day, startTime: s.start_time, endTime: s.end_time,
        timezone: s.timezone || '', label: s.label || '', meetingLink: s.meeting_link || '',
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
    clientCode: r.client_code || crm.clientCode || null,
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

module.exports = { COURSE_COLS, COURSE_LIST_COLS, mapCourse, mapBundle, mapTherapist, mapLecture, mapChapter, mapSubscriber, getNextClientCode, mapQuiz };
