'use strict';

// «حساب محاضر» (25 Oct 2026): what a lecturer or consultant sees of their own work — and nothing of anyone else's.
//
// A lecturer is a staff account (role instructor / trainer / consultant / expert) and, when they take consultations, a
// therapists row linked by staff_id. Every read here is keyed on that one staff id: their courses (courses.instructor_id),
// their Dokki rounds, their lives, their consultations, their fees. The portal's routes (routes/lecturer-portal.js)
// pass nothing a caller chose except filters.

const { sqlCairoToday } = require('./dates');

const LECTURER_ROLES = Object.freeze(['instructor', 'trainer', 'consultant', 'expert']);

const round2 = n => Math.round((Number(n) || 0) * 100) / 100;
const firstName = name => String(name || '').trim().split(/\s+/)[0] || 'عميل';

/**
 * Who is asking, as a lecturer: their staff id, name, number and consultation profile. null when the account is
 * neither a lecturer's role nor linked to a consultation profile.
 */
async function lecturerContext(db, req) {
  const staff = req.staffRecord;
  if (!staff?.id) return null;
  const [[therapist]] = await db.query(
    `SELECT id, name, specialty, title, bio, image, is_consultation_enabled, session_duration_minutes,
            price_egp, price_sar, price_usd, meeting_provider, provider_base_url
       FROM therapists WHERE tenant_id=? AND staff_id=? AND is_active=1 LIMIT 1`,
    [req.tenantId, staff.id]);
  const role = String(staff.role || '').toLowerCase();
  if (!LECTURER_ROLES.includes(role) && !therapist) return null;
  return { tenantId: req.tenantId, staffId: staff.id, name: staff.name || '', role, phone: staff.phone || '', therapist: therapist || null };
}

