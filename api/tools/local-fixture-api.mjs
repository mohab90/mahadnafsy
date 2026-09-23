/**
 * A stand-in API for driving the admin UI locally.
 *
 * There is no database on this machine and no reliable route to the live host,
 * so neither the real API nor production can back a UI run. This serves the
 * endpoints the dashboard calls, from fixtures, on 127.0.0.1:3101 — the address
 * admin/vite.config.ts already proxies to by default, so nothing else changes.
 *
 * What this can and cannot prove:
 *   CAN  — every screen renders, navigation works, role gating hides what it
 *          should, buttons fire the requests they claim to, and the responses
 *          are handled without crashing.
 *   CANNOT — that the real SQL, transactions or permissions behave correctly.
 *          Those are covered by the unit suite and by reading the routes.
 *
 * Never import this from application code. It exists to be run by hand.
 */
import express from 'express';

const app = express();
app.use(express.json({ limit: '5mb' }));

// ── Role switching ───────────────────────────────────────────────────────────
// The point of the exercise is to see the dashboard as each job sees it, so the
// signed-in identity is swappable at runtime rather than baked in.
const ROLES = {
  admin: { id: 'staff-admin', name: 'مدير النظام', role: 'admin', email: 'admin@mahad.local' },
  manager: { id: 'staff-mgr', name: 'مدير عام', role: 'manager', email: 'manager@mahad.local' },
  sales: { id: 'staff-sales', name: 'أحمد — مبيعات', role: 'sales', email: 'sales@mahad.local' },
  collection: { id: 'staff-coll', name: 'منى — تحصيل', role: 'collection', email: 'collection@mahad.local' },
  hr: { id: 'staff-hr', name: 'هدى — موارد بشرية', role: 'hr', email: 'hr@mahad.local' },
  accountant: { id: 'staff-acc', name: 'كريم — محاسب', role: 'accountant', email: 'accountant@mahad.local' },
  support: { id: 'staff-sup', name: 'سارة — خدمة عملاء', role: 'support', email: 'support@mahad.local' },
  reception_daqqi: { id: 'staff-rec', name: 'ريسبشن الدقي', role: 'reception_daqqi', email: 'reception@mahad.local' },
};
let current = ROLES.admin;

app.get('/__role/:key', (req, res) => {
  const next = ROLES[req.params.key];
  if (!next) return res.status(404).json({ error: 'unknown role', known: Object.keys(ROLES) });
  current = next;
  res.json({ ok: true, now: current });
});

// ── Fixtures ─────────────────────────────────────────────────────────────────
const iso = d => new Date(Date.now() - d * 86400000).toISOString();

const courses = [
  { id: 'c1', title: 'دبلومة علم النفس الإكلينيكي', titleAr: 'دبلومة علم النفس الإكلينيكي', price: { EGP: 7900 }, isPublished: 1, is_published: 1, instructor: 'د. منى', slug: 'clinical', category: 'therapy', level: 'beginner', createdAt: iso(60) },
  { id: 'c2', title: 'العلاج المعرفي السلوكي CBT', titleAr: 'العلاج المعرفي السلوكي CBT', price: { EGP: 6500 }, isPublished: 1, is_published: 1, instructor: 'د. أحمد', slug: 'cbt', category: 'therapy', level: 'intermediate', createdAt: iso(40) },
];

const staff = Object.values(ROLES).map((r, i) => ({
  id: r.id, name: r.name, email: r.email, role: r.role, phone: `010000000${i}`,
  status: 'active', is_active: 1, branch: i % 2 ? 'DAQQI' : 'ONLINE_EGYPT',
  commission_rate: r.role === 'sales' ? 5 : null, base_salary: 8000 + i * 500,
  commission_type: r.role === 'sales' ? 'PERCENT' : 'NONE',
  monthly_target: r.role === 'sales' ? 50000 : null,
  createdAt: iso(200), joined_at: iso(200), hire_date: iso(200),
}));

const leads = Array.from({ length: 12 }, (_, i) => ({
  id: `lead-${i + 1}`, name: `عميل محتمل ${i + 1}`, phone: `0101234${String(i).padStart(4, '0')}`,
  email: i % 3 ? `lead${i}@test.local` : null,
  status: ['new', 'contacted', 'interested', 'converted', 'lost'][i % 5],
  source: ['facebook', 'whatsapp', 'referral', 'google'][i % 4],
  branch: i % 2 ? 'DAQQI' : 'ONLINE_EGYPT',
  assigned_sales_id: i % 2 ? 'staff-sales' : null,
  assignedSalesId: i % 2 ? 'staff-sales' : null,
  createdAt: iso(i), created_at: iso(i), hidden: 0, deal_value: i * 500,
  interestedCourseIds: i % 2 ? ['c1'] : [],
}));

