import React, { useState } from 'react';
import { Award, BookOpen, MessageCircle, Play, Users } from 'lucide-react';
import { VideoSurface } from '../VideoSurface';
import Picture from '../Picture';
import { Reveal } from './Reveal';

type Content = Record<string, string | undefined>;

/**
 * «لماذا نختار معهد الدراسات النفسية؟» — the institute tour video in a square, with
 * a real class photo as its cover, beside the four reasons. The video address and
 * every line of text is the marketing team's (home.video.* / home.feature*).
 */
const WhyChooseSection: React.FC<{ content: Content }> = ({ content }) => {
  const [playing, setPlaying] = useState(false);
  const videoUrl = content['home.video.url'];
  const reasons = [
    { icon: Award, title: content['home.feature1.title'] || 'اعتماد مهني حقيقي', desc: content['home.feature1.desc'] || 'جميع برامجنا معتمدة مهنياً وتحمل شهادات تستحق وزناً حقيقياً في سوق العمل.' },
    { icon: BookOpen, title: content['home.feature2.title'] || 'تدريب تطبيقي مكثف', desc: content['home.feature2.desc'] || '70% من البرنامج تدريب عملي مع نماذج حالات حقيقية وجلسات إشراف مباشر.' },
    { icon: MessageCircle, title: content['home.feature3.title'] || 'محتوى لمدى الحياة', desc: content['home.feature3.desc'] || 'بعد الاشتراك تحتفظ بوصول كامل لجميع المحاضرات والمراجع مدى الحياة بدون رسوم إضافية.' },
    { icon: Users, title: content['home.feature4.title'] || 'مجتمع متخصصين', desc: content['home.feature4.desc'] || 'انضم لأكثر من 12ألف متخصص من جميع أنحاء الوطن العربي وتبادل الخبرات.' },
  ];

  return (
    <div>
      <Reveal className="mx-auto mb-10 max-w-3xl text-center sm:mb-12">
        <span className="text-sm font-extrabold text-gold-deep">{content['home.video.title'] || 'جولة داخل المعهد'}</span>
        <h2 className="mt-2 text-3xl font-black leading-tight text-ink sm:text-4xl lg:text-[44px]">
          لماذا نختار <span className="text-primary-700">معهد الدراسات النفسية؟</span>
        </h2>
        <p className="mt-3 text-base leading-relaxed text-muted-body sm:text-lg">{content['home.video.subtitle'] || 'تعرف على بيئة التعلم، قاعات التدريب، وفلسفتنا في تقديم المحتوى العلمي.'}</p>
      </Reveal>

      <div className="grid gap-6 lg:grid-cols-2 lg:items-stretch lg:gap-8">
        <Reveal className="mx-auto w-full max-w-[560px] lg:max-w-none">
          {/* A square video. Until it is played it is only a photo: the player is
              not loaded until somebody asks for it, so the page stays light. */}
          <div className="relative aspect-square w-full overflow-hidden rounded-[30px] bg-ink shadow-[0_40px_70px_-35px_rgba(76,5,25,.7)]">
            {playing && videoUrl ? (
              <VideoSurface url={videoUrl} title="جولة داخل المعهد" autoplay cover className="!absolute inset-0" />
            ) : (
              <button
                type="button"
                disabled={!videoUrl}
                onClick={() => setPlaying(true)}
                aria-label="تشغيل فيديو جولة داخل المعهد"
                className="group absolute inset-0 block text-right disabled:cursor-default"
              >
                <Picture base="brand/grads/why-poster" widths={[480, 800]} sizes="(min-width: 1024px) 560px, 92vw" alt="متدربو المعهد في يوم التخرج" width={800} height={800} className="absolute inset-0 h-full w-full object-cover transition duration-700 group-hover:scale-105" />
                <span aria-hidden="true" className="absolute inset-0 bg-gradient-to-t from-ink/90 via-ink/20 to-transparent" />
                {videoUrl && (
                  <span className="absolute left-1/2 top-1/2 flex h-20 w-20 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white/95 text-primary-700 shadow-2xl transition group-hover:scale-110 sm:h-24 sm:w-24">
                    <span aria-hidden="true" className="absolute inset-0 rounded-full bg-white/60 motion-safe:animate-ping" />
                    <Play size={34} fill="currentColor" className="relative ml-1" />
                  </span>
                )}
                <span className="absolute inset-x-5 bottom-5 flex flex-wrap items-end justify-between gap-3 sm:inset-x-7 sm:bottom-6">
                  <span>
                    <b className="block text-xl font-black text-white sm:text-2xl">{videoUrl ? 'شوف المعهد من جوّه' : 'من داخل المعهد'}</b>
                    <span className="text-sm text-white/75">قاعات التدريب، والمحاضرين، ويوم التخرج</span>
                  </span>
                  <span className="flex flex-wrap gap-1.5">
                    <span className="rounded-full bg-white/95 px-3 py-1 text-xs font-extrabold text-ink">فرع الدقي</span>
                    <span className="rounded-full bg-white/95 px-3 py-1 text-xs font-extrabold text-ink">فرع التجمع</span>
                    <span className="rounded-full bg-gold-light px-3 py-1 text-xs font-extrabold text-ink">أونلاين</span>
                  </span>
                </span>
              </button>
            )}
          </div>
        </Reveal>

        <div className="grid gap-3 sm:grid-cols-2 lg:flex lg:flex-col">
          {reasons.map((reason, i) => {
            const Icon = reason.icon;
            return (
              <Reveal key={i} delay={i * 80} className="h-full lg:flex-1">
                <div className="flex h-full items-start gap-4 rounded-[22px] border border-line bg-white p-4 lg:items-center transition hover:-translate-y-1 hover:border-primary-200 hover:shadow-[0_24px_40px_-24px_rgba(26,15,18,.3)] sm:p-5">
                  <span className={`flex h-12 w-12 flex-none items-center justify-center rounded-2xl ${i % 2 === 0 ? 'bg-primary-700 text-white' : 'bg-ink text-gold-pale'}`}>
                    <Icon size={24} />
                  </span>
                  <span className="min-w-0">
                    <b className="mb-1 block text-[17px] leading-snug text-ink">{reason.title}</b>
                    <span className="block text-sm leading-relaxed text-muted">{reason.desc}</span>
                  </span>
                </div>
              </Reveal>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default WhyChooseSection;
