import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Send, Check, CheckCircle, Users, Award, BookOpen, Globe, Star, GraduationCap, Heart, Briefcase } from 'lucide-react';
import { useSiteData } from '../context/SiteDataContext';
import { CAIRO_TIME_ZONE } from '../../shared/cairoDate';
import { useSeo } from '../lib/useSeo';

// Split out of the old single JoinUs.tsx (which toggled instructor/consultant/
// employee copy in place with the same layout) per the owner's explicit
// request: therapists/instructors and staff must be two different PAGES with
// different benefits AND a different look, not one page with conditional
// text. This one is the teaching/consulting track — see JoinStaff.tsx for the
// employee track (a distinct design, jobs-board-first).
const JoinTeaching: React.FC = () => {
  useSeo({ title: 'انضم إلينا كمحاضر | معهد الدراسات النفسية', path: '/join', description: 'انضم إلى معهد الدراسات النفسية كمحاضر — قدّم سيرتك الذاتية وتخصصك.' });
  const { addJoinUsApplication, content, courses } = useSiteData();
  const [form, setForm] = useState({
    name: '', email: '', phone: '', specialty: '', experience: '',
    type: 'instructor' as 'instructor' | 'consultant', linkedin: '', message: '',
    branch: '', education: '', experiencePlaces: '', programsOther: '',
  });
  // «في صفحه تسجيل محاضر جديد محتاجين نزود سوال صح او غلط هل عملت محاضر من قبل ,,
  // وسوال هل عملت في جلسات نفسيه مع عملاء من قبل ؟؟ واخر تعديل هيكون في البرامج
  // محتاجين نخليه يختار اكتر من برنامج من اسماء البرامج اللى احنا بنقدمها يكونو
  // مكتوبين كلهم وجمبهم علامه صح … ويبقي تحتها مكان يضيف او يكتب لو برامج زيادة
  // بيشتغلها» (12 Oct 2026).
  //
  // The programmes are the institute's published courses — what the site itself
  // calls «الدبلومات والبرامج التدريبية» on /courses — each with a tick box.
  const [lecturedBefore, setLecturedBefore] = useState<boolean | null>(null);
  const [sessionsBefore, setSessionsBefore] = useState<boolean | null>(null);
  const [programs, setPrograms] = useState<string[]>([]);
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [answersError, setAnswersError] = useState(false);

  const offered = courses.filter(course => course.id && course.title);
  const toggleProgram = (id: string) => setPrograms(current => (current.includes(id)
    ? current.filter(p => p !== id) : [...current, id]));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    if (lecturedBefore === null || sessionsBefore === null) {
      setAnswersError(true);
      document.getElementById('join-experience-questions')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
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
        experienceYears: form.experience || undefined,
        type: form.type,
        form: 'teaching',
        lecturedBefore,
        sessionsBefore,
        programs,
        programsOther: form.programsOther.trim() || undefined,
        linkedin: form.linkedin || undefined,
        branch: form.branch || undefined,
        education: form.education || undefined,
        experiencePlaces: form.experiencePlaces || undefined,
        message: form.message.trim() || undefined,
        status: 'new',
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
    { icon: Users, title: 'جمهور واسع', desc: 'وصل لأكثر من 12,000 متخصص نفسي مسجل في المنصة من جميع أنحاء الوطن العربي.' },
    { icon: Award, title: 'هوية مهنية معتمدة', desc: 'احصل على شارة "خبير معتمد" وملف احترافي يُبرز خبرتك ويزيد من مصداقيتك.' },
    { icon: BookOpen, title: 'أثر تعليمي حقيقي', desc: 'ساهم في بناء جيل جديد من المعالجين النفسيين المحترفين بمحتوى علمي وعملي راقٍ.' },
    { icon: Globe, title: 'انتشار عربي', desc: 'محاضراتك تصل لطلاب من مصر، السعودية، الإمارات، والكويت وأكثر من 15 دولة عربية.' },
    { icon: Star, title: 'دعم متكامل', desc: 'فريق المعهد يدعمك بالتصوير، الإنتاج، التسويق، وضمان جودة المحتوى بالكامل.' },
    { icon: Heart, title: 'مجتمع راقٍ', desc: 'انضم لشبكة من أفضل الأطباء والمعالجين النفسيين وتبادل الخبرات والمعرفة.' },
  ];

  const requirements = [
    'شهادة أكاديمية معتمدة في علم النفس، الطب النفسي، أو مجال ذي صلة.',
    'خبرة عملية لا تقل عن 3 سنوات في التخصص المطلوب تدريسه.',
    'مهارات تواصل وتقديم ممتازة باللغة العربية.',
    'الالتزام بمعايير الأخلاقيات المهنية والسرية التامة.',
    'القدرة على إنتاج محتوى تعليمي هادف ومنظم.',
  ];

  const inputCls = 'min-h-[50px] w-full rounded-xl border border-line-strong bg-paper px-4 text-[15px] text-ink outline-none transition placeholder:text-muted-faint focus:border-primary-600 focus:bg-white focus:ring-4 focus:ring-primary-600/10';
  const areaCls = `${inputCls} resize-none py-3`;
  const labelCls = 'mb-1 block text-[13px] font-bold text-muted-strong';
  const stepCls = 'flex items-center gap-2.5 text-lg font-black text-ink';
  const stepNum = 'flex h-8 w-8 flex-none items-center justify-center rounded-full bg-primary-50 text-sm font-black text-primary-700';

  return (
    <div className="min-h-screen bg-white">
      {/* Hero — the teaching track: burgundy, academic */}
      <section className="relative overflow-hidden bg-gradient-to-br from-primary-700 via-primary-800 to-[#4c0519] text-white">
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 opacity-[.10]" style={{ backgroundImage: 'radial-gradient(rgba(255,255,255,.7) 1px, transparent 1px)', backgroundSize: '22px 22px' }} />
        <div className="container relative mx-auto px-4 py-14 text-center sm:py-20">
          <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-1.5 text-sm font-extrabold text-gold-pale ring-1 ring-white/20">
            <GraduationCap size={17} />
            فرصة انضمام للنخبة
          </span>
          <h1 className="mt-5 text-balance text-3xl font-black leading-tight sm:text-5xl">انضم إلينا كمحاضر<br />أو مستشار نفسي</h1>
          <p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-white/75 sm:text-lg">
            هل أنت خبير في مجال الصحة النفسية؟ شارك علمك مع الآلاف وكن جزءاً من مسيرة التغيير الحقيقي في مجال الصحة النفسية العربية.
          </p>
          <div className="mx-auto mt-8 grid max-w-lg grid-cols-3 divide-x divide-white/15 rounded-[24px] bg-white/[.07] py-4 ring-1 ring-white/15 rtl:divide-x-reverse">
            {[
              { value: content['joinus.stats.students'] || '12K+', label: 'طالب نشط' },
              { value: content['joinus.stats.countries'] || '15+', label: 'دولة عربية' },
              { value: content['joinus.stats.programs'] || '50+', label: 'برنامج معتمد' },
            ].map((stat) => (
              <div key={stat.label} className="px-2 text-center">
                <p className="text-2xl font-black tabular-nums text-gold-light sm:text-3xl">{stat.value}</p>
                <p className="mt-0.5 text-xs text-white/65 sm:text-sm">{stat.label}</p>
              </div>
            ))}
          </div>
          <div className="mt-6 flex flex-col items-center justify-center gap-2 sm:flex-row sm:gap-4">
            <a href="#join-teaching-form" className="inline-flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl bg-gold-light px-7 font-black text-ink transition hover:brightness-105 sm:w-auto">
              {content['joinus.form.title'] || 'قدّم طلبك الآن'}
              <ArrowLeft size={18} />
            </a>
            <Link to="/join-us" className="inline-flex min-h-[44px] items-center gap-2 text-sm font-bold text-white/70 underline underline-offset-4 transition hover:text-white">
              <Briefcase size={14} /> تبحث عن وظيفة إدارية بدلاً من ذلك؟
            </Link>
          </div>
        </div>
      </section>

      {/* Benefits */}
      <section className="bg-white py-14 sm:py-20">
        <div className="container mx-auto px-4">
          <div className="mx-auto mb-10 max-w-2xl text-center sm:mb-12">
            <span className="text-sm font-extrabold text-gold-deep">لماذا معهد الدراسات النفسية؟</span>
            <h2 className="mt-2 text-3xl font-black leading-tight text-ink sm:text-4xl">{content['joinus.benefits.title'] || 'مزايا الانضمام لفريقنا التعليمي'}</h2>
            <p className="mt-3 text-base leading-relaxed text-muted-body sm:text-lg">{content['joinus.benefits.subtitle'] || 'نؤمن بأن الخبير الجيد يستحق بيئة تُبرز موهبته وتوصل علمه لأوسع شريحة.'}</p>
          </div>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {benefits.map((b, i) => {
              const Icon = b.icon;
              return (
                <div key={i} className="rounded-[24px] border border-line bg-white p-5 transition hover:-translate-y-1 hover:shadow-[0_30px_50px_-25px_rgba(26,15,18,.35)] sm:p-6">
                  <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary-50 text-primary-700">
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
      <section className="bg-paper py-14 sm:py-20">
        <div className="container mx-auto px-4">
          <div className="mx-auto max-w-3xl">
            <h2 className="text-center text-3xl font-black leading-tight text-ink sm:text-4xl">شروط ومتطلبات الانضمام</h2>
            <div className="mt-8 divide-y divide-line rounded-[28px] border border-line bg-white px-5 sm:px-8">
              {requirements.map((req, i) => (
                <div key={i} className="flex items-start gap-3.5 py-4">
                  <span className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-primary-50 text-primary-700">
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
      <section id="join-teaching-form" className="scroll-mt-20 bg-white py-14 sm:py-20">
        <div className="container mx-auto px-4">
          <div className="mx-auto max-w-2xl">
            <div className="mb-8 text-center">
              <span className="text-sm font-extrabold text-gold-deep">طلب الانضمام</span>
              <h2 className="mt-2 text-3xl font-black leading-tight text-ink sm:text-4xl">{content['joinus.form.title'] || 'قدّم طلبك الآن'}</h2>
              <p className="mt-3 text-base leading-relaxed text-muted-body">{content['joinus.form.subtitle'] || 'سيتواصل معك فريقنا خلال 3–5 أيام عمل لمراجعة طلبك.'}</p>
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
                <div>
                  <label className="mb-3 block text-[13px] font-bold text-muted-strong">أريد الانضمام كـ *</label>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {[
                      { value: 'instructor' as const, label: '👨‍🏫 محاضر / مدرب', desc: 'تدريس دبلومات وبرامج تعليمية' },
                      { value: 'consultant' as const, label: '🩺 مستشار نفسي', desc: 'تقديم جلسات استشارية للعملاء' },
                    ].map((t) => (
                      <label
                        key={t.value}
                        className={`cursor-pointer rounded-2xl border-[1.5px] p-4 transition has-[:focus-visible]:ring-4 has-[:focus-visible]:ring-primary-600/15 ${form.type === t.value ? 'border-primary-700 bg-primary-50' : 'border-line bg-paper hover:border-line-deep'}`}
                      >
                        <input type="radio" name="type" value={t.value} checked={form.type === t.value} onChange={(e) => setForm({ ...form, type: e.target.value as 'instructor' | 'consultant' })} className="sr-only" />
                        <p className="font-black text-ink">{t.label}</p>
                        <p className="mt-1 text-xs text-muted">{t.desc}</p>
                      </label>
                    ))}
                  </div>
                </div>

                <div className="space-y-4 border-t border-line pt-7">
                  <p className={stepCls}><span className={stepNum}>1</span>بياناتك</p>
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div>
                      <label className={labelCls}>الاسم الكامل *</label>
                      <input required type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="د. أحمد محمد" className={inputCls} />
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
                  <p className={stepCls}><span className={stepNum}>2</span>خبرتك</p>
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div>
                      <label className={labelCls}>التخصص الرئيسي *</label>
                      <input required type="text" value={form.specialty} onChange={(e) => setForm({ ...form, specialty: e.target.value })} placeholder="العلاج المعرفي السلوكي" className={inputCls} />
                    </div>
                    <div>
                      <label className={labelCls}>سنوات الخبرة *</label>
                      <select required value={form.experience} onChange={(e) => setForm({ ...form, experience: e.target.value })} className={inputCls}>
                        <option value="">اختر</option>
                        <option value="3-5">3 – 5 سنوات</option>
                        <option value="5-10">5 – 10 سنوات</option>
                        <option value="10plus">أكثر من 10 سنوات</option>
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div>
                      <label className={labelCls}>المؤهل العلمي *</label>
                      <input required type="text" value={form.education} onChange={(e) => setForm({ ...form, education: e.target.value })} placeholder="مثال: ماجستير علم نفس إكلينيكي — جامعة القاهرة" className={inputCls} />
                    </div>
                    <div>
                      <label className={labelCls}>الفرع اللي تفضّل تحاضر فيه *</label>
                      <select required value={form.branch} onChange={(e) => setForm({ ...form, branch: e.target.value })} className={inputCls}>
                        <option value="">اختر الفرع</option>
                        <option value="daqqi">فرع الدقي</option>
                        <option value="tagamoa">فرع التجمع الخامس</option>
                        <option value="tanta_admin">الفرع الإداري — طنطا</option>
                        <option value="online_egypt">أونلاين — تصوير عن بُعد</option>
                      </select>
                    </div>
                  </div>

                  {/* Two required yes/no questions. */}
                  <div id="join-experience-questions" className={`space-y-5 rounded-[20px] border p-4 sm:p-5 ${answersError && (lecturedBefore === null || sessionsBefore === null) ? 'border-red-300 bg-red-50/60' : 'border-line bg-paper'}`}>
                    {([
                      { label: 'هل اشتغلت محاضر قبل كده؟ *', value: lecturedBefore, set: setLecturedBefore, name: 'lecturedBefore' },
                      { label: 'هل اشتغلت في جلسات نفسية مع عملاء قبل كده؟ *', value: sessionsBefore, set: setSessionsBefore, name: 'sessionsBefore' },
                    ]).map(question => (
                      <fieldset key={question.name}>
                        <legend className="mb-2 block text-[14px] font-extrabold text-ink">{question.label}</legend>
                        <div className="grid max-w-xs grid-cols-2 gap-2">
                          {([[true, 'آه'], [false, 'لأ']] as const).map(([answer, text]) => (
                            <label key={text}
                              className={`flex min-h-[46px] cursor-pointer items-center justify-center gap-2 rounded-xl border-[1.5px] text-sm font-extrabold transition has-[:focus-visible]:ring-4 has-[:focus-visible]:ring-primary-600/15 ${
                                question.value === answer ? 'border-primary-700 bg-primary-50 text-primary-700' : 'border-line bg-white text-muted-strong hover:border-line-deep'}`}>
                              <input type="radio" name={question.name} checked={question.value === answer}
                                onChange={() => { question.set(answer); setAnswersError(false); }} className="sr-only" />
                              {question.value === answer && <CheckCircle size={16} />} {text}
                            </label>
                          ))}
                        </div>
                      </fieldset>
                    ))}
                    {answersError && (lecturedBefore === null || sessionsBefore === null) && (
                      <p role="alert" className="text-xs font-bold text-red-600">جاوب على السؤالين دول الأول.</p>
                    )}
                  </div>

                  <div>
                    <label className={labelCls}>اشتغلت أو درّست فين قبل كده؟</label>
                    <textarea rows={2} value={form.experiencePlaces} onChange={(e) => setForm({ ...form, experiencePlaces: e.target.value })} placeholder="أسماء الجهات والمدة في كل واحدة — عيادات، جامعات، مراكز تدريب" className={areaCls} />
                  </div>
                </div>

                {/* The institute's programmes, each with a tick box; more than one is fine. */}
                <fieldset className="border-t border-line pt-7">
                  <legend className="sr-only">البرامج اللي تقدر تقدّمها معانا</legend>
                  <p className={stepCls} aria-hidden="true"><span className={stepNum}>3</span>البرامج اللي تقدر تقدّمها معانا</p>
                  <p className="mb-3 mt-1.5 text-[13px] text-muted">علّم على كل البرامج اللي تقدر تشتغل فيها — تقدر تختار أكتر من برنامج.</p>
                  {offered.length > 0 ? (
                    <div className="grid max-h-80 grid-cols-1 gap-1.5 overflow-y-auto rounded-[20px] border border-line bg-paper p-2 sm:grid-cols-2">
                      {offered.map(course => {
                        const on = programs.includes(course.id);
                        return (
                          <label key={course.id}
                            className={`flex min-h-[44px] cursor-pointer items-start gap-2.5 rounded-xl px-3 py-2.5 text-sm transition ${on ? 'bg-white font-bold text-primary-800 ring-1 ring-primary-200' : 'text-muted-strong hover:bg-white'}`}>
                            <input type="checkbox" checked={on} onChange={() => toggleProgram(course.id)}
                              className="mt-0.5 h-4 w-4 shrink-0 accent-primary-700" />
                            <span className="min-w-0 leading-snug">{course.title}</span>
                          </label>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="rounded-xl border border-dashed border-line-deep px-4 py-3 text-xs text-muted-soft">جاري تحميل البرامج… لو مظهرتش، اكتب البرامج في الخانة اللي تحت.</p>
                  )}
                  {programs.length > 0 && <p className="mt-2 text-xs font-extrabold text-primary-700">اخترت {programs.length} برنامج</p>}
                  <label className={`${labelCls} mt-4`} htmlFor="join-programs-other">برامج تانية بتقدّمها</label>
                  <textarea id="join-programs-other" rows={2} maxLength={1000} value={form.programsOther} onChange={(e) => setForm({ ...form, programsOther: e.target.value })} placeholder="لو بتقدّم برامج مش في القايمة اكتبها هنا — مثال: تعديل السلوك للأطفال، الإرشاد الأسري" className={areaCls} />
                </fieldset>

                <div className="space-y-4 border-t border-line pt-7">
                  <p className={stepCls}><span className={stepNum}>4</span>عرّفنا بنفسك</p>
                  <div>
                    <label className={labelCls}>رابط LinkedIn أو موقعك الشخصي</label>
                    <input type="url" value={form.linkedin} onChange={(e) => setForm({ ...form, linkedin: e.target.value })} placeholder="رابط LinkedIn أو موقعك الشخصي (اختياري)" className={inputCls} />
                  </div>

                  <div>
                    <label className={labelCls}>رسالتك ودوافعك للانضمام</label>
                    <textarea rows={4} value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} placeholder="أخبرنا عن نفسك وماذا تريد أن تقدم للطلاب..." className={areaCls} />
                  </div>
                </div>

                <div className="space-y-3">
                  {submitError && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{submitError}</p>}
                  <button type="submit" disabled={submitting} className="inline-flex min-h-[56px] w-full items-center justify-center gap-2 rounded-2xl bg-primary-700 px-7 text-lg font-black text-white transition hover:bg-primary-800 disabled:cursor-not-allowed disabled:opacity-50">
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

export default JoinTeaching;
