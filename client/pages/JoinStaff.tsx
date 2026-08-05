import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Send, CheckCircle, Users, Award, Star, Heart, Briefcase, GraduationCap, MapPin, Clock } from 'lucide-react';
import { useSiteData } from '../context/SiteDataContext';

type JobPosting = {
  id: string; title: string; branch?: string; employment_type?: string;
  description?: string; requirements?: string; salary_min?: number; salary_max?: number; department?: string;
};

const EMP_LABEL: Record<string, string> = { full_time: 'دوام كامل', part_time: 'دوام جزئي', contract: 'عقد', remote: 'عن بُعد', internship: 'تدريب' };
const BRANCH_LABEL: Record<string, string> = {
  DAQQI: 'فرع الدقي', TAGAMOA: 'فرع التجمع', ONLINE_EGYPT: 'أونلاين محلي (مصر)', ONLINE_SAUDI: 'أونلاين سعودي', ONLINE_ABROAD: 'أونلاين دولي', OTHER: 'أخرى',
  daqqi: 'فرع الدقي', tagamoa: 'فرع التجمع', online_egypt: 'أونلاين محلي (مصر)', online_saudi: 'أونلاين سعودي', online_abroad: 'أونلاين دولي', other: 'أخرى',
  tanta_admin: 'الفرع الإداري - طنطا',
};