const subscribers = Array.from({ length: 8 }, (_, i) => ({
  id: `sub-${i + 1}`, name: `عميل ${i + 1}`, email: `client${i}@test.local`,
  phone: `0111234${String(i).padStart(4, '0')}`, clientCode: `CL-${1000 + i}`, client_code: `CL-${1000 + i}`,
  branch: i % 2 ? 'DAQQI' : 'ONLINE_EGYPT', isActive: true, is_active: 1,
  clientStatus: 'active', totalPaid: 2000 * (i + 1), enrolledCourseIds: ['c1'],
  createdAt: iso(i * 3), created_at: iso(i * 3), assigned_sales_id: 'staff-sales',
  paymentHistory: [{ id: `p-${i}`, amount: 2000 * (i + 1), currency: 'EGP', status: 'paid', at: iso(i * 3), courseId: 'c1' }],
  lectureProgress: {}, communications: [],
}));

const joinUs = [
  { id: 'ju-1', name: 'مصطفى إبراهيم', email: 'm@test.local', phone: '01012345678', specialty: 'علاج نفسي', experience: '3-5', type: 'EMPLOYEE', status: 'NEW', created_at: iso(2), admin_note: null, converted_applicant_id: null, contacted_at: null, contacted_by: null, contacted_by_name: null, interview_at: null, application_category: 'HR' },
  { id: 'ju-2', name: 'نورهان علي', email: 'n@test.local', phone: '01123456789', specialty: 'إرشاد أسري', experience: '1-3', type: 'INSTRUCTOR', status: 'CONTACTED', created_at: iso(5), admin_note: null, converted_applicant_id: null, contacted_at: iso(1), contacted_by: 'staff-hr', contacted_by_name: 'هدى — موارد بشرية', interview_at: null, application_category: 'ACADEMIC' },
];

const applicants = [
  { id: 'ap-1', job_id: 'job-1', name: 'مصطفى إبراهيم', email: 'm@test.local', phone: '01012345678', stage: 'interview', stage_notes: null, notes: null, interview_rating: null, interview_grade: null, second_interview_grade: null, interviewed_by_name: null, second_interviewed_by_name: null, interviewed_at: null, second_interviewed_at: null, source: 'website', specialty: 'علاج نفسي', applicant_type: 'EMPLOYEE', job_title: 'أخصائي نفسي', job_branch: 'DAQQI', hired_staff_id: null, created_at: iso(3), updated_at: iso(1) },
  { id: 'ap-2', job_id: 'job-1', name: 'سلمى حسن', email: null, phone: '01234567890', stage: 'offer', stage_notes: 'مرشحة قوية', notes: null, interview_rating: 4, interview_grade: 'A', second_interview_grade: null, interviewed_by_name: 'هدى — موارد بشرية', second_interviewed_by_name: null, interviewed_at: iso(2), second_interviewed_at: null, source: 'manual', specialty: 'إرشاد', applicant_type: 'EMPLOYEE', job_title: 'أخصائي نفسي', job_branch: 'ONLINE_EGYPT', hired_staff_id: null, created_at: iso(6), updated_at: iso(2) },
];

const notes = [];
const documents = new Map();

// ── Auth ─────────────────────────────────────────────────────────────────────
app.get('/api/auth/me', (_req, res) => res.json({
  uid: current.id, email: current.email, displayName: current.name,
  phone: '', isAdmin: current.role === 'admin',
}));
app.get('/api/health', (_req, res) => res.json({ ok: true, fixture: true }));
app.get('/api/admin/staff/me', (_req, res) => res.json(staff.find(s => s.id === current.id) || staff[0]));

// ── Reads the dashboard makes on load ────────────────────────────────────────
const list = rows => (_req, res) => res.json(rows);
app.get('/api/courses', list(courses));
app.get('/api/admin/courses', list(courses));
app.get('/api/bundles', list([]));
app.get('/api/therapists', list([]));
app.get('/api/testimonials', list([]));
app.get('/api/lectures', list([]));
app.get('/api/chapters', list([]));
app.get('/api/admin/staff', list(staff));
app.get('/api/admin/leads', list(leads));
app.get('/api/admin/subscribers', list(subscribers));
app.get('/api/admin/join-us', list(joinUs));
app.get('/api/admin/hr/applicants', list(applicants));
app.get('/api/admin/content', (_req, res) => res.json({ 'site.title': 'معهد الدراسات النفسية' }));

// ── The routes this session added ────────────────────────────────────────────
app.get('/api/admin/hr/notes/:refType/:refId', (req, res) =>
  res.json(notes.filter(n => n.ref_type === req.params.refType && n.ref_id === req.params.refId)));

