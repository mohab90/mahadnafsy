import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  CheckCircle, Award, ArrowRight, PlayCircle, Briefcase, TrendingUp,
  Send, Star, Clock, Shield, X, Play,
} from 'lucide-react';
import { BranchType } from '../types';
import { useSiteData } from '../context/SiteDataContext';
import CourseCertificate from '../components/CourseCertificate';
import { cdnImg } from '../lib/img';

// Strip HTML tags + Word-style markup and return clean Arabic text
function stripHtml(raw: string): string {
  return raw
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

// Convert a YouTube watch URL or embed URL to embed format
function toEmbedUrl(url: string): string {
  if (!url) return '';
  const m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  if (m) return `https://www.youtube.com/embed/${m[1]}`;
  return url; // assume already embed
}

const BundleDetails: React.FC = () => {
  const { bundles, addPublicLead, content: globalContent, currency, testimonials } = useSiteData();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [bundleLeadName, setBundleLeadName] = useState('');
  const [bundleLeadPhone, setBundleLeadPhone] = useState('');
  const [bundleLeadBranch, setBundleLeadBranch] = useState('');
  const [bundleLeadNotice, setBundleLeadNotice] = useState('');

  const [certModalOpen, setCertModalOpen] = useState(false);
  const [videoModalOpen, setVideoModalOpen] = useState(false);

  // Match by id OR slug
  const bundle = bundles.find(b => b.id === id || b.slug === id);
  useEffect(() => { document.title = (bundle?.title ? `${bundle.title} — مسار` : 'المسارات والباقات') + ' | معهد الدراسات النفسية'; }, [bundle?.title]);
  if (!bundle) return <div className="text-center py-20 text-gray-500">{globalContent['bundleDetails.notFound'] || 'المسار غير موجود'}</div>;

  const content = { ...globalContent, ...(bundle.detailsContent || {}) };
  const currentPrice = bundle.price?.[currency] ?? 0;
  const oldPrice = bundle.originalPrice?.[currency] ?? 0;
  const currencySymbol = currency === 'EGP' ? 'ج.م' : currency === 'SAR' ? 'ر.س' : '$';
  const savePct = oldPrice > currentPrice ? ((oldPrice - currentPrice) / oldPrice * 100).toFixed(0) : '0';
  const embedUrl = bundle.videoUrl ? toEmbedUrl(bundle.videoUrl) : '';

  const handleBundleLeadSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!bundleLeadName.trim() || !bundleLeadPhone.trim()) {
      setBundleLeadNotice('يرجى إدخال الاسم ورقم الهاتف.');
      return;
    }
    const generatedEmail = `${bundleLeadPhone.replace(/\D/g, '') || Date.now()}@lead.local`;
    const payload = {
      id: `l-${Date.now()}`,
      name: bundleLeadName.trim(),
      email: generatedEmail,
      phone: bundleLeadPhone.trim(),
      branch: bundleLeadBranch as BranchType,
      source: `طلب مسار - ${bundle.title}`,
      status: 'new' as const,
      leadType: 'course' as const,
      createdAt: new Date().toISOString().slice(0, 16).replace('T', ' '),
    };
    try {
      await addPublicLead(payload);
      setBundleLeadName('');
      setBundleLeadPhone('');
      setBundleLeadBranch('');
      setBundleLeadNotice('تم تسجيل بياناتك وسيتم التواصل معك خلال 48 ساعة من خدمة العملاء.');
    } catch {
      setBundleLeadNotice('تعذر تسجيل بياناتك حاليًا. حاول مرة أخرى أو تواصل معنا على واتساب.');
    }
  };

  let galleryImgs: string[] = [];
  try { galleryImgs = JSON.parse(content['institute.gallery.images'] || '[]'); } catch {}

  return (
    <div className="bg-gray-50 min-h-screen" dir="rtl">

      {/* ──────────────── HERO ──────────────── */}
      <div className="bg-gradient-to-br from-gray-950 via-primary-950 to-gray-900 text-white relative overflow-hidden">
        <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] opacity-[0.04]"></div>
        <div className="absolute top-0 left-0 w-[500px] h-[500px] bg-primary-700 rounded-full blur-[160px] opacity-20 pointer-events-none"></div>
        <div className="absolute bottom-0 right-0 w-80 h-80 bg-secondary-600 rounded-full blur-[120px] opacity-15 pointer-events-none"></div>

        <div className="container mx-auto max-w-6xl px-4 pt-16 pb-20 relative z-10">
          <div className="flex flex-col lg:flex-row items-start gap-12">

            {/* Left: text */}
            <div className="flex-1 min-w-0">
              <span className="inline-block bg-secondary-500/90 text-white text-xs font-bold px-4 py-1.5 rounded-full mb-5 tracking-wide">
                {content['bundleDetails.hero.badge'] || 'مسار تعليمي متكامل'}
              </span>
              <h1 className="text-4xl md:text-5xl font-extrabold mb-3 leading-tight">
                {bundle.title}
              </h1>
              {bundle.titleEn && (
                <p className="text-primary-300 text-lg font-semibold mb-4 tracking-wide">{bundle.titleEn}</p>
              )}
              {(bundle.shortDescription || bundle.description) && (
                <p className="text-gray-300 text-lg leading-relaxed max-w-xl mb-8">
                  {bundle.shortDescription || bundle.description}
                </p>
              )}

              {/* Quick stats */}
              <div className="flex flex-wrap gap-4 mb-8">
                <div className="flex items-center gap-2 bg-white/10 border border-white/10 rounded-xl px-4 py-2.5 text-sm">
                  <PlayCircle size={16} className="text-primary-300" />
                  <span>{bundle.courses.length} {content['bundleDetails.hero.courseCount'] || 'دبلوم'}</span>
                </div>
                <div className="flex items-center gap-2 bg-white/10 border border-white/10 rounded-xl px-4 py-2.5 text-sm">
                  <Award size={16} className="text-amber-400" />
                  <span>{content['bundleDetails.hero.certBadge'] || 'شهادة مجمعة معتمدة'}</span>
                </div>
                <div className="flex items-center gap-2 bg-white/10 border border-white/10 rounded-xl px-4 py-2.5 text-sm">
                  <Shield size={16} className="text-green-400" />
                  <span>{content['bundleDetails.hero.support'] || 'إشراف مهني شامل'}</span>
                </div>
              </div>

              <div className="flex flex-wrap gap-3">
                <button
                  onClick={() => navigate(`/checkout?type=bundle&id=${bundle.id}`)}
                  className="bg-primary-500 hover:bg-primary-400 text-white font-bold px-8 py-3.5 rounded-xl shadow-xl shadow-primary-900/40 transition text-base"
                >
                  {content['bundleDetails.hero.ctaPay'] || 'احجز مكانك الآن'}
                </button>
                <a
                  href={`/enroll?bundle=${bundle.id}`}
                  className="border-2 border-white/60 hover:border-white text-white font-bold px-6 py-3.5 rounded-xl transition text-sm flex items-center gap-2"
                >
                  💳 ادفع أونلاين مباشرة
                </a>
                <button
                  onClick={() => document.getElementById('register-form')?.scrollIntoView({ behavior: 'smooth' })}
                  className="border-2 border-white/30 hover:border-white/60 text-white font-bold px-8 py-3.5 rounded-xl transition text-base"
                >
                  {content['bundleDetails.hero.ctaLead'] || 'أرسل بياناتك للتواصل'}
                </button>
              </div>
            </div>

            {/* Right: video player */}
            {embedUrl && (
              <div className="w-full lg:w-[480px] shrink-0">
                <div className="rounded-2xl overflow-hidden shadow-2xl border border-white/10 relative aspect-video bg-black">
                  {videoModalOpen ? (
                    <iframe
                      src={`${embedUrl}?autoplay=1&rel=0`}
                      title="bundle video"
                      allow="autoplay; encrypted-media"
                      allowFullScreen
                      className="absolute inset-0 w-full h-full"
                    />
                  ) : (
                    <div
                      className="absolute inset-0 flex items-center justify-center cursor-pointer group"
                      onClick={() => setVideoModalOpen(true)}
                    >
                      <img
                        src={`https://img.youtube.com/vi/${embedUrl.split('/embed/')[1]?.split('?')[0]}/hqdefault.jpg`}
                        alt="video thumbnail"
                        className="absolute inset-0 w-full h-full object-cover opacity-70"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                      />
                      <div className="relative z-10 w-20 h-20 bg-primary-600 group-hover:bg-primary-500 rounded-full flex items-center justify-center shadow-2xl transition">
                        <Play size={32} className="text-white ml-1" fill="white" />
                      </div>
                    </div>
                  )}
                </div>
                <p className="text-center text-primary-300 text-sm mt-3 font-medium">
                  {content['bundleDetails.video.label'] || 'شاهد نبذة عن هذا المسار التدريبي'}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ──────────────── MAIN CONTENT + SIDEBAR ──────────────── */}
      <div className="container mx-auto max-w-6xl px-4 py-10">
        <div className="flex flex-col lg:flex-row gap-8 items-start">

          {/* ── MAIN COLUMN ── */}
          <div className="flex-1 min-w-0 space-y-10">



            {/* ── BUNDLE DESCRIPTION ── */}
            <section className="bg-white rounded-2xl border border-gray-100 shadow-sm p-7">
              {content['bundleDetails.about.headline'] && (
                <h2 className="text-2xl font-bold text-gray-900 mb-4 border-r-4 border-primary-500 pr-4">{content['bundleDetails.about.headline']}</h2>
              )}
              <p className="text-gray-700 leading-relaxed whitespace-pre-line">
                {content['bundleDetails.about.text'] || bundle.description}
              </p>
            </section>

            {/* ── COURSE PATH MAP ── */}
            <section className="bg-white rounded-2xl border border-gray-100 shadow-sm p-7">
              <h2 className="text-2xl font-bold mb-8 text-gray-900 border-r-4 border-primary-500 pr-4">
                {content['bundleDetails.path.title'] || 'خريطة المسار التعليمي'}
              </h2>
              <div className="relative border-r-4 border-gray-100 pr-8 space-y-8">
                {bundle.courses.map((course, idx) => {
                  const cleanDesc = stripHtml(course.shortDescription || '');
                  return (
                    <div key={course.id} className="relative">
                      {/* Timeline dot */}
                      <div className="absolute -right-[44px] top-2 w-6 h-6 rounded-full bg-primary-600 border-4 border-white shadow ring-2 ring-primary-200"></div>
                      <div className="bg-gray-50 hover:bg-primary-50/40 border border-gray-200 hover:border-primary-300 rounded-2xl p-5 transition group">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <span className="text-xs font-bold text-primary-500 mb-1 block">
                              {content['bundleDetails.path.stationPrefix'] || 'المحطة'} {idx + 1}
                            </span>
                            <h3 className="text-lg font-bold text-gray-900 group-hover:text-primary-700 transition">{course.title}</h3>
                            <div className="flex items-center gap-3 mt-2 text-xs text-gray-500">
                              <span className="flex items-center gap-1"><Clock size={12}/> {course.duration}</span>
                              <span className="bg-white border border-gray-200 px-2 py-0.5 rounded-full">{course.level}</span>
                            </div>
                            {cleanDesc && (
                              <p className="text-sm text-gray-600 leading-relaxed mt-3">{cleanDesc}</p>
                            )}
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              onClick={() => navigate(`/c/${course.slug || course.id}`)}
                              className="bg-primary-600 hover:bg-primary-700 text-white text-xs font-bold px-3 py-1.5 rounded-lg transition"
                            >
                              افتح »
                            </button>
                          </div>
                        </div>
                      </div>

                      {idx < bundle.courses.length - 1 && (
                        <div className="flex justify-center my-2 text-gray-300">
                          <ArrowRight size={20} className="rotate-90"/>
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* Completion station */}
                <div className="relative">
                  <div className="absolute -right-[44px] top-2 w-6 h-6 rounded-full bg-green-500 border-4 border-white shadow ring-2 ring-green-200"></div>
                  <div className="bg-gradient-to-l from-green-50 to-emerald-50 border border-green-200 rounded-2xl p-6">
                    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                      <div>
                        <h3 className="text-xl font-bold text-green-900 flex items-center gap-2 mb-2">
                          <Award className="text-green-600" size={22}/>
                          {content['bundleDetails.path.finalTitle'] || 'إتمام المسار والاعتماد'}
                        </h3>
                        <p className="text-green-800/70 text-sm leading-relaxed max-w-lg">
                          {content['bundleDetails.path.finalDesc'] || 'بعد إجتياز جميع الدبلومات والاختبارات، تحصل على شهادة المسار المجمعة وتصبح مؤهلاً للعمل في مجالك.'}
                        </p>
                      </div>
                      <button
                        onClick={() => setCertModalOpen(true)}
                        className="shrink-0 flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white font-bold px-5 py-3 rounded-xl shadow transition text-sm"
                      >
                        <Award size={16}/>
                        {content['bundleDetails.cert.previewBtn'] || 'معاينة الشهادة'}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            {/* ── WHY THIS PATH ── */}
            <section className="grid sm:grid-cols-2 gap-5">
              <div className="bg-blue-50 border border-blue-100 p-6 rounded-2xl shadow-sm">
                <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center text-blue-600 mb-4">
                  <Briefcase size={24}/>
                </div>
                <h3 className="text-lg font-bold text-gray-900 mb-3">{content['bundleDetails.why.jobsTitle'] || 'فرص العمل'}</h3>
                <ul className="text-sm text-gray-700 space-y-2">
                  {[
                    content['bundleDetails.why.jobs1'] || 'العمل في العيادات والمراكز النفسية.',
                    content['bundleDetails.why.jobs2'] || 'العمل الحر كمستقل وخبير أونلاين.',
                    content['bundleDetails.why.jobs3'] || 'العمل في المدارس والمؤسسات التعليمية.',
                  ].map((item, i) => (
                    <li key={i} className="flex items-start gap-2"><CheckCircle size={14} className="text-blue-500 mt-0.5 shrink-0"/>{item}</li>
                  ))}
                </ul>
              </div>
              <div className="bg-purple-50 border border-purple-100 p-6 rounded-2xl shadow-sm">
                <div className="w-12 h-12 bg-purple-100 rounded-xl flex items-center justify-center text-purple-600 mb-4">
                  <TrendingUp size={24}/>
                </div>
                <h3 className="text-lg font-bold text-gray-900 mb-3">{content['bundleDetails.why.skillsTitle'] || 'المهارات المكتسبة'}</h3>
                <ul className="text-sm text-gray-700 space-y-2">
                  {[
                    content['bundleDetails.why.skills1'] || 'التشخيص وصياغة الحالة بدقة.',
                    content['bundleDetails.why.skills2'] || 'تطبيق خطط العلاج النفسي الحديثة.',
                    content['bundleDetails.why.skills3'] || 'مهارات المقابلة العيادية وإدارة الجلسة.',
                  ].map((item, i) => (
                    <li key={i} className="flex items-start gap-2"><CheckCircle size={14} className="text-purple-500 mt-0.5 shrink-0"/>{item}</li>
                  ))}
                </ul>
              </div>
            </section>

            {/* ── PRE-GALLERY MOTIVATIONAL ── */}
            {content['bundleDetails.gallery.motivational'] && (
              <section className="bg-gradient-to-l from-primary-50 to-blue-50 border border-primary-100 rounded-2xl p-7 text-center">
                <p className="text-xl font-bold text-primary-800 leading-relaxed whitespace-pre-line">
                  {content['bundleDetails.gallery.motivational']}
                </p>
              </section>
            )}

            {/* ── GRADUATE GALLERY ── */}
            {galleryImgs.length > 0 && (
              <section className="bg-white rounded-2xl border border-gray-100 shadow-sm p-7">
                <h2 className="text-2xl font-bold mb-6 text-gray-900 border-r-4 border-primary-500 pr-4">
                  {content['bundleDetails.graduates.title'] || 'معرض صور الخريجين'}
                </h2>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {galleryImgs.slice(0, 8).map((img, i) => (
                    <div key={i} className="rounded-xl overflow-hidden aspect-square">
                      <img loading="lazy" decoding="async" src={img} alt="خريج" className="w-full h-full object-cover hover:scale-105 transition duration-500"/>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* ── TESTIMONIALS ── */}
            {testimonials.length > 0 && (
              <section className="bg-white rounded-2xl border border-gray-100 shadow-sm p-7">
                <h2 className="text-2xl font-bold mb-6 text-gray-900 border-r-4 border-primary-500 pr-4">
                  {content['bundleDetails.testimonials.title'] || 'آراء الطلاب والخريجين'}
                </h2>
                <div className="grid sm:grid-cols-2 gap-4">
                  {testimonials.slice(0, 4).map((t) => (
                    <div key={t.id} className="bg-gray-50 rounded-2xl p-5 border border-gray-100">
                      <div className="flex gap-1 mb-3">
                        {[1,2,3,4,5].map(s => <Star key={s} size={14} className="text-amber-400 fill-amber-400"/>)}
                      </div>
                      <p className="text-gray-700 text-sm leading-relaxed mb-4">"{t.text}"</p>
                      <div className="flex items-center gap-3">
                        {t.image ? (
                          <img loading="lazy" decoding="async" src={cdnImg(t.image, 120)} alt={t.name} className="w-10 h-10 rounded-full object-cover border border-gray-200"/>
                        ) : (
                          <div className="w-10 h-10 rounded-full bg-primary-100 text-primary-700 font-bold text-sm flex items-center justify-center">{t.name.charAt(0)}</div>
                        )}
                        <div>
                          <p className="font-bold text-gray-800 text-sm">{t.name}</p>
                          <p className="text-xs text-gray-500">{t.role}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* ── REGISTRATION FORM ── */}
            <section className="bg-gray-900 text-white p-8 rounded-2xl shadow-xl" id="register-form">
              <h3 className="text-2xl font-bold mb-2 text-center">{content['bundleDetails.form.title'] || 'انضم لهذا المسار التدريبي'}</h3>
              <p className="text-gray-400 text-center mb-7 text-sm">{content['bundleDetails.form.subtitle'] || 'سجل بياناتك وسيتم التواصل معك لتوضيح تفاصيل الدفع والجدول الزمني'}</p>
              <form className="max-w-lg mx-auto space-y-4" onSubmit={handleBundleLeadSubmit}>
                <div>
                  <label className="block text-sm mb-1 text-gray-300">{content['bundleDetails.form.nameLabel'] || 'الاسم الكامل'}</label>
                  <input type="text" value={bundleLeadName} onChange={(e) => setBundleLeadName(e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 focus:ring-primary-500 focus:outline-none" placeholder={content['bundleDetails.form.namePlaceholder'] || 'الاسم كما يظهر في الشهادة'}/>
                </div>
                <div>
                  <label className="block text-sm mb-1 text-gray-300">{content['bundleDetails.form.phoneLabel'] || 'رقم الهاتف'}</label>
                  <input type="tel" value={bundleLeadPhone} onChange={(e) => setBundleLeadPhone(e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 focus:ring-primary-500 focus:outline-none" placeholder={content['bundleDetails.form.phonePlaceholder'] || 'موبايل / واتساب'}/>
                </div>
                <div>
                  <label className="block text-sm mb-1 text-gray-300">{content['bundleDetails.form.branchLabel'] || 'الفرع المفضل'}</label>
                  {(() => {
                    let dynBranches: { id: string; label: string }[] = [];
                    try { dynBranches = JSON.parse(content['institute.branches'] || '[]'); } catch {}
                    return (
                      <select value={bundleLeadBranch} onChange={(e) => setBundleLeadBranch(e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 focus:ring-primary-500 focus:outline-none text-gray-300">
                        <option value="">{content['bundleDetails.form.branchPlaceholder'] || 'اختر الفرع الأقرب إليك'}</option>
                        {dynBranches.length > 0
                          ? dynBranches.map(b => <option key={b.id} value={b.id}>{b.label}</option>)
                          : (
                            <>
                              <option value="online-egypt">{content['bundleDetails.form.branchOnline'] || 'أونلاين محلي'}</option>
                              <option value="online-saudi">{content['bundleDetails.form.branchSaudi'] || 'أونلاين سعودي'}</option>
                              <option value="online-abroad">{content['bundleDetails.form.branchAbroad'] || 'أونلاين دولي'}</option>
                              <option value="tagamoa">{content['bundleDetails.form.branchCairo'] || 'فرع التجمع'}</option>
                              <option value="daqqi">{content['bundleDetails.form.branchGiza'] || 'فرع الدقي'}</option>
                              <option value="other">أخرى</option>
                            </>
                          )
                        }
                      </select>
                    );
                  })()}
                </div>
                {bundleLeadNotice && <div className="text-sm rounded-xl px-4 py-3 bg-white/10 border border-white/10 text-gray-100">{bundleLeadNotice}</div>}
                <button type="submit" className="w-full bg-primary-600 hover:bg-primary-700 text-white font-bold py-3.5 rounded-xl transition flex justify-center items-center gap-2 mt-2">
                  <Send size={18}/>
                  {content['bundleDetails.form.submit'] || 'تسجيل طلب الالتحاق'}
                </button>
              </form>
            </section>
          </div>

          {/* ── STICKY SIDEBAR ── */}
          <div className="w-full lg:w-80 shrink-0">
            <div className="bg-white border-2 border-primary-100 rounded-2xl shadow-lg p-6 sticky top-24">
              <h3 className="text-base font-bold text-gray-700 mb-4 text-center">{content['bundleDetails.sidebar.title'] || 'استثمارك في هذا المسار'}</h3>
              <div className="text-center mb-5">
                {oldPrice > currentPrice && (
                  <div className="text-gray-400 line-through text-sm mb-1">{oldPrice.toLocaleString()} {currencySymbol}</div>
                )}
                <div className="text-4xl font-extrabold text-primary-600">{currentPrice.toLocaleString()}</div>
                <div className="text-gray-500 text-base">{currencySymbol}</div>
                {Number(savePct) > 0 && (
                  <span className="bg-green-100 text-green-700 text-xs font-bold px-3 py-1 rounded-full inline-block mt-2">توفر {savePct}%</span>
                )}
              </div>

              <button
                onClick={() => navigate(`/checkout?type=bundle&id=${bundle.id}`)}
                className="w-full bg-primary-600 hover:bg-primary-700 text-white font-bold py-4 rounded-xl mb-2 transition shadow-lg shadow-primary-500/20"
              >
                {content['bundleDetails.sidebar.cta'] || 'احجز الآن'}
              </button>
              <a
                href={`/enroll?bundle=${bundle.id}`}
                className="w-full flex items-center justify-center gap-2 border-2 border-primary-500 text-primary-700 hover:bg-primary-50 font-bold py-2.5 rounded-xl mb-3 transition text-sm"
              >
                💳 ادفع أونلاين مباشرة (كاش أو قسط)
              </a>
              <button
                onClick={() => document.getElementById('register-form')?.scrollIntoView({ behavior: 'smooth' })}
                className="w-full border-2 border-primary-600 text-primary-700 hover:bg-primary-50 font-bold py-3 rounded-xl mb-5 transition"
              >
                {content['bundleDetails.sidebar.ctaLead'] || 'سجل بياناتك للتواصل'}
              </button>

              <ul className="space-y-3 text-sm text-gray-600">
                <li className="flex gap-2"><CheckCircle size={16} className="text-primary-500 shrink-0 mt-0.5"/><span>{bundle.courses.length} {content['bundleDetails.sidebar.featureCoursesSuffix'] || 'دبلومات كاملة'}</span></li>
                <li className="flex gap-2"><CheckCircle size={16} className="text-primary-500 shrink-0 mt-0.5"/><span>{content['bundleDetails.sidebar.featureCertificates'] || 'شهادات فردية + شهادة مجمعة'}</span></li>
                <li className="flex gap-2"><CheckCircle size={16} className="text-primary-500 shrink-0 mt-0.5"/><span>{content['bundleDetails.sidebar.featureSupervision'] || 'إشراف مهني لمدة 3 أشهر'}</span></li>
                <li className="flex gap-2"><CheckCircle size={16} className="text-primary-500 shrink-0 mt-0.5"/><span>{content['bundleDetails.sidebar.featureAccess'] || 'وصول لمدة سنتين للمحتوى'}</span></li>
              </ul>

              <div className="mt-5 pt-4 border-t border-gray-100">
                <p className="text-xs text-gray-400 text-center">{content['bundleDetails.sidebar.guarantee'] || 'ضمان استرداد خلال 7 أيام إذا لم تكن راضياً'}</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ──────────────── CERTIFICATE PREVIEW MODAL ──────────────── */}
      {certModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={() => setCertModalOpen(false)}>
          <div onClick={(e) => e.stopPropagation()} className="relative w-full max-w-4xl">
            <button
              onClick={() => setCertModalOpen(false)}
              className="absolute -top-3 -left-3 z-10 w-9 h-9 bg-white rounded-full shadow-xl flex items-center justify-center text-gray-600 hover:text-red-500 transition"
            >
              <X size={18}/>
            </button>
            <CourseCertificate
              studentName={content['bundleDetails.cert.sampleName'] || 'اسم الطالب'}
              studentNameEn={content['bundleDetails.cert.sampleNameEn'] || 'Student Name'}
              courseName={bundle.title}
              courseNameEn={bundle.titleEn}
              instructorName={content['bundleDetails.cert.instructorName'] || 'معهد الدراسات النفسية'}
              certNumber="SAMPLE-2025"
              issuedAt={new Date().toLocaleDateString('ar-EG-u-nu-latn')}
              onClose={() => setCertModalOpen(false)}
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default BundleDetails;