// The employee/staff track — split out of the old shared JoinUs.tsx per the
// owner's explicit request for a genuinely different page (design, benefits,
// and flow), not the same layout with swapped copy. Careers-board style: open
// positions lead the page, benefits and requirements are staff-specific, and
// picking a listing now actually attaches the application to that job
// (jobId) instead of always landing everyone in the generic talent pool.
const JoinStaff: React.FC = () => {
  useEffect(() => { document.title = 'الوظائف المتاحة | معهد الدراسات النفسية'; }, []);
  const { addJoinUsApplication } = useSiteData();
  const [jobs, setJobs] = useState<JobPosting[]>([]);
  const [jobsLoading, setJobsLoading] = useState(true);
  useEffect(() => {
    fetch('/api/jobs')
      .then(r => r.json())
      .then(d => setJobs(Array.isArray(d) ? d : []))
      .catch(() => {})
      .finally(() => setJobsLoading(false));
  }, []);

  const [form, setForm] = useState({ name: '', email: '', phone: '', specialty: '', experience: '', linkedin: '', message: '', jobId: '' });
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  const pickJob = (j: JobPosting) => {
    setForm(f => ({ ...f, jobId: j.id, specialty: j.title, message: f.message || `أتقدم لوظيفة: ${j.title}` }));
    document.getElementById('staff-application-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setSubmitError('');
    try {
      await addJoinUsApplication({
        id: `ju-${Date.now()}`,
        name: form.name,
        email: form.email,
        phone: form.phone,
        specialty: form.specialty,
        experience: form.experience,
        type: 'employee',
        linkedin: form.linkedin || undefined,
        message: form.message || undefined,
        status: 'new',
        ...(form.jobId ? { jobId: form.jobId } : {}),
        createdAt: new Date().toLocaleString('ar-EG-u-nu-latn', { hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }),
      });
      setSubmitted(true);
    } catch {
      setSubmitError('تعذر إرسال طلبك حاليًا. لم يتم حفظه، يرجى المحاولة مرة أخرى.');
    } finally {
      setSubmitting(false);
    }
  };

  const benefits = [
    { icon: Users, title: 'فريق محترف', desc: 'انضم لفريق عمل متعاون في بيئة احترافية داعمة للنمو والتطور المهني.', color: 'text-blue-400 bg-blue-500/10' },
    { icon: Award, title: 'مسار وظيفي واضح', desc: 'فرص ترقٍّ حقيقية وتقييم أداء عادل يكافئ الإنجاز والتميّز.', color: 'text-amber-400 bg-amber-500/10' },
    { icon: Star, title: 'حوافز ومكافآت', desc: 'رواتب تنافسية + عمولات ومكافآت مرتبطة بتحقيق الأهداف.', color: 'text-rose-400 bg-rose-500/10' },
    { icon: Heart, title: 'بيئة عمل داعمة', desc: 'ثقافة عمل إيجابية تهتم بتوازن الحياة وتطوير المهارات باستمرار.', color: 'text-pink-400 bg-pink-500/10' },
  ];

  const requirements = [
    'مؤهل دراسي مناسب للوظيفة المتقدَّم لها.',
    'مهارات تواصل جيدة والقدرة على العمل ضمن فريق.',
    'الالتزام والانضباط وروح المبادرة.',
    'إجادة استخدام الحاسب والأدوات الرقمية الأساسية.',
    'الرغبة في التعلّم والتطور المهني المستمر.',
  ];

  return (
    <div className="bg-slate-50 min-h-screen animate-fade-in">
      {/* Hero — distinct corporate/careers identity: dark slate + emerald, not the teaching page's violet */}
      <div className="bg-slate-900 text-white py-20 relative overflow-hidden">
        <div className="absolute top-0 left-0 w-96 h-96 bg-emerald-600 rounded-full blur-[140px] opacity-20"></div>
        <div className="absolute bottom-0 right-0 w-96 h-96 bg-teal-500 rounded-full blur-[140px] opacity-20"></div>
        <div className="container mx-auto px-4 relative z-10 text-center">
          <div className="inline-flex items-center gap-2 bg-emerald-500/15 border border-emerald-400/30 text-emerald-300 px-4 py-2 rounded-full text-sm font-bold mb-6">
            <Briefcase size={18} />
            انضم لفريق العمل
          </div>
          <h1 className="text-4xl md:text-6xl font-bold mb-6">ابنِ مستقبلك المهني<br />مع فريقنا</h1>
          <p className="text-xl text-slate-300 max-w-2xl mx-auto leading-relaxed">
            نبحث دائماً عن مواهب طموحة تشاركنا الشغف. تصفّح الوظائف المتاحة وقدّم للفرصة التي تناسب خبراتك وتطلعاتك.
          </p>
          <div className="mt-8">
            <Link to="/join" className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-white transition underline underline-offset-4">
              <GraduationCap size={14} /> معالج أو مدرب نفسي؟ قدّم من هنا بدلاً من ذلك
            </Link>
          </div>
        </div>
      </div>

      {/* Open positions — leads the page, careers-board style */}
      <section className="py-16 bg-white border-b border-slate-100">
        <div className="container mx-auto px-4">
          <div className="max-w-4xl mx-auto">
            <h2 className="text-2xl font-bold text-slate-900 mb-1 flex items-center gap-2"><Briefcase size={22} className="text-emerald-600" /> الوظائف المتاحة حالياً</h2>
            <p className="text-sm text-slate-500 mb-6">اختر وظيفة لربط طلبك بها مباشرة، أو انزل للنموذج وأرسل طلبك العام.</p>
            {jobsLoading ? (
              <div className="py-10 text-center text-sm text-slate-400">جاري تحميل الوظائف...</div>
            ) : jobs.length === 0 ? (
              <div className="py-10 text-center text-sm text-slate-400 bg-slate-50 rounded-2xl border border-slate-100">
                لا توجد وظائف مُعلنة حالياً — يمكنك إرسال طلبك العام أدناه وسنتواصل معك عند توفر شاغر مناسب.
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {jobs.map(j => (
                  <button key={j.id} type="button" onClick={() => pickJob(j)}
                    className={`text-right border-2 rounded-2xl p-5 transition hover:shadow-md ${form.jobId === j.id ? 'border-emerald-500 bg-emerald-50/60 ring-1 ring-emerald-300' : 'border-slate-200 bg-white hover:border-emerald-300'}`}>
                    <div className="flex items-center gap-2 flex-wrap mb-2">
                      <span className="font-bold text-slate-900">{j.title}</span>
                      {form.jobId === j.id && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-600 text-white font-bold">مُختارة</span>}
                    </div>
                    <div className="flex items-center gap-3 flex-wrap text-xs text-slate-500 mb-2">
                      {j.employment_type && <span className="flex items-center gap-1"><Clock size={12} /> {EMP_LABEL[j.employment_type] || j.employment_type}</span>}
                      {j.branch && <span className="flex items-center gap-1"><MapPin size={12} /> {BRANCH_LABEL[j.branch] || j.branch}</span>}
                      {j.department && <span className="px-1.5 py-0.5 rounded bg-slate-100">{j.department}</span>}
                    </div>
                    {j.description && <p className="text-xs text-slate-500 line-clamp-2 leading-relaxed">{j.description}</p>}
                    {(j.salary_min || j.salary_max) && (
                      <p className="text-xs text-emerald-700 font-bold mt-2">{j.salary_min || '?'}–{j.salary_max || '?'} ج.م</p>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Benefits — dark band, staff-specific */}
      <section className="py-20 bg-slate-900 text-white">
        <div className="container mx-auto px-4">
          <div className="text-center mb-14">
            <span className="bg-emerald-500/15 text-emerald-300 px-4 py-1.5 rounded-full text-sm font-bold">لماذا تنضم إلينا؟</span>
            <h2 className="text-3xl font-bold mt-4 mb-3">مزايا العمل معنا</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {benefits.map((b, i) => {
              const Icon = b.icon;
              return (
                <div key={i} className="bg-white/5 rounded-2xl p-6 border border-white/10 hover:border-emerald-500/40 transition group">
                  <div className={`w-14 h-14 rounded-2xl ${b.color} flex items-center justify-center mb-4 group-hover:scale-110 transition`}>
                    <Icon size={24} />
                  </div>
                  <h3 className="font-bold text-lg mb-2">{b.title}</h3>
                  <p className="text-slate-400 text-sm leading-relaxed">{b.desc}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Requirements */}
      <section className="py-16 bg-slate-50">
        <div className="container mx-auto px-4">
          <div className="max-w-3xl mx-auto">
            <h2 className="text-2xl font-bold text-slate-900 mb-8 text-center">المتطلبات العامة</h2>
            <div className="bg-white rounded-3xl p-8 shadow-sm border border-slate-100 space-y-4">
              {requirements.map((req, i) => (
                <div key={i} className="flex items-start gap-4">
                  <div className="w-7 h-7 rounded-full bg-emerald-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <CheckCircle size={16} className="text-emerald-600" />
                  </div>
                  <p className="text-slate-700 leading-relaxed">{req}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Application Form */}
      <section id="staff-application-form" className="py-20 bg-white">
        <div className="container mx-auto px-4">
          <div className="max-w-2xl mx-auto">
            <div className="text-center mb-10">
              <h2 className="text-3xl font-bold text-slate-900 mb-3">قدّم طلبك الآن</h2>
              <p className="text-slate-500">سيتواصل معك فريقنا خلال 3–5 أيام عمل لمراجعة طلبك.</p>
              {form.jobId && (
                <p className="mt-2 inline-flex items-center gap-1.5 text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-3 py-1">
                  <Briefcase size={12} /> طلبك مرتبط بوظيفة: {form.specialty}
                </p>
              )}
            </div>

            {submitted ? (
              <div className="text-center py-16 bg-emerald-50 rounded-3xl border border-emerald-100">
                <CheckCircle size={64} className="mx-auto text-emerald-500 mb-4" />
                <h3 className="text-xl font-bold text-slate-900 mb-2">تم استلام طلبك بنجاح!</h3>
                <p className="text-slate-500 mb-2">شكراً لاهتمامك بالانضمام إلى فريق معهد الدراسات النفسية.</p>
                <p className="text-slate-500">سيتواصل معك فريق الاختيار خلال 3–5 أيام عمل.</p>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="bg-white rounded-3xl shadow-sm border border-slate-100 p-8 space-y-5">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-bold text-slate-700 mb-1">الاسم الكامل *</label>
                    <input required type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="اسمك الثلاثي" className="w-full border border-slate-300 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-emerald-500 transition" />
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-slate-700 mb-1">رقم الهاتف *</label>
                    <input required type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="مثال: +20 100 000 0000" className="w-full border border-slate-300 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-emerald-500 transition" />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-1">البريد الإلكتروني *</label>
                  <input required type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="مثال: name@example.com" className="w-full border border-slate-300 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-emerald-500 transition" />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-bold text-slate-700 mb-1">الوظيفة المتقدَّم لها *</label>
                    <input required type="text" value={form.specialty} onChange={(e) => setForm({ ...form, specialty: e.target.value, jobId: '' })} placeholder="مثال: أخصائي مبيعات" className="w-full border border-slate-300 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-emerald-500 transition" />
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-slate-700 mb-1">سنوات الخبرة *</label>
                    <select required value={form.experience} onChange={(e) => setForm({ ...form, experience: e.target.value })} className="w-full border border-slate-300 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-emerald-500 transition bg-white">
                      <option value="">اختر</option>
                      <option value="3-5">3 – 5 سنوات</option>
                      <option value="5-10">5 – 10 سنوات</option>
                      <option value="10+">أكثر من 10 سنوات</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-1">رابط LinkedIn أو موقعك الشخصي</label>
                  <input type="url" value={form.linkedin} onChange={(e) => setForm({ ...form, linkedin: e.target.value })} placeholder="رابط LinkedIn أو موقعك الشخصي (اختياري)" className="w-full border border-slate-300 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-emerald-500 transition" />
                </div>

                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-1">رسالتك ودوافعك للانضمام</label>
                  <textarea rows={4} value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} placeholder="أخبرنا عن نفسك ولماذا تناسبك هذه الوظيفة..." className="w-full border border-slate-300 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-emerald-500 transition resize-none" />
                </div>

                {submitError && <p role="alert" className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-4 py-3">{submitError}</p>}
                <button type="submit" disabled={submitting} className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-4 rounded-xl flex items-center justify-center gap-2 transition text-lg disabled:opacity-50">
                  <Send size={20} />
                  {submitting ? 'جاري الإرسال...' : 'إرسال الطلب'}
                </button>
                <p className="text-center text-xs text-slate-400">بالإرسال توافق على شروط الاستخدام وسياسة الخصوصية الخاصة بالمعهد.</p>
              </form>
            )}
          </div>
        </div>
      </section>
    </div>
  );
};

export default JoinStaff;