app.post('/api/admin/hr/notes/:refType/:refId', (req, res) => {
  if (!String(req.body?.body || '').trim()) return res.status(400).json({ error: 'اكتب نص الملاحظة' });
  notes.unshift({ id: `n-${notes.length + 1}`, ref_type: req.params.refType, ref_id: req.params.refId, kind: 'note', body: req.body.body, author_name: current.name, created_at: new Date().toISOString() });
  res.json({ ok: true });
});

app.post('/api/admin/join-us/:id/contact', (req, res) => {
  const row = joinUs.find(j => j.id === req.params.id);
  if (!row) return res.status(404).json({ error: 'Application not found' });
  row.contacted_at = new Date().toISOString();
  row.contacted_by_name = current.name;
  if (row.status === 'NEW' || row.status === 'REVIEWED') row.status = 'CONTACTED';
  notes.unshift({ id: `n-${notes.length + 1}`, ref_type: 'join_us', ref_id: row.id, kind: 'contact', body: req.body?.body || 'تم التواصل مع المتقدم', author_name: current.name, created_at: new Date().toISOString() });
  res.json({ ok: true, contactedBy: current.name });
});

app.post('/api/admin/join-us/:id/evaluate', (req, res) => {
  const decision = String(req.body?.decision || '').toUpperCase();
  if (!['ACCEPTED', 'REJECTED'].includes(decision)) return res.status(400).json({ error: 'القرار لازم يكون قبول أو رفض' });
  const row = joinUs.find(j => j.id === req.params.id);
  if (!row) return res.status(404).json({ error: 'Application not found' });
  row.status = decision;
  row.interview_at = decision === 'ACCEPTED' && req.body?.interviewAt ? req.body.interviewAt : null;
  res.json({ ok: true, status: decision, interviewAt: row.interview_at });
});

app.post('/api/admin/hr/applicants/:id/grade', (req, res) => {
  const GRADES = ['A+', 'A', 'B+', 'B', 'C+', 'C', 'R', 'W'];
  const grade = String(req.body?.grade || '').toUpperCase();
  if (!GRADES.includes(grade)) return res.status(400).json({ error: 'تقييم غير معروف' });
  const row = applicants.find(a => a.id === req.params.id);
  if (!row) return res.status(404).json({ error: 'Applicant not found' });
  const second = String(req.body?.round || '1') === '2';
  if (second) { row.second_interview_grade = grade; row.second_interviewed_by_name = current.name; row.second_interviewed_at = new Date().toISOString(); }
  else { row.interview_grade = grade; row.interviewed_by_name = current.name; row.interviewed_at = new Date().toISOString(); }
  res.json({ ok: true, grade, round: second ? 2 : 1, by: current.name });
});

app.post('/api/admin/hr/applicants/:id/hire', (req, res) => {
  const row = applicants.find(a => a.id === req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  if (row.stage !== 'offer' && row.stage !== 'interview') {
    return res.status(409).json({ error: 'المرشح لازم يوصل لمرحلة المقابلة أو العرض قبل التعيين', code: 'OFFER_STAGE_REQUIRED' });
  }
  const email = String(req.body?.email || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'حدد بريدًا إلكترونيًا صحيحًا لحساب الموظف' });
  if (req.body?.password && String(req.body.password).length < 8) return res.status(400).json({ error: 'كلمة المرور 8 أحرف على الأقل' });
  row.stage = 'hired';
  row.hired_staff_id = `staff-new-${row.id}`;
  res.json({ ok: true, staffId: row.hired_staff_id });
});

const DOC_TYPES = ['NATIONAL_ID', 'PHOTOS', 'QUALIFICATION', 'BIRTH_CERT', 'WORK_STUB', 'INSURANCE_PRINT', 'MILITARY'];
const DOC_LABELS = { NATIONAL_ID: 'صورة بطاقة الرقم القومي', PHOTOS: 'صورتان شخصيتان', QUALIFICATION: 'صورة المؤهل', BIRTH_CERT: 'شهادة الميلاد', WORK_STUB: 'كعب العمل', INSURANCE_PRINT: 'برنت التأمين', MILITARY: 'الموقف من التجنيد' };

app.get('/api/admin/hr/staff/:staffId/documents', (req, res) => {
  const held = documents.get(req.params.staffId) || {};
  res.json(DOC_TYPES.map(t => ({
    docType: t, label: DOC_LABELS[t],
    received: Boolean(held[t]?.received), note: held[t]?.note || null,
    updatedAt: held[t]?.updatedAt || null, updatedByName: held[t]?.by || null,
    recorded: Boolean(held[t]),
  })));
});

