import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Check, CheckCircle, Clock, Video, Users, Star, Play, Award, ChevronRight, Quote, Send, BookOpen, GraduationCap, Phone } from 'lucide-react';
import { Currency, LeadItem } from '../types';
import { useSiteData } from '../context/SiteDataContext';
import CourseCard from '../components/CourseCard';

// Countdown timer — synced to Firestore timestamp (offer.timerStartedAt) set by admin
// Falls back to localStorage if no server timestamp is set
function use24hCountdown(serverStart?: string) {
  const STORAGE_KEY = 'offer-timer-start';

  const calc = (srv?: string) => {
    let start: number;
    if (srv) {
      start = new Date(srv).getTime();
    } else {
      const stored = localStorage.getItem(STORAGE_KEY);
      let n = stored ? Number(stored) : null;
      if (!n || Date.now() - n > 24 * 60 * 60 * 1000) {
        n = Date.now();
        localStorage.setItem(STORAGE_KEY, String(n));
      }
      start = n;
    }
    const elapsed = Date.now() - start;
    const remaining = Math.max(0, 24 * 60 * 60 * 1000 - elapsed);
    const h = Math.floor(remaining / 3600000);
    const m = Math.floor((remaining % 3600000) / 60000);
    const s = Math.floor((remaining % 60000) / 1000);
    return { h, m, s };
  };

  const [time, setTime] = useState(() => calc(serverStart));
  useEffect(() => {
    setTime(calc(serverStart));
    const id = setInterval(() => setTime(calc(serverStart)), 1000);
    return () => clearInterval(id);
  }, [serverStart]);
  return time;
}