/** Express guard: only a lecturer's account passes, and the context rides on req.lecturer. */
function requireLecturer(pool) {
  return async (req, res, next) => {
    try {
      const context = await lecturerContext(pool, req);
      if (!context) return res.status(403).json({ error: 'الصفحة دي لحسابات المحاضرين والمستشارين بس', code: 'LECTURER_ONLY' });
      req.lecturer = context;
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

async function myCourses(db, { tenantId, staffId }) {
  const [rows] = await db.query(
    'SELECT id, title FROM courses WHERE tenant_id=? AND instructor_id=? AND deleted_at IS NULL ORDER BY title',
    [tenantId, staffId]);
  return rows.map(row => ({ id: row.id, title: row.title }));
}

/** The rounds of the lecturer's Dokki / Tagamoa courses that are theirs. */
async function myRounds(db, { tenantId, staffId }) {
  const [rows] = await db.query(
    `SELECT r.id, r.code, r.status, r.current_lecture, r.day_of_week, r.time_slot, r.branch,
            DATE_FORMAT(r.start_date, '%Y-%m-%d') AS start_date, c.title AS course_title,
            (SELECT COUNT(*) FROM daqqi_attendees a WHERE a.tenant_id=r.tenant_id AND a.round_id=r.id) AS attendees
       FROM daqqi_rounds r LEFT JOIN courses c ON c.id=r.course_id AND c.tenant_id=r.tenant_id
      WHERE r.tenant_id=? AND r.instructor_id=? ORDER BY (r.status='FINISHED'), r.start_date DESC LIMIT 100`,
    [tenantId, staffId]);
  return rows.map(row => ({
    id: row.id, code: row.code, status: String(row.status || '').toLowerCase(), currentLecture: Number(row.current_lecture) || 0,
    day: row.day_of_week, slot: String(row.time_slot || '').toLowerCase(), branch: row.branch, startDate: row.start_date,
    courseTitle: row.course_title || '', attendees: Number(row.attendees) || 0,
  }));
}

/**
 * What a lecturer's students and the rating of the lecturer come to. Ratings: the branch desk's 1–10 marks of a round
 * (client_ratings, by the round or by the lecturer's name) and the 1–5 stars clients give a course (course_ratings).
 */
async function reviewsOf(db, { tenantId, staffId, name, therapistId = null }) {
  const [instructor] = await db.query(
    `SELECT cr.id, cr.instructor_score, cr.material_score, cr.delivery_score, cr.note, cr.created_at,
            c.title AS course_title, s.name AS client_name
       FROM client_ratings cr
       LEFT JOIN courses c ON c.id=cr.course_id AND c.tenant_id=cr.tenant_id
       LEFT JOIN subscribers s ON s.id=cr.subscriber_id AND s.tenant_id=cr.tenant_id
      WHERE cr.tenant_id=? AND cr.deleted_at IS NULL
        AND (cr.round_id IN (SELECT id FROM daqqi_rounds WHERE tenant_id=? AND instructor_id=?) OR cr.instructor_name=?)
      ORDER BY cr.created_at DESC LIMIT 200`,
    [tenantId, tenantId, staffId, name]);
  const [stars] = await db.query(
    `SELECT r.id, r.rating, r.comment, r.created_at, c.title AS course_title, s.name AS client_name
       FROM course_ratings r
       JOIN courses c ON c.id=r.course_id AND c.tenant_id=r.tenant_id AND c.instructor_id=?
       LEFT JOIN subscribers s ON s.id=r.subscriber_id AND s.tenant_id=r.tenant_id
      WHERE r.tenant_id=? ORDER BY r.created_at DESC LIMIT 200`,
    [staffId, tenantId]);
  // The client's stars for a consultation (lib/consultationRating.js).
  const [consults] = therapistId ? await db.query(
    `SELECT r.id, r.rating, r.comment, r.created_at, c.client_name
       FROM consultation_ratings r LEFT JOIN consultations c ON c.id=r.consultation_id AND c.tenant_id=r.tenant_id
      WHERE r.tenant_id=? AND r.therapist_id=? ORDER BY r.created_at DESC LIMIT 200`, [tenantId, therapistId]) : [[]];
  const mean = (rows, key) => (rows.length ? round2(rows.reduce((sum, row) => sum + Number(row[key]), 0) / rows.length) : null);
  const distribution = Array.from({ length: 5 }, (_, i) => ({ stars: 5 - i, count: stars.filter(row => Number(row.rating) === 5 - i).length }));
  return {
    summary: {
      instructorScore: mean(instructor, 'instructor_score'), materialScore: mean(instructor, 'material_score'),
      deliveryScore: mean(instructor, 'delivery_score'), roundRatings: instructor.length,
      courseStars: mean(stars, 'rating'), courseRatings: stars.length, distribution,
      consultationStars: mean(consults, 'rating'), consultationRatings: consults.length,
    },
    // First names only: the lecturer reads what was said, not who the client is.
    items: [
      ...instructor.map(row => ({
        id: `r:${row.id}`, kind: 'round', score: Number(row.instructor_score), outOf: 10, note: row.note || '',
        course: row.course_title || '', client: firstName(row.client_name), at: row.created_at,
      })),
      ...consults.map(row => ({
        id: `s:${row.id}`, kind: 'consultation', score: Number(row.rating), outOf: 5, note: row.comment || '',
        course: 'استشارة', client: firstName(row.client_name), at: row.created_at,
      })),
      ...stars.map(row => ({
        id: `c:${row.id}`, kind: 'course', score: Number(row.rating), outOf: 5, note: row.comment || '',
        course: row.course_title || '', client: firstName(row.client_name), at: row.created_at,
      })),
    ].sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, 100),
  };
}

/** The lecturer's students: those enrolled in their courses and those housed in their rounds, with how far each has got. */
async function studentsOf(db, { tenantId, staffId }) {
  const [online] = await db.query(
    `SELECT s.id, s.name, c.id AS course_id, c.title AS course_title, DATE_FORMAT(e.enrolled_at, '%Y-%m-%d') AS since,
            (SELECT ROUND(AVG(COALESCE(lc.progress_pct, 0)))
               FROM course_lectures cl LEFT JOIN lecture_completions lc
                 ON lc.lecture_id=cl.id AND lc.subscriber_id=s.id AND lc.tenant_id=cl.tenant_id
              WHERE cl.course_id=c.id AND cl.is_published=1) AS progress
       FROM enrollments e
       JOIN courses c ON c.id=e.course_id AND c.tenant_id=e.tenant_id AND c.instructor_id=?
       JOIN subscribers s ON s.id=e.subscriber_id AND s.tenant_id=e.tenant_id AND s.deleted_at IS NULL
      WHERE e.tenant_id=? AND e.status='active' ORDER BY e.enrolled_at DESC LIMIT 300`,
    [staffId, tenantId]);
  const [housed] = await db.query(
    `SELECT a.subscriber_id AS id, a.name, r.id AS round_id, r.code, r.current_lecture, a.attended_lectures, c.title AS course_title
       FROM daqqi_attendees a
       JOIN daqqi_rounds r ON r.id=a.round_id AND r.tenant_id=a.tenant_id AND r.instructor_id=?
       LEFT JOIN courses c ON c.id=r.course_id AND c.tenant_id=r.tenant_id
      WHERE a.tenant_id=? AND r.status<>'FINISHED' ORDER BY r.start_date DESC, a.name LIMIT 600`,
    [staffId, tenantId]);
  const [lives] = await db.query(
    `SELECT l.id, l.title, l.status, l.scheduled_at,
            (SELECT COUNT(*) FROM live_stream_attendance a WHERE a.tenant_id=l.tenant_id AND a.stream_id=l.id) AS attended
       FROM live_streams l WHERE l.tenant_id=? AND l.instructor_id=? AND l.status='ENDED' ORDER BY l.scheduled_at DESC LIMIT 20`,
    [tenantId, staffId]);
  return {
    online: online.map(row => ({
      id: row.id, name: row.name || '', courseId: row.course_id, course: row.course_title || '', since: row.since, progress: Number(row.progress) || 0,
    })),
    rounds: housed.map(row => ({
      id: row.id, name: row.name || '', roundId: row.round_id, round: row.code, course: row.course_title || '',
      attended: Number(row.attended_lectures) || 0, held: Number(row.current_lecture) || 0,
    })),
    lives: lives.map(row => ({ id: row.id, title: row.title, at: row.scheduled_at, attended: Number(row.attended) || 0 })),
  };
}

const FEE_LABEL = Object.freeze({
  lecture: 'محاضرة', training: 'تدريب', consultation: 'استشارة', fixed: 'مبلغ ثابت', retention: 'مكافأة تدوير عميل', revenue_share: 'حصة من دفعة',
});

/**
 * The lecturer's money: their instructor fees (the lectures delivered, the share of payments, «مكافأة التدوير»), by
 * status — waiting for the accounts team, approved, paid — and the payroll runs that paid them.
 */
async function earningsOf(db, { tenantId, staffId, month = null, year = null }) {
  const where = ['f.tenant_id=?', 'f.staff_id=?'];
  const params = [tenantId, staffId];
  if (year) { where.push('f.period_year=?'); params.push(Number(year)); }
  if (month) { where.push('f.period_month=?'); params.push(Number(month)); }
  const [fees] = await db.query(
    `SELECT f.id, f.fee_type, f.total_amount, f.currency, f.status, f.period_month, f.period_year, f.note, f.hours,
            f.created_at, f.paid_at, c.title AS course_title
       FROM instructor_fees f LEFT JOIN courses c ON c.id=f.course_id AND c.tenant_id=f.tenant_id
      WHERE ${where.join(' AND ')} ORDER BY f.period_year DESC, f.period_month DESC, f.created_at DESC LIMIT 300`,
    params);
  const sum = (rows, test) => round2(rows.filter(test).reduce((total, row) => total + Number(row.total_amount), 0));
  const waiting = fee => fee.status === 'pending';
  const approved = fee => ['approved', 'included_in_payroll'].includes(fee.status);
  const paid = fee => fee.status === 'paid';
  const byType = {};
  for (const fee of fees.filter(row => row.status !== 'rejected')) {
    byType[fee.fee_type] ||= { type: fee.fee_type, label: FEE_LABEL[fee.fee_type] || fee.fee_type, count: 0, total: 0 };
    byType[fee.fee_type].count += 1;
    byType[fee.fee_type].total = round2(byType[fee.fee_type].total + Number(fee.total_amount));
  }
  const [payslips] = await db.query(
    `SELECT pr.month, pr.year, pr.status, pi.net_salary, pi.commission, pi.bonus
       FROM payroll_items pi JOIN payroll_runs pr ON pr.id=pi.payroll_run_id AND pr.tenant_id=pi.tenant_id
      WHERE pi.tenant_id=? AND pi.staff_id=? AND pr.status IN ('APPROVED','PAID')
      ORDER BY pr.year DESC, pr.month DESC LIMIT 12`,
    [tenantId, staffId]);
  return {
    totals: {
      waiting: sum(fees, waiting), approved: sum(fees, approved), paid: sum(fees, paid),
      retention: sum(fees, fee => fee.fee_type === 'retention' && fee.status !== 'rejected'),
    },
    byType: Object.values(byType),
    fees: fees.map(row => ({
      id: row.id, type: row.fee_type, label: FEE_LABEL[row.fee_type] || row.fee_type, amount: Number(row.total_amount), currency: row.currency,
      status: row.status, month: row.period_month, year: row.period_year, course: row.course_title || '', note: row.note || '',
      hours: row.hours != null ? Number(row.hours) : null, createdAt: row.created_at, paidAt: row.paid_at,
    })),
    payslips: payslips.map(row => ({
      month: row.month, year: row.year, status: row.status, net: Number(row.net_salary), commission: Number(row.commission), bonus: Number(row.bonus),
    })),
  };
}

const pct = (part, whole) => (Number(whole) > 0 ? Math.round((Number(part) / Number(whole)) * 100) : null);

/**
 * «مؤشرات الأداء»: how the lecturer's work is going, in numbers they can act on — the share of the lectures held that their
 * students attended, the share of their clients who came back for a second course of theirs (what the «تدوير» bonus pays for),
 * how many of their consultations were completed rather than cancelled, and how many came to their lives. null when there is nothing
 * to divide yet, never a made-up zero.
 */
async function performanceOf(db, { tenantId, staffId, therapistId = null }) {
  const [[attendance]] = await db.query(
    `SELECT COALESCE(SUM(a.attended_lectures), 0) AS attended, COALESCE(SUM(r.current_lecture), 0) AS held
       FROM daqqi_attendees a JOIN daqqi_rounds r ON r.id=a.round_id AND r.tenant_id=a.tenant_id AND r.instructor_id=?
      WHERE a.tenant_id=? AND r.status<>'FINISHED'`, [staffId, tenantId]);
  const [[retention]] = await db.query(
    `SELECT COUNT(*) AS clients, COALESCE(SUM(x.courses >= 2), 0) AS repeaters FROM (
        SELECT p.subscriber_id, COUNT(DISTINCT p.course_id) AS courses
          FROM payments p JOIN courses c ON c.id=p.course_id AND c.tenant_id=p.tenant_id AND c.instructor_id=?
         WHERE p.tenant_id=? AND p.status='paid' AND p.deleted_at IS NULL AND p.amount > 0 GROUP BY p.subscriber_id) x`, [staffId, tenantId]);
  let consultations = { completed: 0, cancelled: 0 };
  if (therapistId) {
    const [[row]] = await db.query(
      `SELECT COALESCE(SUM(status='COMPLETED'), 0) AS completed, COALESCE(SUM(status='CANCELLED'), 0) AS cancelled
         FROM consultations WHERE tenant_id=? AND therapist_id=? AND deleted_at IS NULL`, [tenantId, therapistId]);
    consultations = { completed: Number(row?.completed) || 0, cancelled: Number(row?.cancelled) || 0 };
  }
  const [[lives]] = await db.query(
    `SELECT COUNT(*) AS lives, COALESCE(SUM(t.attended), 0) AS attended FROM (
        SELECT (SELECT COUNT(*) FROM live_stream_attendance a WHERE a.tenant_id=l.tenant_id AND a.stream_id=l.id) AS attended
          FROM live_streams l WHERE l.tenant_id=? AND l.instructor_id=? AND l.status='ENDED') t`, [tenantId, staffId]);
  return {
    attendanceRate: pct(attendance?.attended, attendance?.held),
    retentionRate: pct(retention?.repeaters, retention?.clients),
    retainedClients: Number(retention?.repeaters) || 0,
    clients: Number(retention?.clients) || 0,
    consultationCompletionRate: pct(consultations.completed, consultations.completed + consultations.cancelled),
    completedConsultations: consultations.completed,
    cancelledConsultations: consultations.cancelled,
    liveCount: Number(lives?.lives) || 0,
    avgLiveAttendance: Number(lives?.lives) > 0 ? Math.round(Number(lives.attended) / Number(lives.lives)) : null,
  };
}

/**
 * «أول يوم»: the steps that make an account ready, each done or not, each pointing at the tab that does it. A step that does not
 * apply to this lecturer (no consultation profile, consultations off) is left out rather than shown as undone.
 */
async function onboardingOf(db, { tenantId, staffId, phone, therapist }) {
  const steps = [{ id: 'phone', label: 'رقم الواتساب على ملفك عشان توصلك الإشعارات', done: Boolean(String(phone || '').trim()), tab: 'profile' }];
  if (therapist) {
    steps.push({ id: 'photo', label: 'ضيف صورتك', done: Boolean(String(therapist.image || '').trim()), tab: 'profile' });
    steps.push({ id: 'bio', label: 'اكتب نبذة عنك', done: Boolean(String(therapist.bio || '').trim()), tab: 'profile' });
    if (therapist.is_consultation_enabled) {
      const [[slots]] = await db.query(
        `SELECT COUNT(*) AS n FROM therapist_slots s JOIN therapists t ON t.id=s.therapist_id WHERE s.therapist_id=? AND t.tenant_id=? AND s.is_active=1`,
        [therapist.id, tenantId]);
      steps.push({ id: 'hours', label: 'حدّد مواعيدك الأسبوعية للاستشارات', done: Number(slots?.n) > 0, tab: 'hours' });
    }
  }
  const [[lives]] = await db.query('SELECT COUNT(*) AS n FROM live_streams WHERE tenant_id=? AND instructor_id=?', [tenantId, staffId]);
  steps.push({ id: 'live', label: 'حدّد أول لايف', done: Number(lives?.n) > 0, tab: 'lives' });
  const [[posts]] = await db.query('SELECT COUNT(*) AS n FROM community_posts WHERE tenant_id=? AND staff_id=?', [tenantId, staffId]);
  steps.push({ id: 'post', label: 'انشر أول منشور في المجتمع', done: Number(posts?.n) > 0, tab: 'community' });
  return { steps, done: steps.filter(step => step.done).length, total: steps.length };
}

/** The numbers at the top of the portal. */
async function overviewOf(db, context) {
  const { tenantId, staffId, therapist } = context;
  const [[lives]] = await db.query(
    `SELECT SUM(status='UPCOMING' AND scheduled_at >= NOW() - INTERVAL 3 HOUR) AS upcoming, SUM(status='LIVE') AS live_now
       FROM live_streams WHERE tenant_id=? AND instructor_id=?`, [tenantId, staffId]);
  const [[nextLive]] = await db.query(
    `SELECT id, title, scheduled_at FROM live_streams
      WHERE tenant_id=? AND instructor_id=? AND status='UPCOMING' AND scheduled_at >= NOW() - INTERVAL 3 HOUR
      ORDER BY scheduled_at LIMIT 1`, [tenantId, staffId]);
  let consultations = { pending: 0, upcoming: 0, urgent: 0 };
  if (therapist) {
    const [[row]] = await db.query(
      `SELECT SUM(status='PENDING') AS pending,
              SUM(status IN ('PENDING','CONFIRMED') AND session_date >= ${sqlCairoToday()}) AS upcoming,
              SUM(status IN ('PENDING','CONFIRMED') AND source='site_express') AS urgent
         FROM consultations WHERE tenant_id=? AND therapist_id=? AND deleted_at IS NULL`, [tenantId, therapist.id]);
    consultations = { pending: Number(row?.pending) || 0, upcoming: Number(row?.upcoming) || 0, urgent: Number(row?.urgent) || 0 };
  }
  const [[students]] = await db.query(
    `SELECT (SELECT COUNT(DISTINCT e.subscriber_id) FROM enrollments e
               JOIN courses c ON c.id=e.course_id AND c.tenant_id=e.tenant_id AND c.instructor_id=?
              WHERE e.tenant_id=? AND e.status='active') AS online,
            (SELECT COUNT(DISTINCT a.subscriber_id) FROM daqqi_attendees a
               JOIN daqqi_rounds r ON r.id=a.round_id AND r.tenant_id=a.tenant_id AND r.instructor_id=? AND r.status<>'FINISHED'
              WHERE a.tenant_id=?) AS rounds`, [staffId, tenantId, staffId, tenantId]);
  const reviews = await reviewsOf(db, { tenantId, staffId, name: context.name, therapistId: therapist?.id || null });
  const earnings = await earningsOf(db, { tenantId, staffId });
  const [[unread]] = await db.query(
    'SELECT COUNT(*) AS n FROM notifications WHERE tenant_id=? AND recipient_staff_id=? AND read_at IS NULL', [tenantId, staffId]);
  return {
    lives: { upcoming: Number(lives?.upcoming) || 0, liveNow: Number(lives?.live_now) || 0, next: nextLive ? { id: nextLive.id, title: nextLive.title, at: nextLive.scheduled_at } : null },
    consultations,
    consultationsEnabled: Boolean(therapist?.is_consultation_enabled),
    students: { online: Number(students?.online) || 0, rounds: Number(students?.rounds) || 0 },
    rating: { instructor: reviews.summary.instructorScore, course: reviews.summary.courseStars, count: reviews.summary.roundRatings + reviews.summary.courseRatings + reviews.summary.consultationRatings },
    earnings: earnings.totals,
    unreadNotifications: Number(unread?.n) || 0,
    performance: await performanceOf(db, { tenantId, staffId, therapistId: therapist?.id || null }),
    onboarding: await onboardingOf(db, context),
  };
}

module.exports = {
  FEE_LABEL, LECTURER_ROLES,
  earningsOf, lecturerContext, myCourses, myRounds, onboardingOf, overviewOf, performanceOf, requireLecturer, reviewsOf, studentsOf,
};
