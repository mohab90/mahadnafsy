import React, { useState, useEffect } from 'react';
import { Send, CheckCircle, Users, Award, BookOpen, Globe, Star, GraduationCap, Briefcase, Heart } from 'lucide-react';
import { useSiteData } from '../context/SiteDataContext';

const JoinUs: React.FC = () => {
  useEffect(() => { document.title = 'انضم إلينا | معهد الدراسات النفسية'; }, []);
  const { addJoinUsApplication, content } = useSiteData();
  const [form, setForm] = useState(() => {
    const t = new URLSearchParams(window.location.search).get('type');
    const initialType = ['instructor', 'consultant', 'employee'].includes(t || '') ? (t as string) : 'instructor';
    return { name: '', email: '', phone: '', specialty: '', experience: '', type: initialType, linkedin: '', message: '' };
  });
  const [submitted, setSubmitted] = useState(false);
  const isEmployee = form.type === 'employee';
  const [jobs, setJobs] = useState<any[]>([]);
  useEffect(() => {
    if (!isEmployee) return;
    fetch('/api/jobs').then(r => r.json()).then(d => setJobs(Array.isArray(d) ? d : [])).catch(() => {});
  }, [isEmployee]);
  const EMP_LABEL: Record<string, string> = { full_time: 'دوام كامل', part_time: 'دوام جزئي', contract: 'عقد', remote: 'عن بُعد', internship: 'تدريب' };
  const BRANCH_LABEL: Record<string, string> = { DAQQI: 'فرع الدقي', TAGAMOA: 'فرع التجمع', ONLINE_EGYPT: 'أونلاين محلي (مصر)', ONLINE_SAUDI: 'أونلاين سعودي', ONLINE_ABROAD: 'أونلاين دولي', OTHER: 'أخرى' };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    addJoinUsApplication({
      id: `ju-${Date.now()}`,
      name: form.name,
      email: form.email,
      phone: form.phone,
      specialty: form.specialty,
      experience: form.experience,
      type: form.type as 'instructor' | 'consultant' | 'employee',
      linkedin: form.linkedin || undefined,
      message: form.message || undefined,
      status: 'new',
      createdAt: new Date().toLocaleString('ar-EG-u-nu-latn', { hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }),
    });
    setSubmitted(true);
  };

  const benefits = isEmployee ? [
    { icon: Users, title: 'فريق محترف', desc: 'انضم لفريق عمل متعاون في بيئة احترافية داعمة للنمو والتطور المهني.', color: 'text-blue-500 bg-blue-50' },
    { icon: Award, title: 'مسار وظيفي واضح', desc: 'فرص ترقٍّ حقيقية وتقييم أداء عادل يكافئ الإنجاز والتميّز.', color: 'text-amber-500 bg-amber-50' },
    { icon: Star, title: 'حوافز ومكافآت', desc: 'رواتب تنافسية + عمولات ومكافآت مرتبطة بتحقيق الأهداف.', color: 'text-rose-500 bg-rose-50' },
    { icon: Heart, title: 'بيئة عمل داعمة', desc: 'ثقافة عمل إيجابية تهتم بتوازن الحياة وتطوير المهارات باستمرار.', color: 'text-pink-500 bg-pink-50' },
  ] : [
    { icon: Users, title: 'جمهور واسع', desc: 'وصل لأكثر من 12,000 متخصص نفسي مسجل في المنصة من جميع أنحاء الوطن العربي.', color: 'text-blue-500 bg-blue-50' },
    { icon: Award, title: 'هوية مهنية معتمدة', desc: 'احصل على شارة "خبير معتمد" وملف احترافي يُبرز خبرتك ويزيد من مصداقيتك.', color: 'text-amber-500 bg-amber-50' },
    { icon: BookOpen, title: 'أثر تعليمي حقيقي', desc: 'ساهم في بناء جيل جديد من المعالجين النفسيين المحترفين بمحتوى علمي وعملي راقٍ.', color: 'text-emerald-500 bg-emerald-50' },
    { icon: Globe, title: 'انتشار عربي', desc: 'محاضراتك تصل لطلاب من مصر، السعودية، الإمارات، والكويت وأكثر من 15 دولة عربية.', color: 'text-violet-500 bg-violet-50' },
    { icon: Star, title: 'دعم متكامل', desc: 'فريق المعهد يدعمك بالتصوير، الإنتاج، التسويق، وضمان جودة المحتوى بالكامل.', color: 'text-rose-500 bg-rose-50' },
    { icon: Heart, title: 'مجتمع راقٍ', desc: 'انضم لشبكة من أفضل الأطباء والمعالجين النفسيين وتبادل الخبرات والمعرفة.', color: 'text-pink-500 bg-pink-50' },
  ];

  const requirements = isEmployee ? [
    'مؤهل دراسي مناسب للوظيفة المتقدَّم لها.',
    'مهارات تواصل جيدة والقدرة على العمل ضمن فريق.',
    'الالتزام والانضباط وروح المبادرة.',
    'إجادة استخدام الحاسب والأدوات الرقمية الأساسية.',
    'الرغبة في التعلّم والتطور المهني المستمر.',
  ] : [
    'شهادة أكاديمية معتمدة في علم النفس، الطب النفسي، أو مجال ذي صلة.',
    'خبرة عملية لا تقل عن 3 سنوات في التخصص المطلوب تدريسه.',
    'مهارات تواصل وتقديم ممتازة باللغة العربية.',
    'الالتزام بمعايير الأخلاقيات المهنية والسرية التامة.',
    'القدرة على إنتاج محتوى تعليمي هادف ومنظم.',
  ];

  return (
    <div className="bg-gray-50 min-h-screen animate-fade-in">
      {/* Hero */}
      <div className="bg-gray-900 text-white py-20 relative overflow-hidden">
        <div className="absolute inset-0 bg-primary-900/20"></div>
        <div className="absolute top-0 right-0 w-80 h-80 bg-primary-600 rounded-full blur-[120px] opacity-25"></div>
        <div className="absolute bottom-0 left-0 w-80 h-80 bg-secondary-500 rounded-full blur-[120px] opacity-25"></div>
        <div className="container mx-auto px-4 relative z-10 text-center">
          <div className="inline-flex items-center gap-2 bg-primary-600/30 border border-primary-500/40 text-primary-300 px-4 py-2 rounded-full text-sm font-bold mb-6">
            {isEmployee ? <Briefcase size={18} /> : <GraduationCap size={18} />}
            {isEmployee ? 'انضم لفريق العمل' : 'فرصة انضمام للنخبة'}
          </div>
          <h1 className="text-4xl md:text-6xl font-bold mb-6">
            {isEmployee ? <>ابنِ مستقبلك المهني<br />مع فريقنا</> : <>انضم إلينا كمحاضر<br />أو مستشار نفسي</>}
          </h1>
          <p className="text-xl text-gray-300 max-w-2xl mx-auto leading-relaxed">
            {isEmployee
              ? 'نبحث دائماً عن مواهب طموحة تشاركنا الشغف. تصفّح الوظائف المتاحة وقدّم للفرصة التي تناسب خبراتك وتطلعاتك.'
              : 'هل أنت خبير في مجال الصحة النفسية؟ شارك علمك مع الآلاف وكن جزءاً من مسيرة التغيير الحقيقي في مجال الصحة النفسية العربية.'}
          </p>
          <div className="flex flex-wrap justify-center gap-6 mt-10">
            {[
              { value: content['joinus.stats.students'] || '12K+', label: 'طالب نشط' },
              { value: content['joinus.stats.countries'] || '15+', label: 'دولة عربية' },
              { value: content['joinus.stats.programs'] || '50+', label: 'برنامج معتمد' },
            ].map((stat) => (
              <div key={stat.label} className="text-center">
                <p className="text-3xl font-extrabold text-primary-400">{stat.value}</p>
                <p className="text-sm text-gray-400">{stat.label}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Benefits */}
      <section className="py-20 bg-white">
        <div className="container mx-auto px-4">
          <div className="text-center mb-14">
            <span className="bg-primary-50 text-primary-700 px-4 py-1.5 rounded-full text-sm font-bold">لماذا معهد الدراسات النفسية؟</span>
            <h2 className="text-3xl font-bold text-gray-900 mt-4 mb-3">{content['joinus.benefits.title'] || 'مزايا الانضمام لفريقنا'}</h2>
            <p className="text-gray-500 max-w-xl mx-auto">{content['joinus.benefits.subtitle'] || 'نؤمن بأن الخبير الجيد يستحق بيئة تُبرز موهبته وتوصل علمه لأوسع شريحة.'}</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {benefits.map((b, i) => {
              const Icon = b.icon;
              return (
                <div key={i} className="bg-gray-50 rounded-2xl p-6 hover:shadow-md transition border border-gray-100 hover:border-primary-200 group">
                  <div className={`w-14 h-14 rounded-2xl ${b.color} flex items-center justify-center mb-4 group-hover:scale-110 transition`}>
                    <Icon size={24} />
                  </div>
                  <h3 className="font-bold text-gray-900 text-lg mb-2">{b.title}</h3>
                  <p className="text-gray-500 text-sm leading-relaxed">{b.desc}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Requirements */}
      <section className="py-16 bg-gray-50">
        <div className="container mx-auto px-4">
          <div className="max-w-3xl mx-auto">
            <h2 className="text-2xl font-bold text-gray-900 mb-8 text-center">شروط ومتطلبات الانضمام</h2>
            <div className="bg-white rounded-3xl p-8 shadow-sm border border-gray-100 space-y-4">
              {requirements.map((req, i) => (
                <div key={i} className="flex items-start gap-4">
                  <div className="w-7 h-7 rounded-full bg-primary-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <CheckCircle size={16} className="text-primary-600" />
                  </div>
                  <p className="text-gray-700 leading-relaxed">{req}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Application Form */}
      <section className="py-20 bg-white">
        <div className="container mx-auto px-4">
          <div className="max-w-2xl mx-auto">
            <div className="text-center mb-10">
              <h2 className="text-3xl font-bold text-gray-900 mb-3">{content['joinus.form.title'] || 'قدّم طلبك الآن'}</h2>
              <p className="text-gray-500">{content['joinus.form.subtitle'] || 'سيتواصل معك فريقنا خلال 3–5 أيام عمل لمراجعة طلبك.'}</p>
            </div>

            {submitted ? (
              <div className="text-center py-16 bg-emerald-50 rounded-3xl border border-emerald-100">
                <CheckCircle size={64} className="mx-auto text-emerald-500 mb-4" />
                <h3 className="text-xl font-bold text-gray-900 mb-2">تم استلام طلبك بنجاح!</h3>
                <p className="text-gray-500 mb-2">شكراً لاهتمامك بالانضمام إلى فريق معهد الدراسات النفسية.</p>
                <p className="text-gray-500">سيتواصل معك فريق الاختيار خلال 3–5 أيام عمل.</p>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="bg-white rounded-3xl shadow-sm border border-gray-100 p-8 space-y-5">
                {/* Open positions (employee applications only) */}
                {isEmployee && (
                  <div className="bg-primary-50/60 border border-primary-100 rounded-2xl p-4">
                    <p className="text-sm font-bold text-primary-800 mb-2 flex items-center gap-1"><Briefcase size={15} /> الوظائف المتاحة حالياً</p>
                    {jobs.length === 0 ? (
                      <p className="text-xs text-gray-500">لا توجد وظائف مُعلنة حالياً — يمكنك إرسال طلبك وسنتواصل معك عند توفر شاغر مناسب.</p>
                    ) : (
                      <div className="space-y-2">
                        {jobs.map((j) => (
                          <button type="button" key={j.id} onClick={() => setForm({ ...form, specialty: j.title, message: form.message || `أتقدم لوظيفة: ${j.title}` })}
                            className={`w-full text-right border rounded-xl p-3 transition ${form.specialty === j.title ? 'border-primary-500 bg-white ring-1 ring-primary-300' : 'border-gray-200 bg-white/70 hover:border-primary-300'}`}>
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-bold text-gray-800 text-sm">{j.title}</span>
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">{EMP_LABEL[j.employment_type] || j.employment_type}</span>
                              {j.branch && <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">{BRANCH_LABEL[j.branch] || j.branch}</span>}
                              {j.department && <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary-100 text-primary-700">{j.department}</span>}
                              {(j.salary_min || j.salary_max) && <span className="text-[10px] text-gray-400">{j.salary_min || '?'}–{j.salary_max || '?'} ج.م</span>}
                            </div>
                            {j.description && <p className="text-xs text-gray-500 mt-1 line-clamp-2">{j.description}</p>}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                {/* Type Selection */}
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2">أريد الانضمام كـ *</label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {[
                      { value: 'instructor', label: '👨‍🏫 محاضر / مدرب', desc: 'تدريس دبلومات وبرامج تعليمية' },
                      { value: 'consultant', label: '🩺 مستشار نفسي', desc: 'تقديم جلسات استشارية للعملاء' },
                      { value: 'employee', label: '💼 وظيفة إدارية', desc: 'انضم لفريق العمل (مبيعات، خدمة عملاء، إلخ)' },
                    ].map((t) => (
                      <label
                        key={t.value}
                        className={`border-2 rounded-xl p-4 cursor-pointer transition ${form.type === t.value ? 'border-primary-500 bg-primary-50' : 'border-gray-200 hover:border-gray-300'}`}
                      >
                        <input type="radio" name="type" value={t.value} checked={form.type === t.value} onChange={(e) => setForm({ ...form, type: e.target.value })} className="sr-only" />
                        <p className="font-bold text-gray-900 mb-1">{t.label}</p>
                        <p className="text-xs text-gray-500">{t.desc}</p>
                      </label>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-bold text-gray-700 mb-1">الاسم الكامل *</label>
                    <input required type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="د. أحمد محمد" className="w-full border border-gray-300 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary-500 transition" />
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-gray-700 mb-1">رقم الهاتف *</label>
                    <input required type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="مثال: +20 100 000 0000" className="w-full border border-gray-300 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary-500 transition" />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-1">البريد الإلكتروني *</label>
                  <input required type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="مثال: name@example.com" className="w-full border border-gray-300 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary-500 transition" />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-bold text-gray-700 mb-1">{isEmployee ? 'الوظيفة المتقدَّم لها *' : 'التخصص الرئيسي *'}</label>
                    <input required type="text" value={form.specialty} onChange={(e) => setForm({ ...form, specialty: e.target.value })} placeholder={isEmployee ? 'مثال: أخصائي مبيعات' : 'العلاج المعرفي السلوكي'} className="w-full border border-gray-300 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary-500 transition" />
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-gray-700 mb-1">سنوات الخبرة *</label>
                    <select required value={form.experience} onChange={(e) => setForm({ ...form, experience: e.target.value })} className="w-full border border-gray-300 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary-500 transition bg-white">
                      <option value="">اختر</option>
                      <option value="3-5">3 – 5 سنوات</option>
                      <option value="5-10">5 – 10 سنوات</option>
                      <option value="10+">أكثر من 10 سنوات</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-1">رابط LinkedIn أو موقعك الشخصي</label>
                  <input type="url" value={form.linkedin} onChange={(e) => setForm({ ...form, linkedin: e.target.value })} placeholder="رابط LinkedIn أو موقعك الشخصي (اختياري)" className="w-full border border-gray-300 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary-500 transition" />
                </div>

                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-1">رسالتك ودوافعك للانضمام</label>
                  <textarea rows={4} value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} placeholder="أخبرنا عن نفسك وماذا تريد أن تقدم للطلاب..." className="w-full border border-gray-300 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary-500 transition resize-none" />
                </div>

                <button type="submit" className="w-full bg-primary-600 hover:bg-primary-700 text-white font-bold py-4 rounded-xl flex items-center justify-center gap-2 transition text-lg">
                  <Send size={20} />
                  إرسال الطلب
                </button>
                <p className="text-center text-xs text-gray-400">بالإرسال توافق على شروط الاستخدام وسياسة الخصوصية الخاصة بالمعهد.</p>
              </form>
            )}
          </div>
        </div>
      </section>
    </div>
  );
};

export default JoinUs;