const Home: React.FC = () => {
        const { courses, bundles, testimonials, therapists, addPublicLead, content, discounts, currency } = useSiteData();
    const [offerLeadName, setOfferLeadName] = useState('');
    const [offerLeadPhone, setOfferLeadPhone] = useState('');
    const [offerLeadBranch, setOfferLeadBranch] = useState('');
    const [offerLeadNotice, setOfferLeadNotice] = useState('');
  const [showVideoModal, setShowVideoModal] = useState(false);
  const currencySymbol = currency === 'EGP' ? 'ج.م' : currency === 'SAR' ? 'ر.س' : '$';
  const timer = use24hCountdown(content['offer.timerStartedAt'] || undefined);

  useEffect(() => { document.title = 'الرئيسية | معهد الدراسات النفسية'; }, []);

  // Gallery images — stored as JSON string in content
  const galleryImages: string[] = (() => {
    try { return JSON.parse(content['institute.gallery.images'] || '[]'); } catch { return []; }
  })();
  // Pick a random gallery image each render (stable per session via useMemo-like approach)
  const heroGalleryImg = galleryImages.length > 0 ? galleryImages[0] : '';
  // For sections needing multiple gallery images, spread or pick sequentially
  const getGalleryImg = (idx: number) => galleryImages.length > 0 ? galleryImages[idx % galleryImages.length] : '';

  const getEmbedUrl = (url: string): string => {
    if (!url) return '';
    const ytMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{11})/);
    if (ytMatch) return `https://www.youtube-nocookie.com/embed/${ytMatch[1]}?rel=0&modestbranding=1`;
    return url;
  };

  // Helper filters
    const bestSellingCourses = [...courses].sort((a, b) => b.students - a.students).slice(0, 6);
    const featuredInstructors = [...therapists]
      .filter(t => t.showOnHome)
      .sort((a, b) => (a.sortOrder ?? 99) - (b.sortOrder ?? 99))
      .slice(0, 4);

    const handleOfferLeadSubmit = (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (!offerLeadName.trim() || !offerLeadPhone.trim()) {
            setOfferLeadNotice('يرجى إدخال الاسم ورقم الهاتف.');
            return;
        }

        const generatedEmail = `${offerLeadPhone.replace(/\D/g, '') || Date.now()}@lead.local`;
        const payload = {
            id: `l-${Date.now()}`,
            name: offerLeadName.trim(),
            email: generatedEmail,
            phone: offerLeadPhone.trim(),
            source: 'عرض 24 ساعة',
            status: 'new' as const,
            leadType: 'course' as const,
            enrolledCourseId: content['offer.courseId'] || '',
            branch: offerLeadBranch as LeadItem['branch'],
            createdAt: new Date().toISOString().slice(0, 16).replace('T', ' '),
        };
        addPublicLead(payload);
        setOfferLeadName('');
        setOfferLeadPhone('');
        setOfferLeadBranch('');
        setOfferLeadNotice('تم تسجيل الطلب وسيظهر داخل العملاء المحتملين.');
    };

    return (
    <div className="animate-fade-in bg-white">
      {/* Hero Section */}
      <section className="relative bg-gradient-to-br from-gray-900 via-primary-900 to-red-900 text-white overflow-hidden min-h-[600px] flex items-center">
        <div className="absolute inset-0 opacity-10 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')]"></div>
        {/* Abstract Shapes */}
        <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-primary-600 rounded-full blur-[120px] opacity-20 animate-pulse"></div>
        <div className="absolute bottom-0 left-0 w-[400px] h-[400px] bg-secondary-500 rounded-full blur-[100px] opacity-20"></div>

        <div className="container mx-auto px-4 relative z-10 grid md:grid-cols-2 gap-12 items-center">
          <div className="text-center md:text-right space-y-8">
            <div className="inline-flex items-center gap-2 bg-white/10 backdrop-blur-sm border border-white/20 px-4 py-2 rounded-full text-sm font-medium animate-slide-up">
              <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse"></span>
              {content['home.hero.badge'] || 'مستقبلك المهني يبدأ من هنا'}
            </div>
            
            <h1 className="text-4xl md:text-6xl font-extrabold leading-tight animate-slide-up" style={{animationDelay: '0.1s'}}>
                            {content['home.heroTitle'] || 'رحلة علم ووعي تغير حياتك للأفضل'}
            </h1>
            
            <p className="text-lg text-gray-200 leading-relaxed max-w-lg mx-auto md:mx-0 animate-slide-up" style={{animationDelay: '0.2s'}}>
                            {content['home.heroSubtitle'] || 'المنصة الأكاديمية الأولى عربياً لتعليم الصحة النفسية والعلاج النفسي. دبلومات معتمدة، تدريب عملي، ونخبة من الخبراء.'}
            </p>
            
            <div className="flex flex-col sm:flex-row gap-4 justify-center md:justify-start animate-slide-up" style={{animationDelay: '0.3s'}}>
              <Link to="/courses" className="bg-secondary-500 hover:bg-secondary-600 text-white px-8 py-4 rounded-xl font-bold transition shadow-lg shadow-secondary-500/30 flex items-center justify-center gap-2 text-lg">
                {content['home.hero.primaryCta'] || 'تصفح الدبلومات'}
                <ArrowRight size={20} className="rtl:rotate-180" />
              </Link>
              <Link to="/consultations" className="bg-white/5 hover:bg-white/10 text-white border border-white/20 px-8 py-4 rounded-xl font-bold transition flex items-center justify-center gap-2 backdrop-blur-sm">
                <Video size={20} />
                {content['home.hero.secondaryCta'] || 'استشارة أونلاين'}
              </Link>
            </div>

            <div className="flex items-center justify-center md:justify-start gap-8 pt-4 text-sm text-gray-300 animate-slide-up" style={{animationDelay: '0.4s'}}>
                <div className="flex items-center gap-2">
                    <CheckCircle size={16} className="text-secondary-400" />
                    <span>{content['home.hero.feature1'] || 'اعتماد دولي ومحلي'}</span>
                </div>
                <div className="flex items-center gap-2">
                    <CheckCircle size={16} className="text-secondary-400" />
                    <span>{content['home.hero.feature2'] || 'مدربون خبراء'}</span>
                </div>
            </div>
          </div>

          {/* Hero right column: gallery image */}
          {heroGalleryImg ? (
            <div className="hidden md:flex items-center justify-center py-8">
              <div className="relative w-full max-w-md animate-float">
                {/* Outer glow ring */}
                <div className="absolute -inset-4 bg-gradient-to-br from-secondary-400/30 via-primary-500/20 to-transparent rounded-[2.5rem] blur-lg"></div>
                {/* Tilted background card */}
                <div className="absolute inset-0 bg-secondary-500/20 rounded-3xl rotate-2"></div>
                <img
                  src={heroGalleryImg}
                  alt="معهد الدراسات النفسية"
                  className="relative z-10 w-full h-[420px] object-cover rounded-3xl shadow-2xl border-4 border-white/20"
                />
                {/* Badge top-right */}
                <div className="absolute -top-4 -right-3 z-30 bg-secondary-500 text-white rounded-2xl px-3 py-2 text-xs font-bold shadow-lg flex items-center gap-1.5">
                  <Award size={13} />
                  {content['home.stats.programs'] || '50+'} برنامج
                </div>
                {/* Students badge bottom */}
                <div className="absolute -bottom-4 left-1/2 -translate-x-1/2 z-30 bg-gray-900/90 backdrop-blur text-white rounded-2xl px-4 py-2 text-xs font-bold shadow-lg flex items-center gap-2 border border-white/10">
                  <Users size={13} className="text-secondary-400" />
                  {content['home.stats.graduates'] || '12K+'} خريج
                </div>
                {galleryImages.length > 1 && (
                  <img
                    src={getGalleryImg(1)}
                    alt=""
                    className="absolute -bottom-6 -left-6 w-32 h-32 object-cover rounded-2xl shadow-xl border-4 border-white/20 z-20"
                  />
                )}
              </div>
            </div>
          ) : null}

        </div>
      </section>

      {/* Floating Stats */}
      <div className="container mx-auto px-4 relative z-20 -mt-12 mb-24">
          <div className="bg-white rounded-3xl shadow-2xl border border-gray-100 p-10 grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
              {[
                { value: content['home.stats.programs'] || '50+', label: content['home.stats.programsLabel'] || 'برنامج تدريبي', icon: <BookOpen size={28} className="text-primary-500" />, color: 'from-red-50 to-red-100' },
                { value: content['home.stats.experts'] || '30+', label: content['home.stats.expertsLabel'] || 'خبير ومدرب', icon: <Users size={28} className="text-blue-500" />, color: 'from-blue-50 to-blue-100' },
                { value: content['home.stats.graduates'] || '12K', label: content['home.stats.graduatesLabel'] || 'خريج', icon: <GraduationCap size={28} className="text-green-500" />, color: 'from-green-50 to-green-100' },
                { value: content['home.stats.rating'] || '4.9', label: 'تقييم الطلاب', icon: <Star size={28} className="text-yellow-500" fill="currentColor" />, color: 'from-yellow-50 to-yellow-100' },
              ].map((stat, i) => (
                <div key={i} className="group cursor-default">
                  <div className={`w-16 h-16 rounded-2xl bg-gradient-to-br ${stat.color} flex items-center justify-center mx-auto mb-4 group-hover:scale-110 transition duration-300 shadow-sm`}>
                    {stat.icon}
                  </div>
                  <h3 className="text-4xl font-extrabold text-gray-900 mb-1 tracking-tight">{stat.value}</h3>
                  <p className="text-gray-500 text-sm font-medium">{stat.label}</p>
                </div>
              ))}
          </div>
      </div>

      {/* SECTION: Learning Paths & Bundles (Moved Up) */}
      <section className="py-16 bg-gray-50">
        <div className="container mx-auto px-4">
           <div className="text-center mb-12">
               <span className="text-secondary-600 font-bold tracking-wider text-sm uppercase">{content['home.paths.badge'] || 'الطريق المختصر للاحتراف'}</span>
               <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mt-2 mb-4">{content['home.paths.title'] || 'المسارات التعليمية الكاملة'}</h2>
               <p className="text-gray-500 max-w-2xl mx-auto text-lg">
                   {content['home.paths.subtitle'] || 'وفر وقتك ومالك مع باقاتنا المجمعة التي تضم مجموعة من الدبلومات في تخصص معين بخصومات تصل إلى 40%'}
               </p>
           </div>
           
           <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
              {bundles.map(bundle => (
                  <div key={bundle.id} className="bg-white rounded-2xl overflow-hidden shadow-lg border border-gray-100 hover:shadow-xl hover:-translate-y-1 transition duration-300 flex flex-col h-full group">
                      <div className="relative h-48 bg-gray-900">
                          {(bundle.courses[0]?.thumbnail || bundle.thumbnail) && (
                            <img src={bundle.courses[0]?.thumbnail || bundle.thumbnail} className="w-full h-full object-cover opacity-60 group-hover:opacity-40 transition" alt={bundle.title} />
                          )}
                          <div className="absolute inset-0 bg-gradient-to-t from-gray-900 to-transparent"></div>
                          <div className="absolute bottom-4 right-4 text-white">
                              <span className="bg-secondary-500 text-xs font-bold px-2 py-1 rounded mb-2 inline-block">مسار كامل</span>
                              <h3 className="font-bold text-lg leading-tight">{bundle.title}</h3>
                          </div>
                      </div>
                      <div className="p-6 flex-grow flex flex-col">
                          <div className="space-y-3 mb-6">
                              {bundle.courses.map((c, i) => (
                                  <div key={i} className="flex items-center gap-2 text-sm text-gray-600 border-b border-gray-50 pb-2 last:border-0">
                                      <CheckCircle size={14} className="text-primary-500 flex-shrink-0" />
                                      <span className="line-clamp-1">{c.title}</span>
                                  </div>
                              ))}
                          </div>
                          <div className="mt-auto flex justify-between items-center border-t pt-4">
                              <div>
                                  <span className="text-gray-400 line-through text-xs block">{bundle.originalPrice?.[currency]} {currencySymbol}</span>
                                  <span className="text-primary-700 font-bold text-xl">{bundle.price?.[currency]} {currencySymbol}</span>
                              </div>
                              <Link to={`/bundle/${bundle.id}`} className="bg-gray-900 text-white px-4 py-2 rounded-lg text-sm font-bold hover:bg-gray-800 transition">
                                  التفاصيل
                              </Link>
                          </div>
                      </div>
                  </div>
              ))}
           </div>
           
           <div className="text-center mt-10">
              <Link to="/bundles" className="inline-flex items-center gap-2 bg-white border border-gray-300 text-gray-700 px-8 py-3 rounded-xl font-bold hover:bg-gray-50 transition">
                        {content['home.paths.viewAll'] || 'عرض جميع المسارات'} <ChevronRight size={18} className="rtl:rotate-180" />
              </Link>
           </div>
        </div>
      </section>

      {/* SECTION: Best Selling Courses */}
      <section className="py-20 bg-white">
        <div className="container mx-auto px-4">
          <div className="text-center mb-12">
            <span className="text-primary-600 font-bold tracking-wider text-sm">{content['home.bestSellers.badge'] || 'الأكثر طلباً'}</span>
            <h2 className="text-3xl font-bold text-gray-900 mt-2">{content['home.bestSellers.title'] || 'الدبلومات الأكثر مبيعاً'}</h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {bestSellingCourses.map(course => (
              <CourseCard key={course.id} course={course} currency={currency} />
            ))}
          </div>

          <div className="text-center mt-10">
            <Link to="/courses" className="inline-flex items-center gap-2 bg-white border border-gray-300 text-gray-700 px-8 py-3 rounded-xl font-bold hover:bg-gray-50 transition">
              عرض جميع الكورسات <ChevronRight size={18} className="rtl:rotate-180" />
            </Link>
          </div>
        </div>
      </section>

      {/* SECTION: Featured Discounted Course */}
      {(() => {
        const featuredId = content['home.featured.courseId'];
        const featuredPct = Number(content['home.featured.discountPercent'] || 0);
        const featuredCourse = featuredId ? courses.find(c => c.id === featuredId) : null;
        if (!featuredCourse || !featuredCourse.price || !featuredPct) return null;
        const origPrice = featuredCourse.price[currency] ?? 0;
        const discountedPrice = Math.round(origPrice * (1 - featuredPct / 100));
        const sym = currency === 'EGP' ? 'ج.م' : currency === 'SAR' ? 'ر.س' : '$';
        // Also check active discount rules for this course
        const now = new Date();
        const ruleDiscount = discounts.find(d => d.active && d.type === 'course' && d.targetId === featuredId && (!d.expiresAt || new Date(d.expiresAt) >= now))
          ?? discounts.find(d => d.active && d.type === 'all_courses' && (!d.expiresAt || new Date(d.expiresAt) >= now));
        const finalPrice = ruleDiscount ? Math.round(discountedPrice * (1 - ruleDiscount.discountPercent / 100)) : discountedPrice;
        return (
          <section className="py-16 bg-gradient-to-br from-primary-900 via-primary-800 to-red-900 relative overflow-hidden">
            <div className="absolute top-0 left-0 w-[400px] h-[400px] bg-secondary-500 rounded-full blur-[150px] opacity-20"></div>
            <div className="container mx-auto px-4 relative z-10">
              <div className="flex flex-col lg:flex-row items-center gap-10 bg-white/10 backdrop-blur-md border border-white/20 rounded-3xl p-8 md:p-12">
                {/* Thumbnail */}
                {featuredCourse.thumbnail && (
                  <div className="w-full lg:w-80 flex-shrink-0 rounded-2xl overflow-hidden shadow-2xl">
                    <img src={featuredCourse.thumbnail} alt={featuredCourse.title} className="w-full h-52 object-cover" />
                  </div>
                )}
                {/* Info */}
                <div className="flex-1 text-white text-center lg:text-right">
                  <div className="inline-flex items-center gap-2 bg-red-500/30 border border-red-400/50 text-red-300 px-4 py-1 rounded-full text-sm font-bold mb-4">
                    <Star size={14} fill="currentColor" /> عرض خاص — خصم {featuredPct}% إضافي
                  </div>
                  <h2 className="text-2xl md:text-3xl font-bold mb-3">{featuredCourse.title}</h2>
                  <p className="text-gray-300 mb-6 leading-relaxed max-w-xl">{(featuredCourse.shortDescription || '').replace(/<[^>]*>/g, '').trim()}</p>
                  <div className="flex items-center justify-center lg:justify-start gap-6 mb-8">
                    <div className="text-center">
                      <p className="text-gray-400 line-through text-base">{origPrice} {sym}</p>
                      <p className="text-4xl font-extrabold text-white">{finalPrice} {sym}</p>
                    </div>
                    <div className="h-12 w-px bg-white/20"></div>
                    <div className="text-left">
                      <p className="text-green-400 font-bold">خصم {featuredPct}%</p>
                      <p className="text-gray-400 text-xs">عرض محدود</p>
                    </div>
                  </div>
                  <Link to={`/c/${featuredCourse.slug || featuredCourse.id}`}
                    className="inline-flex items-center gap-2 bg-white text-primary-800 hover:bg-gray-100 font-bold px-8 py-4 rounded-xl shadow-lg transition text-lg">
                    <Check size={20} /> اشترك الآن واحصل على خصم إضافي
                  </Link>
                </div>
              </div>
            </div>
          </section>
        );
      })()}

      {/* SECTION: 24-Hour Offer with Registration Form */}
      <section className="py-16 bg-gray-900 relative overflow-hidden">
         {/* Background Elements */}
          <div className="absolute top-0 right-0 w-96 h-96 bg-primary-600 rounded-full blur-[150px] opacity-20"></div>
          <div className="absolute bottom-0 left-0 w-96 h-96 bg-secondary-600 rounded-full blur-[150px] opacity-20"></div>
          
          <div className="container mx-auto px-4 relative z-10">
              <div className="flex flex-col lg:flex-row items-center gap-12 border border-gray-700 bg-white/5 backdrop-blur-lg p-8 md:p-12 rounded-3xl">
                  {/* Offer Details */}
                  <div className="flex-1 text-center lg:text-right">
                      <div className="inline-flex items-center gap-2 bg-red-500/20 border border-red-500/50 text-red-400 px-4 py-1 rounded-full text-sm font-bold mb-6 animate-pulse">
                          <Clock size={16} />
                          {content['home.offer.badge'] || 'عرض لمدة 24 ساعة فقط'}
                      </div>
                      <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">{content['home.offer.title'] || 'دبلومة العلاج السلوكي الجدلي (DBT)'}</h2>
                      <p className="text-gray-300 mb-8 text-lg leading-relaxed max-w-2xl">
                          {(content['home.offer.description'] || 'احصل على الدبلومة الأكثر طلباً في سوق العمل بسعر لا يصدق. العرض يشمل الحقيبة التدريبية كاملة + 3 جلسات إشراف مجانية.').replace(/<[^>]*>/g, '').trim()}
                      </p>
                      
                      {/* Price Tag */}
                      {(() => {
                        const offerCid = content['offer.courseId'];
                        const offerCourse = offerCid ? courses.find(c => c.id === offerCid) : null;
                        const pctOff = Number(content['home.offer.discountPercent'] || 45);
                        const sym24 = currencySymbol;
                        let displayOld: string;
                        let displayNew: string;
                        if (offerCourse && offerCourse.price) {
                          // سعر الكورس هو السعر الفعلي (بعد الخصم)، السعر القبلي = سعر الكورس / (1 - خصم%)
                          const newP = offerCourse.price[currency] ?? 0;
                          const oldP = Math.round(newP / (1 - pctOff / 100));
                          displayOld = `${oldP} ${sym24}`;
                          displayNew = `${newP} ${sym24}`;
                        } else {
                          displayOld = content[`home.offer.oldPrice.${currency}`] || content['home.offer.oldPrice'] || `4500 ${sym24}`;
                          displayNew = content[`home.offer.newPrice.${currency}`] || content['home.offer.newPrice'] || `2500 ${sym24}`;
                        }
                        return (
                          <div className="flex items-center justify-center lg:justify-start gap-6 mb-8">
                            <div className="text-center">
                              <p className="text-gray-400 line-through text-lg">{displayOld}</p>
                              <p className="text-4xl font-extrabold text-white">{displayNew}</p>
                            </div>
                            <div className="h-12 w-px bg-gray-700"></div>
                            <div className="text-left">
                              <p className="text-green-400 font-bold text-sm">{content['home.offer.discount'] || `خصم ${pctOff}%`}</p>
                              <p className="text-gray-400 text-xs">{content['home.offer.validUntil'] || 'ساري حتى منتصف الليل'}</p>
                            </div>
                          </div>
                        );
                      })()}

                      {/* Timer - real countdown */}
                      <div className="flex justify-center lg:justify-start gap-4">
                          {[
                            { val: String(timer.h).padStart(2,'0'), label: 'ساعات' },
                            { val: String(timer.m).padStart(2,'0'), label: 'دقائق' },
                            { val: String(timer.s).padStart(2,'0'), label: 'ثواني' },
                          ].map((item, i) => (
                              <div key={i} className="bg-gray-800 rounded-lg p-3 w-20 text-center border border-gray-700">
                                  <span className="block text-2xl font-bold text-white font-mono">{item.val}</span>
                                  <span className="text-xs text-gray-400">{item.label}</span>
                              </div>
                          ))}
                      </div>
                  </div>

                  {/* Registration Form in Offer */}
                  <div className="w-full lg:w-1/3">
                      <div className="bg-white rounded-2xl p-6 shadow-2xl relative">
                          <div className="absolute -top-4 left-1/2 transform -translate-x-1/2 bg-red-600 text-white px-6 py-1 rounded-full text-sm font-bold shadow-lg whitespace-nowrap">
                                      {content['home.offer.formBadge'] || 'سجل الآن واضمن السعر'}
                          </div>
                          
                          <form className="mt-4 space-y-4" onSubmit={handleOfferLeadSubmit}>
                              <div className="bg-gray-50 border border-gray-200 p-3 rounded-lg text-center mb-4">
                                  <p className="text-xs text-gray-500">أنت تسجل لـ:</p>
                                  <p className="font-bold text-primary-700 text-sm">{content['home.offer.registerFor'] || 'دبلومة العلاج السلوكي الجدلي (عرض 24س)'}</p>
                              </div>
                              
                              <div>
                                  <label className="block text-xs font-bold text-gray-700 mb-1">{content['home.offer.formNameLabel'] || 'الاسم الكامل'}</label>
                                  <input type="text" value={offerLeadName} onChange={(e) => setOfferLeadName(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500 outline-none" placeholder={content['home.offer.formNamePlaceholder'] || 'الاسم الثلاثي'} />
                              </div>
                              <div>
                                  <label className="block text-xs font-bold text-gray-700 mb-1">{content['home.offer.formPhoneLabel'] || 'رقم الهاتف (واتساب)'}</label>
                                  <input type="tel" value={offerLeadPhone} onChange={(e) => setOfferLeadPhone(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500 outline-none" placeholder={content['home.offer.formPhonePlaceholder'] || '01xxxxxxxxx'} />
                              </div>
                              <div>
                                  <label className="block text-xs font-bold text-gray-700 mb-1">{content['home.offer.formBranchLabel'] || 'الفرع الأقرب'}</label>
                                  <select value={offerLeadBranch} onChange={(e) => setOfferLeadBranch(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500 outline-none bg-white">
                                      <option value="">{content['home.offer.formBranchPlaceholder'] || 'اختر الفرع الأقرب إليك'}</option>
                                      {(() => {
                                        let db: { id: string; label: string }[] = [];
                                        try { db = JSON.parse(content['institute.branches'] || '[]'); } catch {}
                                        return db.length > 0
                                          ? db.map(b => <option key={b.id} value={b.id}>{b.label}</option>)
                                          : (<>
                                              <option value="daqqi">{content['home.offer.formBranchGiza'] || 'فرع الدقي'}</option>
                                              <option value="tagamoa">{content['home.offer.formBranchCairo'] || 'فرع التجمع'}</option>
                                              <option value="online-egypt">{content['home.offer.formBranchOnline'] || 'أونلاين محلي (مصر)'}</option>
                                              <option value="online-saudi">{content['home.offer.formBranchSaudi'] || 'أونلاين سعودي'}</option>
                                              <option value="online-abroad">{content['home.offer.formBranchAbroad'] || 'أونلاين دولي'}</option>
                                              <option value="other">{content['home.offer.formBranchOther'] || 'أخرى'}</option>
                                            </>);
                                      })()}
                                  </select>
                              </div>

                              {offerLeadNotice && <div className="text-xs text-center rounded-lg px-3 py-2 bg-green-50 border border-green-200 text-green-700">{offerLeadNotice}</div>}

                              <button type="submit" className="w-full bg-primary-600 hover:bg-primary-700 text-white font-bold py-3 rounded-xl transition shadow-lg mt-2 flex items-center justify-center gap-2">
                                  <Send size={16} />
                                  {content['home.offer.registerButton'] || 'حجز العرض الآن'}
                              </button>
                              <p className="text-[10px] text-center text-gray-400">{content['home.offer.registerNote'] || 'سيقوم فريق المبيعات بالتواصل معك لتأكيد الحجز والدفع'}</p>
                          </form>
                      </div>
                  </div>
              </div>
          </div>
      </section>

      {/* SECTION: Institute Video - side by side */}
      <section className="py-24 bg-white relative overflow-hidden">
          <div className="container mx-auto px-4">
              <div className="flex flex-col lg:flex-row items-center gap-12">
                  {/* Video */}
                  <div className="w-full lg:w-1/2">
                      <div
                        role="button"
                        tabIndex={content['home.video.url'] ? 0 : -1}
                        aria-label="تشغيل الفيديو التعريفي"
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); content['home.video.url'] && setShowVideoModal(true); } }}
                        className="relative w-full aspect-video rounded-3xl overflow-hidden shadow-2xl group border-4 border-gray-100"
                        onClick={() => content['home.video.url'] && setShowVideoModal(true)}
                        style={{ cursor: content['home.video.url'] ? 'pointer' : 'default' }}
                      >
                          <div className="absolute inset-0 bg-black/40 group-hover:bg-black/20 transition duration-500 z-10"></div>
                          <div className="w-full h-full bg-gray-800"></div>
                          <div className="absolute inset-0 flex items-center justify-center z-20">
                              <div className="w-16 h-16 bg-white/20 backdrop-blur-sm rounded-full flex items-center justify-center group-hover:scale-110 transition duration-300">
                                  <div className="w-12 h-12 bg-white rounded-full flex items-center justify-center text-primary-600 shadow-lg">
                                      <Play size={24} fill="currentColor" className="ml-1" />
                                  </div>
                              </div>
                          </div>
                          {!content['home.video.url'] && (
                            <div className="absolute bottom-3 left-3 z-20 bg-black/60 backdrop-blur-sm text-white text-xs px-3 py-1 rounded-full">
                              يمكن إضافة رابط الفيديو من لوحة التحكم
                            </div>
                          )}
                      </div>
                  </div>

                  {/* Features text */}
                  <div className="w-full lg:w-1/2 space-y-6">
                      <div>
                          <span className="text-primary-600 font-bold text-sm tracking-wider">{content['home.video.title'] || 'جولة داخل المعهد'}</span>
                          <h2 className="text-3xl font-bold text-gray-900 mt-2 mb-3">لماذا نختار معهد الدراسات النفسية؟</h2>
                          <p className="text-gray-500">{content['home.video.subtitle'] || 'تعرف على بيئة التعلم، قاعات التدريب، وفلسفتنا في تقديم المحتوى العلمي.'}</p>
                      </div>
                      {[
                        { title: content['home.feature1.title'] || 'اعتماد مهني حقيقي', desc: content['home.feature1.desc'] || 'جميع برامجنا معتمدة مهنياً وتحمل شهادات تستحق وزناً حقيقياً في سوق العمل.' },
                        { title: content['home.feature2.title'] || 'تدريب تطبيقي مكثف', desc: content['home.feature2.desc'] || '70% من البرنامج تدريب عملي مع نماذج حالات حقيقية وجلسات إشراف مباشر.' },
                        { title: content['home.feature3.title'] || 'محتوى لمدى الحياة', desc: content['home.feature3.desc'] || 'بعد الاشتراك تحتفظ بوصول كامل لجميع المحاضرات والمراجع مدى الحياة بدون رسوم إضافية.' },
                        { title: content['home.feature4.title'] || 'مجتمع متخصصين', desc: content['home.feature4.desc'] || 'انضم لأكثر من 12ألف متخصص من جميع أنحاء الوطن العربي وتبادل الخبرات.' },
                      ].map((f, i) => (
                        <div key={i} className="flex gap-4 items-start">
                          <div className="w-8 h-8 rounded-full bg-primary-100 flex items-center justify-center flex-shrink-0 mt-1">
                            <CheckCircle size={16} className="text-primary-600" />
                          </div>
                          <div>
                            <h4 className="font-bold text-gray-900 mb-1">{f.title}</h4>
                            <p className="text-gray-500 text-sm leading-relaxed">{f.desc}</p>
                          </div>
                        </div>
                      ))}
                  </div>
              </div>
          </div>
      </section>

      {showVideoModal && content['home.video.url'] && (
        <div
          className="fixed inset-0 bg-black/90 z-[9999] flex items-center justify-center"
          onClick={() => setShowVideoModal(false)}
        >
          <button
            className="absolute top-4 right-4 text-white bg-white/10 rounded-full p-2 hover:bg-white/20 transition"
            onClick={() => setShowVideoModal(false)}
            aria-label="إغلاق"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
          <div className="w-full max-w-4xl px-4" onClick={e => e.stopPropagation()}>
            <div className="relative aspect-video rounded-2xl overflow-hidden shadow-2xl">
              <iframe
                src={`${getEmbedUrl(content['home.video.url'])}&autoplay=1`}
                className="w-full h-full"
                allow="autoplay; fullscreen; picture-in-picture"
                allowFullScreen
                title="فيديو المعهد"
              />
            </div>
          </div>
        </div>
      )}

      {/* SECTION: Featured Instructors */}
      {featuredInstructors.length > 0 && (
      <section className="py-20 bg-gray-50">
        <div className="container mx-auto px-4">
          <div className="text-center mb-12">
            <span className="text-secondary-600 font-bold tracking-wider text-sm uppercase">نخبة الخبراء</span>
            <h2 className="text-3xl font-bold text-gray-900 mt-2">المدربون والخبراء</h2>
            <p className="text-gray-500 mt-2">تعلم على يد أفضل الأطباء والمعالجين النفسيين في الوطن العربي</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {featuredInstructors.map(t => (
              <Link key={t.id} to={`/instructor/${t.id}`} className="group block bg-white rounded-2xl overflow-hidden shadow-md hover:shadow-xl hover:-translate-y-1 transition duration-300">
                <div className="relative h-64 overflow-hidden">
                  <img
                    src={t.image || `https://randomuser.me/api/portraits/men/${t.id}.jpg`}
                    alt={t.name}
                    className="w-full h-full object-cover group-hover:scale-105 transition duration-500"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent"></div>
                  <div className="absolute bottom-4 right-4 left-4 text-white">
                    <p className="font-bold text-base leading-tight">{t.name}</p>
                    <p className="text-xs text-gray-300 mt-0.5">{t.title || t.specialty}</p>
                  </div>
                  {t.featured && (
                    <div className="absolute top-3 left-3 bg-secondary-500 text-white text-xs font-bold px-2 py-0.5 rounded-full">★ مميز</div>
                  )}
                </div>
                <div className="p-4 space-y-3">
                  {t.focusAreas && t.focusAreas.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {t.focusAreas.slice(0, 3).map((area, i) => (
                        <span key={i} className="text-[10px] bg-primary-50 text-primary-700 px-2 py-0.5 rounded-full font-medium">{area}</span>
                      ))}
                    </div>
                  )}
                  {t.bio && <p className="text-xs text-gray-500 leading-relaxed line-clamp-2">{t.bio}</p>}
                  <div className="flex items-center justify-between pt-2 border-t border-gray-100">
                    <span className="text-xs text-gray-500 flex items-center gap-1">
                      <GraduationCap size={12} className="text-primary-500" />
                      {t.experience} سنة خبرة
                    </span>
                    <span className="text-xs text-amber-500 font-bold flex items-center gap-1">
                      <Star size={11} fill="currentColor" />
                      {t.rating}
                    </span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
          <div className="text-center mt-8">
            <Link to="/instructors" className="inline-flex items-center gap-2 bg-white border border-gray-300 text-gray-700 px-8 py-3 rounded-xl font-bold hover:bg-gray-50 transition">
              عرض جميع الخبراء <ChevronRight size={18} className="rtl:rotate-180" />
            </Link>
          </div>
        </div>
      </section>
      )}

      {/* SECTION: Express Consultation Banner */}
      <section className="py-20 bg-white relative overflow-hidden">
        {/* Subtle background accents */}
        <div className="absolute top-0 left-0 w-[500px] h-[500px] bg-primary-50 rounded-full blur-[120px] opacity-60 -translate-x-1/2 -translate-y-1/2"></div>
        <div className="absolute bottom-0 right-0 w-[400px] h-[400px] bg-secondary-50 rounded-full blur-[100px] opacity-50 translate-x-1/3 translate-y-1/3"></div>

        <div className="container mx-auto px-4 relative z-10">

          {/* Header */}
          <div className="text-center mb-12">
            <span className="inline-flex items-center gap-2 text-xs font-bold text-primary-600 bg-primary-50 border border-primary-100 px-4 py-1.5 rounded-full mb-4">
              <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
              متاح الآن — جلسة فورية
            </span>
            <h2 className="text-3xl md:text-4xl font-extrabold text-gray-900 mb-3">
              {content['home.express.title'] || 'تحدث مع معالج نفسي متخصص الآن'}
            </h2>
            <p className="text-gray-500 text-lg max-w-xl mx-auto">
              {content['home.express.subtitle'] || 'جلسة خاصة عبر الإنترنت. احجز في دقائق واحصل على دعم فوري.'}
            </p>
          </div>

          {/* Main card — two columns */}
          <div className="max-w-4xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-0 rounded-3xl overflow-hidden shadow-xl border border-gray-100">

            {/* LEFT: Therapist visual + features */}
            <div className="bg-gradient-to-br from-primary-700 to-primary-900 p-10 flex flex-col justify-between animate-float">
              {/* Icon: therapist at desk */}
              <div className="mb-8">
                <svg viewBox="0 0 120 100" className="w-40 h-32 mx-auto" fill="none" xmlns="http://www.w3.org/2000/svg">
                  {/* Desk */}
                  <rect x="10" y="72" width="100" height="6" rx="3" fill="white" fillOpacity="0.25"/>
                  <rect x="18" y="78" width="6" height="18" rx="2" fill="white" fillOpacity="0.2"/>
                  <rect x="96" y="78" width="6" height="18" rx="2" fill="white" fillOpacity="0.2"/>
                  {/* Monitor */}
                  <rect x="40" y="44" width="40" height="28" rx="4" fill="white" fillOpacity="0.2" stroke="white" strokeOpacity="0.4" strokeWidth="1.5"/>
                  <rect x="44" y="48" width="32" height="18" rx="2" fill="white" fillOpacity="0.12"/>
                  {/* Monitor stand */}
                  <rect x="57" y="72" width="6" height="4" fill="white" fillOpacity="0.2"/>
                  <rect x="52" y="74" width="16" height="2" rx="1" fill="white" fillOpacity="0.15"/>
                  {/* Person body */}
                  <ellipse cx="60" cy="35" rx="9" ry="10" fill="white" fillOpacity="0.9"/>
                  {/* Head */}
                  <circle cx="60" cy="20" r="9" fill="white" fillOpacity="0.9"/>
                  {/* Arms on desk */}
                  <path d="M51 42 Q42 52 38 65" stroke="white" strokeOpacity="0.7" strokeWidth="5" strokeLinecap="round"/>
                  <path d="M69 42 Q78 52 82 65" stroke="white" strokeOpacity="0.7" strokeWidth="5" strokeLinecap="round"/>
                  {/* Book/notebook on desk */}
                  <rect x="22" y="62" width="20" height="10" rx="2" fill="white" fillOpacity="0.3"/>
                  <rect x="24" y="64" width="16" height="1.5" rx="1" fill="white" fillOpacity="0.4"/>
                  <rect x="24" y="67" width="12" height="1.5" rx="1" fill="white" fillOpacity="0.4"/>
                  {/* Coffee cup */}
                  <rect x="82" y="62" width="10" height="10" rx="2" fill="white" fillOpacity="0.3"/>
                  <path d="M92 66 Q97 66 97 70" stroke="white" strokeOpacity="0.3" strokeWidth="1.5" fill="none"/>
                </svg>
                <p className="text-white/60 text-xs text-center mt-1">معالجك ينتظرك</p>
              </div>

              {/* Feature list */}
              <div className="space-y-3">
                {[
                  { icon: <CheckCircle size={15}/>, text: 'خصوصية تامة ومحادثة آمنة' },
                  { icon: <Clock size={15}/>, text: 'استجابة خلال ساعات' },
                  { icon: <Award size={15}/>, text: 'معالجون معتمدون ومتخصصون' },
                  { icon: <Phone size={15}/>, text: 'فيديو أو صوت أو نص — اختيارك' },
                ].map((f, i) => (
                  <div key={i} className="flex items-center gap-3 text-white/90">
                    <span className="text-secondary-200 flex-shrink-0">{f.icon}</span>
                    <span className="text-sm">{f.text}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* RIGHT: Price card */}
            <div className="bg-gray-50 p-10 flex flex-col justify-center items-center text-center animate-float" style={{animationDelay:'0.4s'}}>
              <p className="text-gray-400 text-sm mb-2 font-medium">سعر الجلسة الواحدة</p>

              {/* Price display */}
              <div className="flex items-end justify-center gap-2 mb-6">
                <span className="text-6xl font-extrabold text-gray-900 leading-none">
                  {content[`express.price.${currency}`] || (currency==='EGP'?'500':currency==='SAR'?'150':'40')}
                </span>
                <span className="text-2xl font-bold text-primary-600 mb-2">{currencySymbol}</span>
              </div>

              {/* Session type badges */}
              <div className="flex flex-wrap gap-2 justify-center mb-8">
                {['جلسة فردية', 'سرية تامة', 'أونلاين'].map((tag, i) => (
                  <span key={i} className="text-xs bg-white border border-gray-200 text-gray-600 px-3 py-1 rounded-full font-medium">
                    {tag}
                  </span>
                ))}
              </div>

              <Link
                to="/consultations"
                className="w-full bg-primary-700 hover:bg-primary-800 text-white font-extrabold py-4 rounded-2xl transition shadow-md shadow-primary-200 text-lg mb-3 block"
              >
                احجز جلستك الآن
              </Link>
              <p className="text-gray-400 text-xs">{content['home.express.note'] || 'سيتواصل معك المعالج خلال ساعات'}</p>
            </div>
          </div>

        </div>
      </section>

      {/* SECTION: Testimonials */}
      <section className="py-24 bg-gray-50">
          <div className="container mx-auto px-4">
              <div className="text-center mb-16">
                  <h2 className="text-3xl font-bold text-gray-900 mb-4">{content['home.testimonials.title'] || 'ماذا يقول عملاؤنا؟'}</h2>
                  <p className="text-gray-500">{content['home.testimonials.subtitle'] || 'قصص نجاح حقيقية من خريجي المعهد'}</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                  {testimonials.map((testimonial) => (
                      <div key={testimonial.id} className="bg-white p-8 rounded-2xl border border-gray-100 relative hover:shadow-lg transition duration-300">
                          <Quote size={40} className="text-primary-200 absolute top-6 left-6" />
                          <p className="text-gray-700 leading-relaxed mb-6 relative z-10">
                              "{testimonial.text}"
                          </p>
                          <div className="flex items-center gap-4">
                              {testimonial.image ? <img src={testimonial.image} className="w-12 h-12 rounded-full object-cover" alt={testimonial.name} /> : <div className="w-12 h-12 rounded-full bg-primary-100 flex items-center justify-center text-primary-600 font-bold text-sm">{(testimonial.name||'?')[0]}</div>}
                              <div>
                                  <h4 className="font-bold text-gray-900 text-sm">{testimonial.name}</h4>
                                  <p className="text-xs text-primary-600 font-medium">{testimonial.role}</p>
                              </div>
                          </div>
                      </div>
                  ))}
              </div>
          </div>
      </section>
    </div>
  );
};

export default Home;