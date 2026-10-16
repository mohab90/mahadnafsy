import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Send, Check, CheckCircle, Users, Award, Star, Heart, Briefcase, GraduationCap, MapPin, Clock } from 'lucide-react';
import { useSiteData } from '../context/SiteDataContext';
import { CAIRO_TIME_ZONE } from '../../shared/cairoDate';
import { useSeo } from '../lib/useSeo';

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
  useSeo({ title: 'الوظائف المتاحة | معهد الدراسات النفسية', path: '/join-us', description: 'الوظائف المتاحة في معهد الدراسات النفسية — تقدّم للفرص المفتوحة.' });
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

  const [form, setForm] = useState({
    name: '', email: '', phone: '', specialty: '', experience: '', linkedin: '', message: '', jobId: '',
    branch: '', education: '', experiencePlaces: '',
  });
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
        // The page says which list it belongs on, so an employee is never filed
        // as a lecturer (12 Oct 2026).
        form: 'staff',
        linkedin: form.linkedin || undefined,
        message: form.message || undefined,
        status: 'new',
        ...(form.jobId ? { jobId: form.jobId } : {}),
        // Collected on the form and, until now, thrown away at the door.
        branch: form.branch || undefined,
        education: form.education || undefined,
        experiencePlaces: form.experiencePlaces || undefined,
        experienceYears: form.experience || undefined,
        createdAt: new Date().toLocaleString('ar-EG-u-nu-latn', { hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: CAIRO_TIME_ZONE }),
      });
      setSubmitted(true);
    } catch {
      setSubmitError('تعذر إرسال طلبك حاليًا. لم يتم حفظه، يرجى المحاولة مرة أخرى.');
    } finally {
      setSubmitting(false);
    }
  };

  const benefits = [
    { icon: Users, title: 'فريق محترف', desc: 'انضم لفريق عمل متعاون في بيئة احترافية داعمة للنمو والتطور المهني.' },
    { icon: Award, title: 'مسار وظيفي واضح', desc: 'فرص ترقٍّ حقيقية وتقييم أداء عادل يكافئ الإنجاز والتميّز.' },
    { icon: Star, title: 'حوافز ومكافآت', desc: 'رواتب تنافسية + عمولات ومكافآت مرتبطة بتحقيق الأهداف.' },
    { icon: Heart, title: 'بيئة عمل داعمة', desc: 'ثقافة عمل إيجابية تهتم بتوازن الحياة وتطوير المهارات باستمرار.' },
  ];

  const requirements = [
    'مؤهل دراسي مناسب للوظيفة المتقدَّم لها.',
    'مهارات تواصل جيدة والقدرة على العمل ضمن فريق.',
    'الالتزام والانضباط وروح المبادرة.',
    'إجادة استخدام الحاسب والأدوات الرقمية الأساسية.',
    'الرغبة في التعلّم والتطور المهني المستمر.',
  ];

  const inputCls = 'min-h-[50px] w-full rounded-xl border border-line-strong bg-paper px-4 text-[15px] text-ink outline-none transition placeholder:text-muted-faint focus:border-primary-600 focus:bg-white focus:ring-4 focus:ring-primary-600/10';
  const areaCls = `${inputCls} resize-none py-3`;
  const labelCls = 'mb-1 block text-[13px] font-bold text-muted-strong';
  const stepCls = 'flex items-center gap-2.5 text-lg font-black text-ink';
  const stepNum = 'flex h-8 w-8 flex-none items-center justify-center rounded-full bg-ink text-sm font-black text-gold-light';

  return (
    <div className="min-h-screen bg-white">
      {/* Hero — the careers track: deep ink and gold, not the teaching page's burgundy */}
      <section className="relative overflow-hidden bg-ink text-white">
        <div aria-hidden="true" className="pointer-events-none absolute -left-40 -top-48 h-[460px] w-[460px] rounded-full bg-[radial-gradient(closest-side,rgba(227,182,90,.18),transparent)]" />
        <div aria-hidden="true" className="pointer-events-none absolute -bottom-40 -right-32 h-[380px] w-[380px] rounded-full bg-[radial-gradient(closest-side,rgba(190,18,60,.28),transparent)]" />
        <div className="container relative mx-auto px-4 py-14 text-center sm:py-20">
          <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-1.5 text-sm font-extrabold text-gold-light ring-1 ring-white/15">
            <Briefcase size={17} />
            انضم لفريق العمل
          </span>
          <h1 className="mt-5 text-balance text-3xl font-black leading-tight sm:text-5xl">ابنِ مستقبلك المهني<br />مع فريقنا</h1>
          <p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-white/65 sm:text-lg">
            نبحث دائماً عن مواهب طموحة تشاركنا الشغف. تصفّح الوظائف المتاحة وقدّم للفرصة التي تناسب خبراتك وتطلعاتك.
          </p>
          <div className="mt-6">
            <Link to="/join" className="inline-flex min-h-[44px] items-center gap-2 text-sm font-bold text-white/65 underline underline-offset-4 transition hover:text-white">
              <GraduationCap size={14} /> معالج أو مدرب نفسي؟ قدّم من هنا بدلاً من ذلك
            </Link>
          </div>
        </div>
      </section>

      {/* Open positions — leads the page, careers-board style */}
      <section className="bg-white py-14 sm:py-20">
        <div className="container mx-auto px-4">
          <div className="mx-auto max-w-4xl">
            <h2 className="flex items-center justify-center gap-2.5 text-center text-3xl font-black leading-tight text-ink sm:justify-start sm:text-right sm:text-4xl"><Briefcase size={28} className="flex-none text-gold-deep" /> الوظائف المتاحة حالياً</h2>
            <p className="mt-2 text-center text-base leading-relaxed text-muted-body sm:text-right">اختر وظيفة لربط طلبك بها مباشرة، أو انزل للنموذج وأرسل طلبك العام.</p>
            <div className="mt-7">
              {jobsLoading ? (
                <div className="rounded-[24px] border border-line bg-paper py-10 text-center text-sm text-muted">جاري تحميل الوظائف...</div>
              ) : jobs.length === 0 ? (
                <div className="rounded-[24px] border border-line bg-paper px-5 py-10 text-center text-sm leading-relaxed text-muted">
                  لا توجد وظائف مُعلنة حالياً — يمكنك إرسال طلبك العام أدناه وسنتواصل معك عند توفر شاغر مناسب.
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {jobs.map(j => (
                    <button key={j.id} type="button" onClick={() => pickJob(j)}
                      className={`flex flex-col rounded-[24px] border-[1.5px] p-5 text-right transition hover:-translate-y-1 hover:shadow-[0_30px_50px_-25px_rgba(26,15,18,.35)] ${form.jobId === j.id ? 'border-primary-700 bg-primary-50/60 ring-4 ring-primary-600/10' : 'border-line bg-white hover:border-line-deep'}`}>
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <span className="text-lg font-black text-ink">{j.title}</span>
                        {form.jobId === j.id && <span className="rounded-full bg-primary-700 px-2.5 py-0.5 text-[11px] font-black text-white">مُختارة</span>}
                      </div>
                      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted-strong">
                        {j.employment_type && <span className="inline-flex items-center gap-1 rounded-full bg-paper px-2.5 py-1 font-extrabold ring-1 ring-line"><Clock size={12} /> {EMP_LABEL[j.employment_type] || j.employment_type}</span>}
                        {j.branch && <span className="inline-flex items-center gap-1 rounded-full bg-paper px-2.5 py-1 font-extrabold ring-1 ring-line"><MapPin size={12} /> {BRANCH_LABEL[j.branch] || j.branch}</span>}
                        {j.department && <span className="rounded-full bg-paper px-2.5 py-1 font-extrabold ring-1 ring-line">{j.department}</span>}
                      </div>
                      {j.description && <p className="line-clamp-2 text-[13px] leading-relaxed text-muted">{j.description}</p>}
                      {/* Number(), because salary_min/max are DECIMAL columns and
                          arrive as strings: "0.00" is truthy, so a posting with
                          no salary set advertised «0.00–0.00 ج.م» — and the ones
                          that do have a salary read «5000.00–15000.00» on a job
                          ad rather than «5,000 – 15,000». */}
                      {(Number(j.salary_min) > 0 || Number(j.salary_max) > 0) && (
                        <p className="mt-3 text-sm font-black tabular-nums text-ink">
                          {Number(j.salary_min) > 0 ? Number(j.salary_min).toLocaleString('ar-EG-u-nu-latn') : '?'}
                          {' – '}
                          {Number(j.salary_max) > 0 ? Number(j.salary_max).toLocaleString('ar-EG-u-nu-latn') : '?'} ج.م
                        </p>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Benefits — staff-specific */}
      <section className="bg-paper py-14 sm:py-20">
        <div className="container mx-auto px-4">
          <div className="mx-auto mb-10 max-w-2xl text-center sm:mb-12">
            <span className="text-sm font-extrabold text-gold-deep">لماذا تنضم إلينا؟</span>
            <h2 className="mt-2 text-3xl font-black leading-tight text-ink sm:text-4xl">مزايا العمل معنا</h2>
          </div>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {benefits.map((b, i) => {
              const Icon = b.icon;
              return (
                <div key={i} className="rounded-[24px] border border-line bg-white p-5 transition hover:-translate-y-1 hover:shadow-[0_30px_50px_-25px_rgba(26,15,18,.35)] sm:p-6">
                  <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-ink text-gold-light">
                    <Icon size={22} />
                  </span>
                  <h3 className="mt-4 text-lg font-black text-ink">{b.title}</h3>
                  <p className="mt-1.5 text-[15px] leading-relaxed text-muted">{b.desc}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Requirements */}
      <section className="bg-white py-14 sm:py-20">
        <div className="container mx-auto px-4">
          <div className="mx-auto max-w-3xl">
            <h2 className="text-center text-3xl font-black leading-tight text-ink sm:text-4xl">المتطلبات العامة</h2>
            <div className="mt-8 divide-y divide-line rounded-[28px] border border-line bg-white px-5 sm:px-8">
              {requirements.map((req, i) => (
                <div key={i} className="flex items-start gap-3.5 py-4">
                  <span className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-paper text-gold-deep ring-1 ring-line">
                    <Check size={15} strokeWidth={3} />
                  </span>
                  <p className="text-[15px] leading-relaxed text-muted-body sm:text-base">{req}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Application Form */}
      <section id="staff-application-form" className="scroll-mt-20 bg-paper py-14 sm:py-20">
        <div className="container mx-auto px-4">
          <div className="mx-auto max-w-2xl">
            <div className="mb-8 text-center">
              <span className="text-sm font-extrabold text-gold-deep">طلب التوظيف</span>
              <h2 className="mt-2 text-3xl font-black leading-tight text-ink sm:text-4xl">قدّم طلبك الآن</h2>
              <p className="mt-3 text-base leading-relaxed text-muted-body">سيتواصل معك فريقنا خلال 3–5 أيام عمل لمراجعة طلبك.</p>
              {form.jobId && (
                <p className="mt-3 inline-flex max-w-full items-center gap-1.5 rounded-full bg-primary-50 px-3 py-1 text-xs font-extrabold text-primary-700 ring-1 ring-primary-100">
                  <Briefcase size={12} className="flex-none" /> طلبك مرتبط بوظيفة: {form.specialty}
                </p>
              )}
            </div>

            {submitted ? (
              <div className="rounded-[28px] border border-green-200 bg-green-50 px-5 py-14 text-center">
                <span className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-white text-green-600 ring-1 ring-green-200">
                  <CheckCircle size={44} />
                </span>
                <h3 className="mt-5 text-2xl font-black text-ink">تم استلام طلبك بنجاح!</h3>
                <p className="mt-2 text-muted-body">شكراً لاهتمامك بالانضمام إلى فريق معهد الدراسات النفسية.</p>
                <p className="mt-1 text-muted-body">سيتواصل معك فريق الاختيار خلال 3–5 أيام عمل.</p>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-8 rounded-[28px] border border-line bg-white p-5 shadow-[0_40px_80px_-55px_rgba(26,15,18,.45)] sm:p-8">
                <div className="space-y-4">
                  <p className={stepCls}><span className={stepNum}>1</span>بياناتك</p>
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div>
                      <label className={labelCls}>الاسم الكامل *</label>
                      <input required type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="اسمك الثلاثي" className={inputCls} />
                    </div>
                    <div>
                      <label className={labelCls}>رقم الهاتف *</label>
                      <input required type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="مثال: +20 100 000 0000" className={inputCls} />
                    </div>
                  </div>

                  <div>
                    <label className={labelCls}>البريد الإلكتروني *</label>
                    <input required type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="مثال: name@example.com" className={inputCls} />
                  </div>
                </div>

                <div className="space-y-4 border-t border-line pt-7">
                  <p className={stepCls}><span className={stepNum}>2</span>الوظيفة والفرع</p>
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div>
                      <label className={labelCls}>الوظيفة المتقدَّم لها *</label>
                      <select required value={form.jobId}
                        onChange={(e) => {
                          const job = jobs.find(j => j.id === e.target.value);
                          setForm({ ...form, jobId: e.target.value, specialty: job?.title || '' });
                        }}
                        className={inputCls}>
                        <option value="">اختر الوظيفة</option>
                        {jobs.map(job => (<option key={job.id} value={job.id}>{job.title}</option>))}
                        <option value="">— مش لاقي وظيفتي، سجّلني في قاعدة المتقدمين —</option>
                      </select>
                      {!jobs.length && !jobsLoading && (
                        <p className="mt-1 text-[12px] text-muted">مفيش وظائف معلنة دلوقتي — سجّل وهنرجعلك أول ما ينزل شاغر.</p>
                      )}
                    </div>
                    <div>
                      <label className={labelCls}>الفرع المتقدَّم له *</label>
                      <select required value={form.branch} onChange={(e) => setForm({ ...form, branch: e.target.value })}
                        className={inputCls}>
                        <option value="">اختر الفرع</option>
                        <option value="daqqi">فرع الدقي</option>
                        <option value="tagamoa">فرع التجمع الخامس</option>
                        <option value="tanta_admin">الفرع الإداري — طنطا</option>
                        <option value="online_egypt">أونلاين</option>
                      </select>
                    </div>
                  </div>
                </div>

                <div className="space-y-4 border-t border-line pt-7">
                  <p className={stepCls}><span className={stepNum}>3</span>خبرتك</p>
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div>
                      <label className={labelCls}>سنوات الخبرة *</label>
                      <select required value={form.experience} onChange={(e) => setForm({ ...form, experience: e.target.value })} className={inputCls}>
                        <option value="">اختر</option>
                        <option value="none">بدون خبرة</option>
                        <option value="under_1">أقل من سنة</option>
                        <option value="1-3">من سنة إلى 3 سنوات</option>
                        <option value="3-5">3 – 5 سنوات</option>
                        <option value="5-10">5 – 10 سنوات</option>
                        <option value="10plus">أكثر من 10 سنوات</option>
                      </select>
                    </div>
                    <div>
                      <label className={labelCls}>المؤهل الدراسي *</label>
                      <input required type="text" value={form.education} onChange={(e) => setForm({ ...form, education: e.target.value })}
                        placeholder="مثال: بكالوريوس آداب — قسم علم نفس"
                        className={inputCls} />
                    </div>
                  </div>

                  <div>
                    <label className={labelCls}>اشتغلت فين قبل كده؟</label>
                    <textarea rows={2} value={form.experiencePlaces} onChange={(e) => setForm({ ...form, experiencePlaces: e.target.value })}
                      placeholder="أسماء الجهات والمدة في كل واحدة — سيبها فاضية لو دي أول وظيفة"
                      className={areaCls} />
                  </div>
                </div>

                <div className="space-y-4 border-t border-line pt-7">
                  <p className={stepCls}><span className={stepNum}>4</span>عرّفنا بنفسك</p>
                  <div>
                    <label className={labelCls}>رابط LinkedIn أو موقعك الشخصي</label>
                    <input type="url" value={form.linkedin} onChange={(e) => setForm({ ...form, linkedin: e.target.value })} placeholder="رابط LinkedIn أو موقعك الشخصي (اختياري)" className={inputCls} />
                  </div>

                  <div>
                    <label className={labelCls}>رسالتك ودوافعك للانضمام</label>
                    <textarea rows={4} value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} placeholder="أخبرنا عن نفسك ولماذا تناسبك هذه الوظيفة..." className={areaCls} />
                  </div>
                </div>

                <div className="space-y-3">
                  {submitError && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{submitError}</p>}
                  <button type="submit" disabled={submitting} className="inline-flex min-h-[56px] w-full items-center justify-center gap-2 rounded-2xl bg-ink px-7 text-lg font-black text-white transition hover:bg-black disabled:cursor-not-allowed disabled:opacity-50">
                    <Send size={20} />
                    {submitting ? 'جاري الإرسال...' : 'إرسال الطلب'}
                  </button>
                  <p className="text-center text-xs text-muted-soft">بالإرسال توافق على شروط الاستخدام وسياسة الخصوصية الخاصة بالمعهد.</p>
                </div>
              </form>
            )}
          </div>
        </div>
      </section>
    </div>
  );
};

export default JoinStaff;
