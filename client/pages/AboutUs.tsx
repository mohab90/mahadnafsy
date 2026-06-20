import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Target, Eye, History, Users, Award, Globe, Mail, GraduationCap } from 'lucide-react';
import { useSiteData } from '../context/SiteDataContext';

const AboutUs: React.FC = () => {
    useEffect(() => { document.title = 'عن المعهد | معهد الدراسات النفسية'; }, []);
    const { content, therapists } = useSiteData();
    const teamMembers = [...therapists]
      .filter(t => t.showOnAbout)
      .sort((a, b) => (a.sortOrder ?? 99) - (b.sortOrder ?? 99))
      .map((member) => ({
        name: member.name,
        role: member.title || member.specialty,
        desc: member.bio || member.specialty,
        img: member.image,
      }));

  return (
    <div className="bg-white min-h-screen animate-fade-in">
      {/* Hero */}
      <div className="bg-gradient-to-br from-gray-900 via-primary-950 to-gray-900 text-white py-20 relative overflow-hidden">
        <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] opacity-5"></div>
        <div className="absolute top-0 right-0 w-96 h-96 bg-primary-700 rounded-full blur-[120px] opacity-20"></div>
        <div className="absolute bottom-0 left-0 w-72 h-72 bg-secondary-600 rounded-full blur-[100px] opacity-15"></div>
        <div className="container mx-auto px-4 relative z-10 text-center">
          <div className="inline-flex items-center gap-2 bg-primary-600/30 border border-primary-400/30 rounded-full px-4 py-1.5 text-sm font-medium mb-5">
            <History size={14} className="text-primary-300" />
            <span>رواد التعليم النفسي منذ 2010</span>
          </div>
          <h1 className="text-4xl md:text-5xl font-extrabold mb-4 animate-slide-up">{content['about.heroTitle'] || 'عن المعهد'}</h1>
          <p className="text-gray-300 text-lg max-w-2xl mx-auto leading-relaxed animate-slide-up" style={{animationDelay: '0.1s'}}>
            {content['about.heroSubtitle'] || 'رواد التعليم النفسي في الوطن العربي منذ عام 2010'}
          </p>
          <div className="flex flex-wrap justify-center gap-4 mt-8">
            {[
              { icon: Users, label: '12,000+ خريج', sub: 'في الوطن العربي' },
              { icon: Globe, label: '15+ دولة', sub: 'نصل إليها' },
              { icon: Award, label: '50+ برنامج', sub: 'معتمد دولياً' },
              { icon: GraduationCap, label: '15 عاماً', sub: 'من التميز' },
            ].map(({ icon: Icon, label, sub }) => (
              <div key={label} className="flex items-center gap-2 bg-white/10 backdrop-blur-sm border border-white/10 rounded-2xl px-4 py-3 text-sm">
                <Icon size={18} className="text-primary-300" />
                <div className="text-right">
                  <div className="font-bold text-white">{label}</div>
                  <div className="text-gray-400 text-xs">{sub}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* History & Story */}
      <section className="py-16 container mx-auto px-4">
        <div className="flex flex-col md:flex-row gap-12 items-center">
            <div className="md:w-1/2 animate-slide-up" style={{animationDelay: '0.2s'}}>
                <div className="relative">
                    <img
                        src="https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=800&q=80"
                        alt="معهد الدراسات النفسية"
                        className="rounded-2xl shadow-xl w-full border-8 border-gray-50 h-64 object-cover"
                    />
                    <div className="absolute -bottom-6 -left-6 bg-white p-6 rounded-xl shadow-lg max-w-xs hidden md:block border border-gray-100">
                        <p className="font-bold text-gray-900 text-2xl text-center text-primary-600">13+</p>
                        <p className="text-gray-500 text-sm text-center">عاماً من التميز الأكاديمي</p>
                    </div>
                </div>
            </div>
            <div className="md:w-1/2 animate-slide-up" style={{animationDelay: '0.3s'}}>
                <div className="flex items-center gap-2 text-primary-600 font-bold mb-2">
                    <History size={20} />
                    <span>{content['about.storyBadge'] || 'قصتنا'}</span>
                </div>
                <h2 className="text-3xl font-bold text-gray-900 mb-6">{content['about.storyTitle'] || 'كيف بدأت الرحلة؟'}</h2>
                <p className="text-gray-600 leading-loose mb-4 text-lg">
                    {content['about.storyParagraph1'] || 'تأسس معهد الدراسات النفسية في عام 2010 بجهود نخبة من أساتذة الطب النفسي وعلم النفس في مصر، بهدف سد الفجوة بين الدراسة النظرية في الجامعات والواقع العملي في العيادات والمستشفيات.'}
                </p>
                <p className="text-gray-600 leading-loose text-lg">
                    {content['about.storyParagraph2'] || 'بدأنا كمركز تدريب صغير، واليوم نفتخر بتخريج أكثر من 12,000 متخصص يعملون في كبرى المؤسسات العلاجية في الوطن العربي. نحن نؤمن بأن المعالج النفسي المحترف يحتاج إلى أكثر من مجرد كتب؛ يحتاج إلى تدريب حي وممارسة حقيقية.'}
                </p>
            </div>
        </div>
      </section>

      {/* Mission & Vision */}
      <section className="bg-gray-50 py-16">
        <div className="container mx-auto px-4 grid md:grid-cols-2 gap-8">
            <div className="bg-white p-10 rounded-3xl shadow-sm border border-gray-100 hover:border-primary-500 transition duration-300 group hover:-translate-y-2">
                <div className="w-16 h-16 bg-red-100 rounded-2xl flex items-center justify-center text-primary-600 mb-6 group-hover:scale-110 transition">
                    <Target size={32} />
                </div>
                <h3 className="text-2xl font-bold text-gray-900 mb-4">رسالتنا (Mission)</h3>
                <p className="text-gray-600 leading-relaxed text-lg">
                    إعداد كوادر مهنية متخصصة في مجال الصحة النفسية، مسلحة بالعلم الحديث والمهارات التطبيقية، قادرة على إحداث تغيير إيجابي في حياة الأفراد والمجتمع، مع الالتزام بأعلى معايير الأخلاق المهنية.
                </p>
            </div>
            <div className="bg-white p-10 rounded-3xl shadow-sm border border-gray-100 hover:border-secondary-500 transition duration-300 group hover:-translate-y-2">
                <div className="w-16 h-16 bg-yellow-100 rounded-2xl flex items-center justify-center text-secondary-600 mb-6 group-hover:scale-110 transition">
                    <Eye size={32} />
                </div>
                <h3 className="text-2xl font-bold text-gray-900 mb-4">رؤيتنا (Vision)</h3>
                <p className="text-gray-600 leading-relaxed text-lg">
                    أن نكون المرجع الأول والمنصة الرائدة عربياً في التعليم والتدريب النفسي، وأن نساهم في خلق مجتمع واعٍ نفسياً يتمتع فيه الجميع بالصحة النفسية وجودة الحياة.
                </p>
            </div>
        </div>
      </section>

      {/* Values/Stats */}
      <section className="py-20 bg-gray-900 text-white relative overflow-hidden">
          <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] opacity-10"></div>
          <div className="container mx-auto px-4 relative z-10">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-8 text-center divide-x-0 md:divide-x divide-gray-700 rtl:divide-x-reverse">
                  <div className="space-y-2">
                      <Users size={40} className="mx-auto text-primary-500 mb-4 animate-bounce-slow" />
                      <h4 className="text-4xl font-bold">{content['about.stats.graduates'] || '12K+'}</h4>
                      <p className="text-gray-400">خريج</p>
                  </div>
                  <div className="space-y-2">
                      <Award size={40} className="mx-auto text-secondary-500 mb-4 animate-bounce-slow" style={{animationDelay: '0.5s'}} />
                      <h4 className="text-4xl font-bold">{content['about.stats.programs'] || '50+'}</h4>
                      <p className="text-gray-400">برنامج معتمد</p>
                  </div>
                  <div className="space-y-2">
                      <Globe size={40} className="mx-auto text-blue-500 mb-4 animate-bounce-slow" style={{animationDelay: '1s'}} />
                      <h4 className="text-4xl font-bold">{content['about.stats.countries'] || '15+'}</h4>
                      <p className="text-gray-400">دولة</p>
                  </div>
                  <div className="space-y-2">
                      <History size={40} className="mx-auto text-green-500 mb-4 animate-bounce-slow" style={{animationDelay: '1.5s'}} />
                      <h4 className="text-4xl font-bold">{content['about.stats.years'] || '13'}</h4>
                      <p className="text-gray-400">سنة خبرة</p>
                  </div>
              </div>
          </div>
      </section>

      {/* Team */}
      <section className="py-24 container mx-auto px-4">
          <div className="text-center mb-16">
              <h2 className="text-3xl font-bold text-gray-900 mb-4">{content['about.team.title'] || 'فريق العمل والإدارة'}</h2>
              <p className="text-gray-500">{content['about.team.subtitle'] || 'نخبة من القادة الأكاديميين والإداريين'}</p>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
                             {teamMembers.map((member, i) => (
                   <div key={i} className="text-center group bg-white p-6 rounded-2xl border border-gray-100 hover:shadow-xl transition duration-300">
                       <div className="w-32 h-32 mx-auto rounded-full overflow-hidden border-4 border-gray-100 shadow-md mb-6 group-hover:border-primary-500 transition duration-300">
                           <img src={member.img} className="w-full h-full object-cover transform group-hover:scale-110 transition duration-500" alt={member.name} />
                       </div>
                       <h3 className="font-bold text-xl text-gray-900 mb-1">{member.name}</h3>
                       <p className="text-primary-600 font-medium text-sm mb-3">{member.role}</p>
                       <p className="text-gray-500 text-sm">{member.desc}</p>
                   </div>
               ))}
                             {teamMembers.length === 0 && (
                                 <div className="col-span-full text-center text-gray-500 bg-gray-50 border border-gray-200 rounded-2xl p-6">
                                     لا يوجد أعضاء فريق لعرضهم حاليا. أضف محاضرين من لوحة الإدارة لعرضهم هنا.
                                 </div>
                             )}
          </div>
      </section>

      {/* Contact CTA */}
      <section className="bg-primary-700 text-white py-20">
        <div className="container mx-auto px-4 text-center">
          <h2 className="text-3xl font-bold mb-4">هل لديك استفسار؟ تواصل معنا</h2>
          <p className="text-primary-200 mb-8 max-w-xl mx-auto">
            فريقنا مستعد للإجابة على جميع أسئلتك عن البرامج والاشتراكات والاستشارات النفسية.
          </p>
          <div className="flex flex-wrap justify-center gap-4">
            <Link
              to="/contact"
              className="bg-white text-primary-700 font-bold px-8 py-3 rounded-xl hover:bg-primary-50 transition flex items-center gap-2 shadow"
            >
              <Mail size={18} />
              تواصل معنا
            </Link>
            <Link
              to="/join"
              className="bg-primary-600 border border-primary-400 text-white font-bold px-8 py-3 rounded-xl hover:bg-primary-500 transition flex items-center gap-2"
            >
              <GraduationCap size={18} />
              انضم إلينا كمحاضر
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
};

export default AboutUs;