app.put('/api/admin/hr/staff/:staffId/documents/:docType', (req, res) => {
  if (!DOC_TYPES.includes(req.params.docType)) return res.status(400).json({ error: 'نوع مستند غير معروف' });
  const held = documents.get(req.params.staffId) || {};
  held[req.params.docType] = { received: Boolean(req.body?.received), note: req.body?.note || null, updatedAt: new Date().toISOString(), by: current.name };
  documents.set(req.params.staffId, held);
  res.json({ ok: true });
});

// Shaped to StaffProfileData — a bare [] here crashed the profile page, which
// is how the missing `profile?.tasks` guard surfaced.
app.get('/api/admin/hr/staff/:staffId/profile', (req, res) => {
  const s = staff.find(x => x.id === req.params.staffId) || staff[0];
  res.json({
    staff: { id: s.id, name: s.name, role: s.role, joinedAt: s.joined_at, commissionRate: s.commission_rate || 0, monthlyTarget: s.monthly_target || 0, monthlyTargetType: 'egp', monthlyBonus: 0 },
    today: { date: new Date().toISOString().slice(0, 10), calls: 4, touches: 9, bookings: 2, revenue: 4500, leads: 3 },
    timeline: Array.from({ length: 6 }, (_, i) => ({ ym: `2026-0${i + 3}`, revenue: 10000 + i * 2500, bookings: 3 + i, calls: 20 + i * 4, leads: 8 + i })),
    lifetime: { firstSaleAt: iso(180), biggestSale: 7900, bookings: 34, revenue: 128000, calls: 410, leads: 96, converted: 34, bestMonth: { ym: '2026-06', revenue: 22500 } },
    tasks: { todo: 3, inProgress: 2, done: 17, overdue: 1 },
    rank: {
      position: 2,
      outOf: 6,
      board: staff.slice(0, 5).map((row, i) => ({ position: i + 1, id: row.id, name: row.name, revenue: 150000 - i * 20000, bookings: 40 - i * 5, calls: 500 - i * 60 })),
    },
    achievements: [],
  });
});

app.get('/api/admin/hr/staff/:staffId/pay', (req, res) => {
  const s = staff.find(x => x.id === req.params.staffId);
  if (!s) return res.status(404).json({ error: 'Staff not found' });
  res.json({ baseSalary: s.base_salary, commissionType: s.commission_type, commissionRate: s.commission_rate, monthlyTarget: s.monthly_target });
});

app.put('/api/admin/hr/staff/:staffId/pay', (req, res) => {
  const s = staff.find(x => x.id === req.params.staffId);
  if (!s) return res.status(404).json({ error: 'Staff not found' });
  const type = String(req.body?.commissionType || 'NONE').toUpperCase();
  if (!['NONE', 'PERCENT', 'TARGET'].includes(type)) return res.status(400).json({ error: 'نظام العمولة لازم يكون بدون / نسبة / تارجيت' });
  if (type === 'PERCENT' && (req.body.commissionRate == null || Number(req.body.commissionRate) > 100)) {
    return res.status(400).json({ error: 'نسبة العمولة لازم تكون من 0 إلى 100' });
  }
  if (type === 'TARGET' && req.body.monthlyTarget == null) return res.status(400).json({ error: 'حدد قيمة التارجيت الشهري' });
  Object.assign(s, { base_salary: req.body.baseSalary, commission_type: type, commission_rate: req.body.commissionRate, monthly_target: req.body.monthlyTarget });
  res.json({ ok: true });
});

app.delete('/api/admin/join-us/:id', (req, res) => {
  const i = joinUs.findIndex(j => j.id === req.params.id);
  if (i < 0) return res.status(404).json({ error: 'Application not found' });
  if (joinUs[i].converted_applicant_id) return res.status(409).json({ error: 'Pipeline applications cannot be deleted; reject them instead' });
  joinUs.splice(i, 1);
  res.json({ ok: true });
});

// ── Everything else ──────────────────────────────────────────────────────────
// An empty collection rather than a 404, so a screen calling an endpoint this
// fixture does not model renders empty instead of erroring — the run is looking
// for UI faults, and a missing fixture is not one.
app.use('/api', (req, res) => {
  if (req.method === 'GET') return res.json([]);
  res.json({ ok: true, fixture: true, note: `unmodelled ${req.method} ${req.path}` });
});

const port = Number(process.env.FIXTURE_PORT || 3101);
app.listen(port, '127.0.0.1', () => {
  console.log(`[fixture-api] listening on http://127.0.0.1:${port} as ${current.role}`);
  console.log(`[fixture-api] switch role: GET /__role/<${Object.keys(ROLES).join('|')}>`);
});
