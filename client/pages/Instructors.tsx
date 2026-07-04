import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Star, Shield, ArrowRight, CalendarCheck2, Users, Award, Globe, GraduationCap } from 'lucide-react';
import { useSiteData } from '../context/SiteDataContext';
import { isConsultationEnabled, meetingProviderLabels } from '../lib/consultations';

const Instructors: React.FC = () => {
  const { therapists, content } = useSiteData();
  useEffect(() => { document.title = 'الخبراء والمدربين | معهد الدراسات النفسية'; }, []);
  return (
    <div className="bg-gray-50 min-h-screen">
      {/* Hero */}
      <div className="bg-gradient-to-br from-gray-900 via-emerald-950 to-gray-900 text-white py-16 relative overflow-hidden">
        <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] opacity-5"></div>
        <div className="absolute top-0 right-0 w-96 h-96 bg-emerald-700 rounded-full blur-[120px] opacity-20"></div>
        <div className="absolute bottom-0 left-0 w-72 h-72 bg-primary-800 rounded-full blur-[100px] opacity-15"></div>
        <div className="container mx-auto px-4 relative z-10 text-center">
          <div className="inline-flex items-center gap-2 bg-emerald-600/30 border border-emerald-400/30 rounded-full px-4 py-1.5 text-sm font-medium mb-5">
            <GraduationCap size={14} className="text-emerald-300" />
            <span>{therapists.length} خبير ومدرب معتمد</span>
          </div>
          <h1 className="text-4xl md:text-5xl font-extrabold mb-4">{content['instructors.title'] || 'نخبة المدربين والخبراء'}</h1>
          <p className="text-gray-300 text-lg max-w-2xl mx-auto leading-relaxed">
            {content['instructors.subtitle'] || 'تعلم على يد أفضل الأطباء والمعالجين النفسيين في الوطن العربي. خبرة أكاديمية وعملية تمتد لسنوات.'}
          </p>
          <div className="flex flex-wrap justify-center gap-4 mt-8">
            {[
              { icon: GraduationCap, label: 'خبراء معتمدون', sub: 'دكاترة ومتخصصون' },
              { icon: Star, label: 'تقييم مرتفع', sub: '4.9 من 5 نجوم' },
              { icon: Globe, label: 'وصول عالمي', sub: 'خبرة دولية' },
              { icon: Shield, label: 'كفاءة موثقة', sub: 'سنوات من الخبرة' },
            ].map(({ icon: Icon, label, sub }) => (
              <div key={label} className="flex items-center gap-2 bg-white/10 backdrop-blur-sm border border-white/10 rounded-2xl px-4 py-3 text-sm">
                <Icon size={18} className="text-emerald-300" />
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
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {[...therapists].sort((a, b) => (a.sortOrder ?? 99) - (b.sortOrder ?? 99)).map((instructor) => (
            <Link to={`/instructor/${instructor.id}`} key={instructor.id} className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden hover:shadow-xl transition duration-300 group flex flex-col">
              <div className="relative h-64 bg-gray-100 overflow-hidden">
                <img loading="lazy" decoding="async" 
                  src={instructor.image} 
                  alt={instructor.name} 
                  className="w-full h-full object-cover group-hover:scale-105 transition duration-500" 
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent"></div>
                <div className="absolute bottom-4 right-4 text-white">
                  <p className="text-sm font-light opacity-90">{instructor.title}</p>
                  <h3 className="text-xl font-bold">{instructor.name}</h3>
                </div>
              </div>
              
              <div className="p-6 flex-grow flex flex-col">
                <div className="flex flex-wrap gap-2 mb-4">
                  {isConsultationEnabled(instructor) && (
                    <span className="inline-flex items-center gap-1 bg-emerald-50 text-emerald-700 px-2 py-1 rounded-full text-xs font-bold">
                      <CalendarCheck2 size={12} />
                      متاح للحجز
                    </span>
                  )}
                  {isConsultationEnabled(instructor) && instructor.consultationSettings && (
                    <span className="bg-blue-50 text-blue-700 px-2 py-1 rounded-full text-xs font-bold">
                      {meetingProviderLabels[instructor.consultationSettings.meetingProvider]}
                    </span>
                  )}
                </div>
                <p className="text-gray-600 text-sm line-clamp-3 mb-6 leading-relaxed">
                  {instructor.bio || (content['instructors.card.bioFallback'] || 'خبير متخصص في مجاله مع سنوات عديدة من الخبرة الأكاديمية والعملية...')}
                </p>

                {(instructor.focusAreas || []).length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-6">
                    {(instructor.focusAreas || []).slice(0, 3).map((item) => (
                      <span key={item} className="px-2 py-1 rounded-full bg-gray-100 text-gray-600 text-xs">{item}</span>
                    ))}
                  </div>
                )}
                
                <div className="flex items-center justify-between text-sm text-gray-500 mt-auto pt-4 border-t">
                  <div className="flex items-center gap-1">
                    <Shield size={16} className="text-primary-500" />
                    <span>{instructor.experience} {content['instructors.card.experienceSuffix'] || 'سنة خبرة'}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Star size={16} className="text-yellow-500" fill="currentColor" />
                    <span>{instructor.rating}</span>
                  </div>
                </div>
                
                <div className="mt-4 text-primary-600 font-bold text-sm flex items-center gap-1 group-hover:gap-2 transition-all">
                    {content['instructors.card.profileCta'] || 'عرض الملف الشخصي'} <ArrowRight size={16} className="rtl:rotate-180" />
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
};

export default Instructors;