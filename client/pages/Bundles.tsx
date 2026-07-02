import React, { useEffect } from 'react';
import { Layers, Map, ArrowRight, Check, Send, Award, Clock } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { Currency } from '../types';
import { useSiteData } from '../context/SiteDataContext';

const Bundles: React.FC = () => {
    const { bundles, content, currency } = useSiteData();
  const navigate = useNavigate();
  const currencySymbol = currency === 'EGP' ? 'ج.م' : currency === 'SAR' ? 'ر.س' : '$';

  useEffect(() => { document.title = 'المسارات والباقات | معهد الدراسات النفسية'; }, []);

  return (
    <div className="bg-gray-50 min-h-screen">
      {/* Hero */}
      <div className="bg-gradient-to-br from-gray-900 via-violet-950 to-gray-900 text-white py-16 relative overflow-hidden">
        <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] opacity-5"></div>
        <div className="absolute top-0 right-0 w-96 h-96 bg-violet-700 rounded-full blur-[120px] opacity-20"></div>
        <div className="absolute bottom-0 left-0 w-72 h-72 bg-primary-800 rounded-full blur-[100px] opacity-15"></div>
        <div className="container mx-auto px-4 relative z-10 text-center">
          <div className="inline-flex items-center gap-2 bg-violet-600/30 border border-violet-400/30 rounded-full px-4 py-1.5 text-sm font-medium mb-5">
            <Map size={14} className="text-violet-300" />
            <span>{bundles.length} مسار تعليمي وباقة متاحة</span>
          </div>
          <h1 className="text-4xl md:text-5xl font-extrabold mb-4">{content['bundles.title'] || 'المسارات التعليمية والباقات'}</h1>
          <p className="text-gray-300 text-lg max-w-2xl mx-auto leading-relaxed">
            {content['bundles.subtitle'] || 'خطط دراسية متكاملة تأخذ بيدك من البداية وحتى الاحتراف، أو باقات توفيرية تجمع لك أهم الدبلومات.'}
          </p>
          <div className="flex flex-wrap justify-center gap-4 mt-8">
            {[
              { icon: Map, label: 'مسارات متكاملة', sub: 'من المبتدئ للمحترف' },
              { icon: Layers, label: 'باقات توفيرية', sub: 'وفر حتى 40%' },
              { icon: Award, label: 'شهادات معتمدة', sub: 'دولياً ومحلياً' },
              { icon: Clock, label: 'مرونة كاملة', sub: 'ادرس بوقتك' },
            ].map(({ icon: Icon, label, sub }) => (
              <div key={label} className="flex items-center gap-2 bg-white/10 backdrop-blur-sm border border-white/10 rounded-2xl px-4 py-3 text-sm">
                <Icon size={18} className="text-violet-300" />
                <div className="text-right">
                  <div className="font-bold text-white">{label}</div>
                  <div className="text-gray-400 text-xs">{sub}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="container mx-auto px-4 py-10">
        {/* Path Explanation */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-16">
           <div className="bg-blue-50 p-8 rounded-2xl border border-blue-100 flex items-start gap-4">
              <div className="bg-blue-100 p-3 rounded-lg text-blue-600">
                  <Map size={32} />
              </div>
              <div>
                  <h3 className="text-xl font-bold text-blue-900 mb-2">{content['bundles.info.pathsTitle'] || 'مسارات التعلم (Learning Paths)'}</h3>
                  <p className="text-blue-800/70 text-sm leading-relaxed">{content['bundles.info.pathsDesc'] || 'خطة منهجية مرتبة خطوة بخطوة. لا تحتاج للتفكير "بم أبدأ؟"، نحن نرسم لك الطريق لتصبح متخصصاً محترفاً.'}</p>
              </div>
           </div>
           <div className="bg-primary-50 p-8 rounded-2xl border border-primary-100 flex items-start gap-4">
              <div className="bg-primary-100 p-3 rounded-lg text-primary-600">
                  <Layers size={32} />
              </div>
              <div>
                  <h3 className="text-xl font-bold text-primary-900 mb-2">{content['bundles.info.bundlesTitle'] || 'الباقات المجمعة (Bundles)'}</h3>
                  <p className="text-primary-800/70 text-sm leading-relaxed">{content['bundles.info.bundlesDesc'] || 'مجموعة كورسات في تخصص معين بسعر مخفض جداً مقارنة بشراء كل كورس بمفرده.'}</p>
              </div>
           </div>
        </div>

        {/* List */}
        {bundles.length === 0 && (
          <div className="flex flex-col items-center justify-center py-24 gap-4">
            <div className="w-10 h-10 border-4 border-violet-200 border-t-violet-600 rounded-full animate-spin" />
            <p className="text-gray-400 text-sm">جاري تحميل المسارات...</p>
          </div>
        )}
        <div className="space-y-12">
            {bundles.filter(b => b.courses && b.courses.length > 0).map(bundle => (
                <div key={bundle.id} className="bg-white rounded-2xl shadow-lg border border-gray-100 overflow-hidden flex flex-col lg:flex-row group hover:shadow-xl transition duration-300">
                    <div className="lg:w-1/3 bg-gray-900 relative">
                        <div className="absolute inset-0 bg-gradient-to-br from-primary-600 to-primary-900 opacity-90"></div>
                        {(bundle.courses[0]?.thumbnail || bundle.thumbnail) && (
                          <img loading="lazy" decoding="async" src={bundle.courses[0]?.thumbnail || bundle.thumbnail} className="w-full h-full object-cover absolute mix-blend-overlay opacity-50" alt="" />
                        )}
                        <div className="relative z-10 p-8 h-full flex flex-col justify-between text-white">
                            <div>
                                <span className="bg-secondary-500 text-white text-xs font-bold px-3 py-1 rounded-full mb-4 inline-block shadow-lg">{content['bundles.card.badge'] || 'مسار كامل'}</span>
                                <h3 className="text-2xl font-bold mb-4">{bundle.title}</h3>
                                <p className="text-gray-200 text-sm leading-relaxed line-clamp-3">{bundle.description}</p>
                            </div>
                            <div className="mt-8">
                                <div className="text-3xl font-bold mb-1">{bundle.price?.[currency] ?? 0} {currencySymbol}</div>
                                <div className="text-white/60 line-through text-sm mb-4">{content['bundles.card.oldPricePrefix'] || 'بدلاً من'} {bundle.originalPrice?.[currency] ?? 0} {currencySymbol}</div>
                                <Link to={`/bundle/${bundle.slug || bundle.id}`} className="block w-full text-center bg-white text-primary-700 font-bold py-3 rounded-lg hover:bg-gray-50 transition shadow-lg">
                                    {content['bundles.card.detailsCta'] || 'عرض تفاصيل المسار'}
                                </Link>
                            </div>
                        </div>
                    </div>
                    
                    <div className="lg:w-2/3 p-8 flex flex-col justify-between">
                        <div>
                            <h4 className="font-bold text-lg text-gray-800 mb-6 flex items-center gap-2">
                                <Layers size={20} className="text-primary-500" />
                                {content['bundles.card.journeyTitle'] || 'رحلة التعلم'} ({bundle.courses.length} {content['bundles.card.stationsLabel'] || 'محطات'})
                            </h4>
                            
                            <div className="space-y-6 relative before:absolute before:right-8 before:top-4 before:bottom-4 before:w-0.5 before:bg-gray-200">
                                {bundle.courses.map((course, idx) => (
                                    <div key={course.id} className="relative pr-16">
                                        <div className="absolute right-6 top-0 w-4 h-4 rounded-full bg-primary-500 ring-4 ring-white z-10"></div>
                                        <Link to={`/c/${course.slug || course.id}`} className="bg-gray-50 p-4 rounded-xl border border-gray-100 flex gap-4 items-center hover:bg-white hover:shadow-md hover:border-primary-200 transition group">
                                            <div className="w-16 h-16 rounded-lg overflow-hidden flex-shrink-0 bg-gray-100">
                                                {course?.thumbnail && <img loading="lazy" decoding="async" src={course.thumbnail} className="w-full h-full object-cover" alt={course.title} />}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <h5 className="font-bold text-gray-800 group-hover:text-primary-700 transition">{course.title}</h5>
                                                <p className="text-xs text-gray-500 mt-1">{course.duration} • {course.instructor}</p>
                                            </div>
                                            <span className="text-primary-400 text-xs opacity-0 group-hover:opacity-100 transition flex-shrink-0">»</span>
                                        </Link>
                                        {idx < bundle.courses.length - 1 && (
                                            <div className="flex justify-center my-2 pr-12 opacity-0">
                                                <ArrowRight size={20} className="text-gray-300 rotate-90" />
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div className="mt-8 pt-6 border-t flex flex-wrap gap-3 items-center">
                            <div className="flex items-center gap-2 text-sm text-gray-600 bg-green-50 px-3 py-1 rounded-full border border-green-100">
                                <Check size={14} className="text-green-600" />
                                <span className="text-green-800 font-medium">{content['bundles.benefits.certificate'] || 'شهادة مجمعة للمسار'}</span>
                            </div>
                            <div className="flex items-center gap-2 text-sm text-gray-600 bg-blue-50 px-3 py-1 rounded-full border border-blue-100">
                                <Check size={14} className="text-blue-600" />
                                <span className="text-blue-800 font-medium">{content['bundles.benefits.supervision'] || 'إشراف مهني مجاني'}</span>
                            </div>
                            <div className="mr-auto flex gap-2">
                                <button
                                    onClick={() => navigate(`/checkout?type=bundle&id=${bundle.id}`)}
                                    className="bg-primary-600 hover:bg-primary-700 text-white font-bold px-5 py-2.5 rounded-xl text-sm transition shadow shadow-primary-500/20 flex items-center gap-1.5"
                                >
                                    <Check size={15} /> اشترك الآن واحصل على خصم إضافي
                                </button>
                                <Link to={`/bundle/${bundle.slug || bundle.id}#register-form`}
                                    className="border-2 border-primary-600 text-primary-700 hover:bg-primary-50 font-bold px-5 py-2.5 rounded-xl text-sm transition flex items-center gap-1.5"
                                >
                                    <Send size={15} /> سجل بياناتك للتواصل
                                </Link>
                            </div>
                        </div>
                    </div>
                </div>
            ))}
        </div>
      </div>
    </div>
  );
};

export default Bundles;