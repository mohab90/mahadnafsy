import React from 'react';
import { Award, BookOpen, MessageCircle, Play, Users } from 'lucide-react';

type Content = Record<string, string | undefined>;

/**
 * «لماذا نختار معهد الدراسات النفسية؟» — the institute tour video on one side,
 * the four reasons on the other. The video address and every line of text is
 * the marketing team's (home.video.* / home.feature*), exactly as before.
 */
const WhyChooseSection: React.FC<{ content: Content; onPlay: () => void }> = ({ content, onPlay }) => {
  const videoUrl = content['home.video.url'];
  const reasons = [
    { icon: Award, title: content['home.feature1.title'] || 'اعتماد مهني حقيقي', desc: content['home.feature1.desc'] || 'جميع برامجنا معتمدة مهنياً وتحمل شهادات تستحق وزناً حقيقياً في سوق العمل.' },
    { icon: BookOpen, title: content['home.feature2.title'] || 'تدريب تطبيقي مكثف', desc: content['home.feature2.desc'] || '70% من البرنامج تدريب عملي مع نماذج حالات حقيقية وجلسات إشراف مباشر.' },
    { icon: MessageCircle, title: content['home.feature3.title'] || 'محتوى لمدى الحياة', desc: content['home.feature3.desc'] || 'بعد الاشتراك تحتفظ بوصول كامل لجميع المحاضرات والمراجع مدى الحياة بدون رسوم إضافية.' },
    { icon: Users, title: content['home.feature4.title'] || 'مجتمع متخصصين', desc: content['home.feature4.desc'] || 'انضم لأكثر من 12ألف متخصص من جميع أنحاء الوطن العربي وتبادل الخبرات.' },
  ];

  return (
    <div>
      <div className="mb-8 max-w-3xl sm:mb-10">
        <span className="text-sm font-extrabold tracking-wide text-amber-700">{content['home.video.title'] || 'جولة داخل المعهد'}</span>
        <h2 className="mb-3 mt-2 text-3xl font-black leading-tight text-gray-900 sm:text-4xl lg:text-[46px]">
          لماذا نختار <span className="text-primary-600">معهد الدراسات النفسية؟</span>
        </h2>
        <p className="text-base leading-relaxed text-gray-500 sm:text-lg">{content['home.video.subtitle'] || 'تعرف على بيئة التعلم، قاعات التدريب، وفلسفتنا في تقديم المحتوى العلمي.'}</p>
      </div>

      <div className="grid gap-7 lg:grid-cols-[1.35fr_1fr] lg:items-stretch">
        <div
          role="button"
          tabIndex={videoUrl ? 0 : -1}
          aria-label="تشغيل فيديو جولة داخل المعهد"
          onClick={() => videoUrl && onPlay()}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (videoUrl) onPlay(); } }}
          className={`group relative min-h-[250px] overflow-hidden rounded-[30px] bg-[#1b0a12] shadow-[0_40px_70px_-30px_rgba(76,5,25,.65)] sm:min-h-0 sm:aspect-video lg:aspect-auto lg:min-h-[420px] ${videoUrl ? 'cursor-pointer' : 'cursor-default'}`}
          style={{ backgroundImage: 'radial-gradient(rgba(255,255,255,.08) 1px, transparent 1px)', backgroundSize: '20px 20px' }}
        >
          <div aria-hidden="true" className="absolute inset-3.5 rounded-[22px] border-2 border-dashed border-white/25" />
          <div aria-hidden="true" className="absolute -left-20 -top-20 h-64 w-64 rounded-full bg-primary-600 opacity-35" />
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3.5 p-6 text-center">
            <span className="flex h-16 w-16 items-center justify-center rounded-full bg-primary-600 text-white shadow-[0_0_0_10px_rgba(225,29,72,.3),0_20px_40px_-10px_rgba(225,29,72,.8)] transition group-hover:scale-110 sm:h-20 sm:w-20 lg:h-[92px] lg:w-[92px]">
              <Play size={32} fill="currentColor" className="ml-1" />
            </span>
            <span className="text-xl font-black text-white sm:text-2xl">جولة داخل المعهد</span>
            {!videoUrl && <span className="text-sm text-white/70">يمكن إضافة رابط الفيديو من لوحة التحكم</span>}
          </div>
          <div className="absolute inset-x-6 bottom-6 hidden flex-wrap gap-2 sm:flex">
            <span className="rounded-full bg-white px-3.5 py-1 text-[13px] font-extrabold text-[#1b0a12]">فرع الدقي</span>
            <span className="rounded-full bg-white px-3.5 py-1 text-[13px] font-extrabold text-[#1b0a12]">فرع التجمع</span>
            <span className="rounded-full bg-secondary-500 px-3.5 py-1 text-[13px] font-extrabold text-[#1b0a12]">أونلاين</span>
          </div>
        </div>

        <div className="flex flex-col gap-3.5">
          {reasons.map((reason, i) => {
            const Icon = reason.icon;
            return (
              <div key={i} className="flex flex-1 items-center gap-4 rounded-[22px] bg-white px-5 py-5 shadow-sm transition hover:-translate-y-1 hover:shadow-xl">
                <span className={`flex h-[52px] w-[52px] flex-none items-center justify-center rounded-2xl ${i % 2 === 0 ? 'bg-primary-600 text-white' : 'bg-[#1b0a12] text-amber-300'}`}>
                  <Icon size={26} />
                </span>
                <span className="min-w-0">
                  <b className="mb-0.5 block text-[19px] text-gray-900">{reason.title}</b>
                  <span className="text-[15px] leading-relaxed text-gray-500">{reason.desc}</span>
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default WhyChooseSection;
