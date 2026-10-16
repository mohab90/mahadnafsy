import React from 'react';
import { Link } from 'react-router-dom';
import { Target, Eye, History, Users, Award, Globe, Mail, GraduationCap, Briefcase } from 'lucide-react';
import { useSiteData } from '../context/SiteDataContext';
import { useSeo } from '../lib/useSeo';
import { cdnImg, cdnSrcSet } from '../lib/img';
import PageHeader from '../components/PageHeader';

const AboutUs: React.FC = () => {
    useSeo({ title: 'عن المعهد | معهد الدراسات النفسية', path: '/about', description: 'معهد الدراسات النفسية — رواد التعليم النفسي منذ 2010، وأكثر من 12,000 خريج في 15 دولة.' });
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
    <div className="min-h-screen bg-white">
      {/* Hero */}
      <PageHeader
        eyebrow={<span className="inline-flex items-center gap-1.5"><History size={14} />رواد التعليم النفسي منذ 2010</span>}
        title={content['about.heroTitle'] || 'عن المعهد'}
        subtitle={content['about.heroSubtitle'] || 'رواد التعليم النفسي في الوطن العربي منذ عام 2010'}
      >
        <div className="mx-auto grid max-w-3xl grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { icon: Users, label: '12,000+ خريج', sub: 'في الوطن العربي' },
            { icon: Globe, label: '15+ دولة', sub: 'نصل إليها' },
            { icon: Award, label: '50+ برنامج', sub: 'معتمد دولياً' },
            { icon: GraduationCap, label: '15 عاماً', sub: 'من التميز' },
          ].map(({ icon: Icon, label, sub }) => (
            <div key={label} className="flex items-center gap-2.5 rounded-2xl border border-line bg-white px-3 py-3 text-right">
              <span className="flex h-9 w-9 flex-none items-center justify-center rounded-xl bg-primary-50 text-primary-700"><Icon size={18} /></span>
              <div className="min-w-0">
                <div className="text-sm font-black text-ink">{label}</div>
                <div className="text-xs text-muted">{sub}</div>
              </div>
            </div>
          ))}
        </div>
      </PageHeader>

      {/* History & Story */}
      <section className="bg-white py-14 sm:py-20">
        <div className="container mx-auto grid items-center gap-10 px-4 md:grid-cols-2 md:gap-12">
          <div className="relative">
            <img
              src="https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=800&q=80"
              alt="معهد الدراسات النفسية"
              width={800}
              height={533}
              loading="lazy"
              decoding="async"
              className="h-64 w-full rounded-[28px] bg-sand object-cover sm:h-80"
            />
            <div className="absolute -bottom-6 left-6 hidden rounded-[20px] border border-line bg-white px-6 py-4 shadow-[0_30px_50px_-25px_rgba(26,15,18,.35)] md:block">
              <p className="text-center text-3xl font-black tabular-nums text-primary-700">13+</p>
              <p className="text-center text-sm text-muted">عاماً من التميز الأكاديمي</p>
            </div>
          </div>
          <div className="text-center md:text-right">
            <span className="inline-flex items-center gap-2 text-sm font-extrabold text-gold-deep">
              <History size={16} />
              {content['about.storyBadge'] || 'قصتنا'}
            </span>
            <h2 className="mt-2 text-3xl font-black leading-tight text-ink sm:text-4xl">{content['about.storyTitle'] || 'كيف بدأت الرحلة؟'}</h2>
            <p className="mt-5 text-base leading-loose text-muted-body sm:text-lg">
              {content['about.storyParagraph1'] || 'تأسس معهد الدراسات النفسية في عام 2010 بجهود نخبة من أساتذة الطب النفسي وعلم النفس في مصر، بهدف سد الفجوة بين الدراسة النظرية في الجامعات والواقع العملي في العيادات والمستشفيات.'}
            </p>
            <p className="mt-4 text-base leading-loose text-muted-body sm:text-lg">
              {content['about.storyParagraph2'] || 'بدأنا كمركز تدريب صغير، واليوم نفتخر بتخريج أكثر من 12,000 متخصص يعملون في كبرى المؤسسات العلاجية في الوطن العربي. نحن نؤمن بأن المعالج النفسي المحترف يحتاج إلى أكثر من مجرد كتب؛ يحتاج إلى تدريب حي وممارسة حقيقية.'}
            </p>
          </div>
        </div>
      </section>

      {/* Mission & Vision */}
      <section className="bg-paper py-14 sm:py-20">
        <div className="container mx-auto grid gap-6 px-4 md:grid-cols-2">
          <div className="rounded-[28px] border border-line bg-white p-6 transition hover:-translate-y-1 hover:shadow-[0_30px_50px_-25px_rgba(26,15,18,.35)] sm:p-8">
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary-50 text-primary-700">
              <Target size={28} />
            </span>
            <h3 className="mt-5 text-2xl font-black text-ink">رسالتنا (Mission)</h3>
            <p className="mt-3 text-base leading-relaxed text-muted-body sm:text-lg">
              إعداد كوادر مهنية متخصصة في مجال الصحة النفسية، مسلحة بالعلم الحديث والمهارات التطبيقية، قادرة على إحداث تغيير إيجابي في حياة الأفراد والمجتمع، مع الالتزام بأعلى معايير الأخلاق المهنية.
            </p>
          </div>
          <div className="rounded-[28px] border border-line bg-white p-6 transition hover:-translate-y-1 hover:shadow-[0_30px_50px_-25px_rgba(26,15,18,.35)] sm:p-8">
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-paper text-gold-deep ring-1 ring-line">
              <Eye size={28} />
            </span>
            <h3 className="mt-5 text-2xl font-black text-ink">رؤيتنا (Vision)</h3>
            <p className="mt-3 text-base leading-relaxed text-muted-body sm:text-lg">
              أن نكون المرجع الأول والمنصة الرائدة عربياً في التعليم والتدريب النفسي، وأن نساهم في خلق مجتمع واعٍ نفسياً يتمتع فيه الجميع بالصحة النفسية وجودة الحياة.
            </p>
          </div>
        </div>
      </section>

      {/* Values/Stats */}
      <section className="bg-white py-14 sm:py-20">
        <div className="container mx-auto px-4">
          <div className="grid grid-cols-2 gap-y-8 rounded-[28px] bg-ink px-4 py-10 text-center text-white sm:px-8 md:grid-cols-4 md:divide-x md:divide-white/10 md:rtl:divide-x-reverse">
            {[
              { icon: Users, value: content['about.stats.graduates'] || '12K+', label: 'خريج' },
              { icon: Award, value: content['about.stats.programs'] || '50+', label: 'برنامج معتمد' },
              { icon: Globe, value: content['about.stats.countries'] || '15+', label: 'دولة' },
              { icon: History, value: content['about.stats.years'] || '13', label: 'سنة خبرة' },
            ].map(({ icon: Icon, value, label }) => (
              <div key={label} className="px-2">
                <Icon size={30} className="mx-auto text-gold-light" />
                <h4 className="mt-3 text-4xl font-black tabular-nums">{value}</h4>
                <p className="mt-1 text-sm text-white/65">{label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Team */}
      <section className="bg-paper py-14 sm:py-20">
        <div className="container mx-auto px-4">
          <div className="mx-auto mb-10 max-w-2xl text-center sm:mb-12">
            <h2 className="text-3xl font-black leading-tight text-ink sm:text-4xl">{content['about.team.title'] || 'فريق العمل والإدارة'}</h2>
            <p className="mt-3 text-base leading-relaxed text-muted-body sm:text-lg">{content['about.team.subtitle'] || 'نخبة من القادة الأكاديميين والإداريين'}</p>
          </div>

          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {teamMembers.map((member, i) => (
              <div key={i} className="group rounded-[24px] border border-line bg-white p-6 text-center transition hover:-translate-y-1 hover:shadow-[0_30px_50px_-25px_rgba(26,15,18,.35)]">
                <div className="mx-auto mb-5 h-32 w-32 overflow-hidden rounded-full bg-sand ring-4 ring-paper transition group-hover:ring-primary-50">
                  <img loading="lazy" decoding="async" src={cdnImg(member.img, 320)} srcSet={cdnSrcSet(member.img, [160, 320])} sizes="128px" width={128} height={128} className="h-full w-full object-cover object-top" alt={member.name} />
                </div>
                <h3 className="text-xl font-black text-ink">{member.name}</h3>
                <p className="mt-1 text-sm font-bold text-primary-700">{member.role}</p>
                <p className="mt-3 text-sm leading-relaxed text-muted">{member.desc}</p>
              </div>
            ))}
            {teamMembers.length === 0 && (
              <div className="col-span-full rounded-[24px] border border-line bg-white p-6 text-center text-muted">
                لا يوجد أعضاء فريق لعرضهم حاليا. أضف محاضرين من لوحة الإدارة لعرضهم هنا.
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Contact CTA */}
      <section className="bg-white px-4 py-14 sm:py-20">
        <div className="container mx-auto">
          <div className="rounded-[32px] bg-gradient-to-br from-primary-700 via-primary-800 to-[#4c0519] px-5 py-12 text-center text-white sm:px-10 sm:py-14">
            <h2 className="text-3xl font-black leading-tight sm:text-4xl">هل لديك استفسار؟ تواصل معنا</h2>
            <p className="mx-auto mt-3 max-w-xl text-base leading-relaxed text-white/75 sm:text-lg">
              فريقنا مستعد للإجابة على جميع أسئلتك عن البرامج والاشتراكات والاستشارات النفسية.
            </p>
            <div className="mt-8 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:flex-wrap sm:items-center">
              <Link
                to="/contact"
                className="inline-flex min-h-[52px] items-center justify-center gap-2 rounded-2xl bg-gold-light px-7 font-black text-ink transition hover:brightness-105"
              >
                <Mail size={18} />
                تواصل معنا
              </Link>
              <Link
                to="/join"
                className="inline-flex min-h-[52px] items-center justify-center gap-2 rounded-2xl border-[1.5px] border-white/25 px-7 font-extrabold text-white transition hover:border-white/60"
              >
                <GraduationCap size={18} />
                انضم إلينا كمحاضر
              </Link>
              <Link
                to="/join-us"
                className="inline-flex min-h-[52px] items-center justify-center gap-2 rounded-2xl border-[1.5px] border-white/25 px-7 font-extrabold text-white transition hover:border-white/60"
              >
                <Briefcase size={18} />
                انضم إلينا كموظف
              </Link>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};

export default AboutUs;
